// Deterministic enrichment, revenue normalization and anomaly detection for bank statements.
// Raw OCR fields are never overwritten: every derived value carries a transaction id/evidence.

import { distance } from 'fastest-levenshtein';
import { MultiDirectedGraph } from 'graphology';
import { median, quantileSorted } from 'simple-statistics';
import { z } from 'zod';

import type {
  StatementAnalysisResult,
  StatementTransaction,
} from './prompts/statement-analyze-prompts';
import { parseAmount, parseVNDate } from './statement-analyze-calc';

export const STATEMENT_INTELLIGENCE_VERSION = '1.0.0';
const REVENUE_REVIEW_THRESHOLD = 85;
const ROUND_TRIP_HOURS = 72;
const AMOUNT_MATCH_TOLERANCE = 0.05;
const MIN_LARGE_AMOUNT = 10_000_000;

export type CounterpartySource = 'remitter' | 'details' | 'unknown';
export type RevenueLabel =
  | 'business_revenue'
  | 'personal_income'
  | 'non_business'
  | 'other'
  | 'review';
export type FraudSeverity = 'high' | 'medium' | 'low' | 'info';

export interface EnrichedCounterparty {
  raw_name: string | null;
  normalized_name: string | null;
  canonical_name: string | null;
  entity_id: string | null;
  source: CounterpartySource;
  confidence: number;
  is_account_holder: boolean;
}

export interface EnrichedStatementTransaction {
  transaction_id: string;
  source_index: number;
  normalized_details: string | null;
  removed_noise: string[];
  counterparty: EnrichedCounterparty;
}

export interface CounterpartyEntity {
  entity_id: string;
  canonical_name: string;
  aliases: string[];
  transaction_ids: string[];
  is_account_holder: boolean;
}

export interface StatementEnrichmentResult {
  version: string;
  method: 'typescript-rules-levenshtein';
  transactions: EnrichedStatementTransaction[];
  entities: CounterpartyEntity[];
  metrics: {
    total_transactions: number;
    sanitized_transactions: number;
    counterparties_extracted: number;
    entities_grouped: number;
  };
}

export interface RevenueClassification {
  transaction_id: string;
  source_index: number;
  amount: number;
  label: RevenueLabel;
  confidence: number;
  source: 'rule_engine' | 'llm_adjudication';
  rule_codes: string[];
  explanation_vi: string;
  requires_review: boolean;
  counterparty_entity_id: string | null;
}

export interface RevenueSummary {
  gross_inflow: number;
  business_revenue: number;
  personal_income: number;
  non_business_inflow: number;
  other_inflow: number;
  pending_review_inflow: number;
  normalized_business_revenue_after_fraud: number;
  fraud_excluded_amount: number;
}

export interface RevenueNormalizationResult {
  version: string;
  review_threshold: number;
  rules_evaluated: number;
  llm_adjudication: {
    requested: number;
    resolved: number;
    failed: number;
    model_used: boolean;
  };
  classifications: RevenueClassification[];
  summary: RevenueSummary;
  monthly_business_revenue: Array<{ month: string; amount: number; transaction_count: number }>;
  excluded_transaction_ids: string[];
  pending_review_transaction_ids: string[];
}

export interface RevenueAdjudicationDecision {
  transaction_id: string;
  label: RevenueLabel;
  confidence: number;
  explanation_vi: string;
}

export const revenueAdjudicationSchema = z.object({
  decisions: z.array(z.object({
    transaction_id: z.string().min(1),
    label: z.enum(['business_revenue', 'personal_income', 'non_business', 'other', 'review']),
    confidence: z.number().min(0).max(100),
    explanation_vi: z.string().min(1).max(600),
  })).max(100),
});

export interface FraudFinding {
  id: string;
  category: 'window_dressing' | 'round_trip' | 'behavior' | 'statistical' | 'data_quality';
  severity: FraudSeverity;
  title: string;
  detail: string;
  transaction_ids: string[];
  /** Backward-compatible indexes for the current statement UI. */
  txIndexes: number[];
  evidence: Record<string, unknown>;
}

export interface FraudDetectionResult {
  version: string;
  engine: {
    runtime: 'typescript';
    libraries: string[];
    observed_graph_nodes: number;
    observed_graph_edges: number;
    limitations: string[];
  };
  findings: FraudFinding[];
  exclusions: {
    revenue_transaction_ids: string[];
    average_balance_transaction_ids: string[];
  };
  adjusted_balance: {
    original_selected_avg_sdbq: number | null;
    adjusted_selected_avg_sdbq: number | null;
    monthly: Array<{ month: string; original_sdbq: number | null; adjusted_sdbq: number | null }>;
  };
  metrics: {
    window_dressing_pairs: number;
    observed_round_trip_pairs: number;
    behavior_matches: number;
    statistical_outliers: number;
  };
}

interface WorkingRow {
  tx: StatementTransaction;
  enriched: EnrichedStatementTransaction;
  amountIn: number;
  amountOut: number;
  balance: number | null;
  epochDay: number | null;
  monthKey: string | null;
}

const NOISE_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'MBVCB', pattern: /\bMBVCB[.\-_/A-Z0-9]{4,}\b/giu },
  { code: 'SWIFT_FT', pattern: /\bFT[A-Z0-9]{8,}\b/giu },
  { code: 'CITAD', pattern: /\b\d{20}\b/gu },
  { code: 'BANK_TIMESTAMP', pattern: /\b20\d{6}[.\-_ ]?(?:[01]\d|2[0-3])[0-5]\d[0-5]\d\b/gu },
  { code: 'TRACE_ID', pattern: /\b(?:TRACE|REF(?:ERENCE)?|TRANS(?:ACTION)?\s*ID)\s*[:#]?\s*[A-Z0-9]{10,}\b/giu },
];

const GENERIC_COUNTERPARTIES = new Set([
  'KHACH HANG', 'CUSTOMER', 'CHUYEN KHOAN', 'TRANSFER', 'NAP TIEN', 'RUT TIEN',
  'OTHER', 'UNKNOWN', 'KHONG XAC DINH', 'NGAN HANG',
]);

const LEGAL_FORM_TOKENS = new Set([
  'CONG', 'TY', 'CTY', 'TNHH', 'TRACH', 'NHIEM', 'HUU', 'HAN', 'CO', 'LTD', 'LIMITED',
  'CORP', 'CORPORATION', 'JSC', 'JOINT', 'STOCK', 'CP', 'DOANH', 'NGHIEP', 'DNTN',
]);

const NON_BUSINESS_RULES: Array<{ code: string; confidence: number; pattern: RegExp; explanation: string }> = [
  { code: 'LOAN_PROCEEDS', confidence: 99, pattern: /\b(VAY|CHO VAY|GIAI NGAN|KHOAN VAY|LOAN|DISBURSEMENT)\b/u, explanation: 'Khoản vay/giải ngân, không phải doanh thu.' },
  { code: 'SAVING_FD', confidence: 99, pattern: /\b(TIET KIEM|TAT TOAN|SO TIET KIEM|TIEN GUI|KY HAN|SAVING|FIXED DEPOSIT|\bFD\b)\b/u, explanation: 'Tất toán/điều chuyển tiền gửi tiết kiệm.' },
  { code: 'REFUND_REVERSAL', confidence: 97, pattern: /\b(HOAN TIEN|HOAN TRA|REFUND|REVERSAL|DAO BUT TOAN|REV[_ -])\b/u, explanation: 'Hoàn tiền hoặc bút toán đảo kỹ thuật.' },
  { code: 'CAPITAL_INJECTION', confidence: 95, pattern: /\b(GOP VON|BO SUNG VON|CAPITAL|VON DIEU LE)\b/u, explanation: 'Góp/bổ sung vốn, không phải doanh thu hoạt động.' },
  { code: 'INTEREST_CREDIT', confidence: 95, pattern: /\b(LAI TIEN GUI|TRA LAI|INTEREST)\b/u, explanation: 'Lãi tiền gửi, phân loại là dòng tiền phi kinh doanh.' },
];

const INCOME_RULES: Array<{ code: string; pattern: RegExp }> = [
  { code: 'SALARY', pattern: /\b(LUONG|SALARY|PAYROLL|TIEN CONG|THU NHAP CA NHAN)\b/u },
  { code: 'PERSONAL_BENEFIT', pattern: /\b(TRO CAP|PHU CAP|BONUS|THUONG)\b/u },
];

const BUSINESS_RULES: Array<{ code: string; pattern: RegExp }> = [
  { code: 'SALES_RECEIPT', pattern: /\b(TIEN HANG|BAN HANG|DOANH THU|HOA DON|INVOICE|SALES)\b/u },
  { code: 'SERVICE_RECEIPT', pattern: /\b(DICH VU|PHI DICH VU|HOP DONG|CONTRACT)\b/u },
  { code: 'MERCHANT_SETTLEMENT', pattern: /\b(POS|QR|MERCHANT|DOI SOAT|SETTLEMENT)\b/u },
];

const AMBIGUOUS_BUSINESS_RULES: Array<{ code: string; pattern: RegExp }> = [
  { code: 'GENERIC_PAYMENT', pattern: /\b(THANH TOAN|PAYMENT|TRA TIEN)\b/u },
  { code: 'GENERIC_SERVICE', pattern: /\b(SERVICE)\b/u },
];

const BEHAVIOR_RULES: Array<{ code: string; severity: FraudSeverity; pattern: RegExp; title: string }> = [
  { code: 'GAMBLING', severity: 'high', pattern: /\b(CA CUOC|CA DO|CASINO|BET|GAMBL|TAI XIU|XOC DIA|POKER|NHA CAI)\b/u, title: 'Dấu hiệu giao dịch cờ bạc/cá cược' },
  { code: 'BLACK_CREDIT', severity: 'high', pattern: /\b(VAY NONG|TIN DUNG DEN|BOC BAT HO|APP VAY|VAY APP|DAUTU? VAY)\b/u, title: 'Dấu hiệu vay nóng/tín dụng đen' },
  { code: 'CRYPTO_P2P', severity: 'medium', pattern: /\b(BINANCE|BYBIT|OKX|USDT|CRYPTO|P2P)\b/u, title: 'Giao dịch tài sản số/P2P cần rà soát' },
];

function foldText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/giu, 'd')
    .toUpperCase();
}

function compactText(value: string | null | undefined): string {
  return foldText(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId(prefix: string, input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

function normalizeEntityName(value: string | null | undefined): string | null {
  const compact = compactText(value);
  if (!compact || GENERIC_COUNTERPARTIES.has(compact)) return null;
  const tokens = compact.split(' ').filter((token) => !LEGAL_FORM_TOKENS.has(token));
  const normalized = tokens.join(' ').trim();
  return normalized.length >= 3 ? normalized : null;
}

function sanitizeDetails(details: string | null): { normalized: string | null; removed: string[] } {
  if (!details?.trim()) return { normalized: null, removed: [] };
  let output = details;
  const removed: string[] = [];
  for (const { code, pattern } of NOISE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) removed.push(code);
    pattern.lastIndex = 0;
    output = output.replace(pattern, ' ');
  }
  output = output.replace(/[|;,_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { normalized: output || null, removed };
}

function extractCounterparty(
  tx: StatementTransaction,
  normalizedDetails: string | null,
): { raw: string | null; source: CounterpartySource; confidence: number } {
  const remitter = tx.remitter?.trim() || null;
  if (remitter && normalizeEntityName(remitter)) {
    return { raw: remitter, source: 'remitter', confidence: 98 };
  }

  const details = compactText(normalizedDetails);
  if (!details) return { raw: null, source: 'unknown', confidence: 0 };

  const labelled = details.match(
    /(?:NGUOI CHUYEN|NGUOI NHAN|CHU TAI KHOAN|CHU TK|TEN TK|FROM|TO)\s+([A-Z][A-Z ]{2,60}?)(?=\s+(?:NOI DUNG|TAI TK|STK|TK|CHUYEN|THANH TOAN|TREN|$))/u,
  );
  if (labelled?.[1] && normalizeEntityName(labelled[1])) {
    return { raw: labelled[1].trim(), source: 'details', confidence: 82 };
  }

  const transferPrefix = details.match(/^([A-Z][A-Z ]{2,60}?)\s+(?:CHUYEN TIEN|THANH TOAN|TRA TIEN|NAP TIEN)\b/u);
  if (transferPrefix?.[1] && normalizeEntityName(transferPrefix[1])) {
    return { raw: transferPrefix[1].trim(), source: 'details', confidence: 72 };
  }

  return { raw: null, source: 'unknown', confidence: 0 };
}

function shouldMergeEntities(a: string, b: string): boolean {
  const score = similarity(a, b);
  if (score >= 0.88) return true;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const common = [...aTokens].filter((token) => bTokens.has(token)).length;
  const tokenCoverage = common / Math.max(aTokens.size, bTokens.size);
  return score >= 0.78 && tokenCoverage >= 0.67;
}

export function enrichStatementTransactions(
  transactions: StatementTransaction[],
  accountHolderName: string | null,
): StatementEnrichmentResult {
  const accountHolder = normalizeEntityName(accountHolderName);
  const provisional = transactions.map((tx, index) => {
    const sanitized = sanitizeDetails(tx.details);
    const extracted = extractCounterparty(tx, sanitized.normalized);
    const normalizedName = normalizeEntityName(extracted.raw);
    return {
      transaction_id: `tx_${String(index + 1).padStart(6, '0')}`,
      source_index: index + 1,
      normalized_details: sanitized.normalized,
      removed_noise: sanitized.removed,
      extracted,
      normalizedName,
    };
  });

  const groups: Array<{ canonical: string; aliases: Set<string>; txIds: string[]; isAccountHolder: boolean }> = [];
  for (const item of provisional) {
    if (!item.normalizedName) continue;
    const isAccountHolder = !!accountHolder && similarity(item.normalizedName, accountHolder) >= 0.9;
    let group = groups.find((candidate) =>
      candidate.isAccountHolder === isAccountHolder && shouldMergeEntities(item.normalizedName!, candidate.canonical));
    if (!group) {
      group = {
        canonical: isAccountHolder ? accountHolder! : item.normalizedName,
        aliases: new Set<string>(),
        txIds: [],
        isAccountHolder,
      };
      groups.push(group);
    }
    group.aliases.add(item.extracted.raw!);
    group.txIds.push(item.transaction_id);
    if (!group.isAccountHolder && item.normalizedName.length < group.canonical.length) {
      group.canonical = item.normalizedName;
    }
  }

  const entityByTx = new Map<string, { id: string; canonical: string; isAccountHolder: boolean }>();
  const entities = groups.map((group) => {
    const id = group.isAccountHolder ? 'entity_account_holder' : stableId('entity', group.canonical);
    for (const txId of group.txIds) {
      entityByTx.set(txId, { id, canonical: group.canonical, isAccountHolder: group.isAccountHolder });
    }
    return {
      entity_id: id,
      canonical_name: group.canonical,
      aliases: [...group.aliases].sort(),
      transaction_ids: group.txIds,
      is_account_holder: group.isAccountHolder,
    };
  });

  const enriched: EnrichedStatementTransaction[] = provisional.map((item) => {
    const entity = entityByTx.get(item.transaction_id);
    return {
      transaction_id: item.transaction_id,
      source_index: item.source_index,
      normalized_details: item.normalized_details,
      removed_noise: item.removed_noise,
      counterparty: {
        raw_name: item.extracted.raw,
        normalized_name: item.normalizedName,
        canonical_name: entity?.canonical ?? item.normalizedName,
        entity_id: entity?.id ?? null,
        source: item.extracted.source,
        confidence: item.extracted.confidence,
        is_account_holder: entity?.isAccountHolder ?? false,
      },
    };
  });

  return {
    version: STATEMENT_INTELLIGENCE_VERSION,
    method: 'typescript-rules-levenshtein',
    transactions: enriched,
    entities,
    metrics: {
      total_transactions: enriched.length,
      sanitized_transactions: enriched.filter((tx) => tx.removed_noise.length > 0).length,
      counterparties_extracted: enriched.filter((tx) => tx.counterparty.entity_id != null).length,
      entities_grouped: entities.length,
    },
  };
}

function transactionText(tx: StatementTransaction, enriched: EnrichedStatementTransaction): string {
  return compactText([
    enriched.normalized_details,
    enriched.counterparty.raw_name,
    tx.remitter_bank,
  ].filter(Boolean).join(' '));
}

function classifyInflow(
  tx: StatementTransaction,
  enriched: EnrichedStatementTransaction,
): RevenueClassification | null {
  const amount = parseAmount(tx.credit) ?? 0;
  if (amount <= 0) return null;
  const text = transactionText(tx, enriched);
  const base = {
    transaction_id: enriched.transaction_id,
    source_index: enriched.source_index,
    amount,
    source: 'rule_engine' as const,
    counterparty_entity_id: enriched.counterparty.entity_id,
  };

  if (enriched.counterparty.is_account_holder) {
    return {
      ...base, label: 'non_business', confidence: 99, rule_codes: ['OWN_ACCOUNT_TRANSFER'],
      explanation_vi: 'Điều chuyển giữa tài khoản cùng chủ, loại khỏi doanh thu.', requires_review: false,
    };
  }
  for (const rule of NON_BUSINESS_RULES) {
    if (rule.pattern.test(text)) {
      return {
        ...base, label: 'non_business', confidence: rule.confidence, rule_codes: [rule.code],
        explanation_vi: rule.explanation, requires_review: false,
      };
    }
  }
  for (const rule of INCOME_RULES) {
    if (rule.pattern.test(text)) {
      return {
        ...base, label: 'personal_income', confidence: 95, rule_codes: [rule.code],
        explanation_vi: 'Thu nhập cá nhân được nhận diện bằng từ khóa.', requires_review: false,
      };
    }
  }
  for (const rule of BUSINESS_RULES) {
    if (rule.pattern.test(text)) {
      return {
        ...base, label: 'business_revenue', confidence: 90, rule_codes: [rule.code],
        explanation_vi: 'Khoản thu bán hàng/dịch vụ có bằng chứng thương mại cụ thể.', requires_review: false,
      };
    }
  }
  for (const rule of AMBIGUOUS_BUSINESS_RULES) {
    if (rule.pattern.test(text)) {
      return {
        ...base, label: 'review', confidence: 72, rule_codes: [rule.code],
        explanation_vi: 'Nội dung thanh toán/dịch vụ còn chung chung, cần LLM hoặc chuyên viên phân xử.', requires_review: true,
      };
    }
  }

  const hasIdentifiedCounterparty = enriched.counterparty.entity_id != null;
  return {
    ...base,
    label: 'review',
    confidence: hasIdentifiedCounterparty ? 70 : 55,
    rule_codes: [hasIdentifiedCounterparty ? 'UNCLASSIFIED_COUNTERPARTY_INFLOW' : 'UNCLASSIFIED_INFLOW'],
    explanation_vi: 'Tiền vào chưa có tín hiệu đủ mạnh để xác định là doanh thu.',
    requires_review: true,
  };
}

function monthOf(date: string | null): string | null {
  return parseVNDate(date)?.monthKey ?? null;
}

function summarizeRevenue(
  classifications: RevenueClassification[],
  transactions: StatementTransaction[],
  fraudExcludedIds: Set<string> = new Set(),
): Pick<RevenueNormalizationResult, 'summary' | 'monthly_business_revenue' | 'excluded_transaction_ids' | 'pending_review_transaction_ids'> {
  const summary: RevenueSummary = {
    gross_inflow: 0,
    business_revenue: 0,
    personal_income: 0,
    non_business_inflow: 0,
    other_inflow: 0,
    pending_review_inflow: 0,
    normalized_business_revenue_after_fraud: 0,
    fraud_excluded_amount: 0,
  };
  const monthly = new Map<string, { amount: number; count: number }>();
  const excluded: string[] = [];
  const pending: string[] = [];

  for (const item of classifications) {
    summary.gross_inflow += item.amount;
    if (item.label === 'business_revenue') {
      summary.business_revenue += item.amount;
      if (fraudExcludedIds.has(item.transaction_id)) {
        summary.fraud_excluded_amount += item.amount;
        excluded.push(item.transaction_id);
      } else {
        summary.normalized_business_revenue_after_fraud += item.amount;
        const month = monthOf(transactions[item.source_index - 1]?.transaction_date ?? null) ?? 'Không rõ';
        const agg = monthly.get(month) ?? { amount: 0, count: 0 };
        agg.amount += item.amount;
        agg.count++;
        monthly.set(month, agg);
      }
    } else if (item.label === 'personal_income') {
      summary.personal_income += item.amount;
    } else if (item.label === 'non_business') {
      summary.non_business_inflow += item.amount;
      excluded.push(item.transaction_id);
    } else if (item.label === 'other') {
      summary.other_inflow += item.amount;
    } else {
      summary.pending_review_inflow += item.amount;
      pending.push(item.transaction_id);
    }
  }

  return {
    summary,
    monthly_business_revenue: [...monthly.entries()]
      .map(([month, value]) => ({ month, amount: value.amount, transaction_count: value.count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    excluded_transaction_ids: excluded,
    pending_review_transaction_ids: pending,
  };
}

export function normalizeRevenueByRules(
  transactions: StatementTransaction[],
  enrichment: StatementEnrichmentResult,
): RevenueNormalizationResult {
  const classifications = enrichment.transactions
    .map((item) => classifyInflow(transactions[item.source_index - 1], item))
    .filter((item): item is RevenueClassification => item != null);
  return {
    version: STATEMENT_INTELLIGENCE_VERSION,
    review_threshold: REVENUE_REVIEW_THRESHOLD,
    rules_evaluated: classifications.length,
    llm_adjudication: { requested: 0, resolved: 0, failed: 0, model_used: false },
    classifications,
    ...summarizeRevenue(classifications, transactions),
  };
}

export function getRevenueReviewCandidates(
  revenue: RevenueNormalizationResult,
  transactions: StatementTransaction[],
  enrichment: StatementEnrichmentResult,
): Array<Record<string, unknown>> {
  const enrichedById = new Map(enrichment.transactions.map((item) => [item.transaction_id, item]));
  return revenue.classifications
    .filter((item) => item.confidence < REVENUE_REVIEW_THRESHOLD)
    .map((item) => {
      const tx = transactions[item.source_index - 1];
      const enriched = enrichedById.get(item.transaction_id)!;
      return {
        transaction_id: item.transaction_id,
        date: tx.transaction_date,
        amount: item.amount,
        counterparty: enriched.counterparty.canonical_name,
        details: enriched.normalized_details?.slice(0, 500) ?? null,
        current_label: item.label,
        current_confidence: item.confidence,
      };
    });
}

export function applyRevenueAdjudication(
  revenue: RevenueNormalizationResult,
  transactions: StatementTransaction[],
  decisions: RevenueAdjudicationDecision[],
  requested: number,
  failed: number,
): RevenueNormalizationResult {
  const byId = new Map(decisions.map((decision) => [decision.transaction_id, decision]));
  let resolved = 0;
  const classifications = revenue.classifications.map((item) => {
    const decision = byId.get(item.transaction_id);
    if (!decision || item.confidence >= REVENUE_REVIEW_THRESHOLD) return item;
    resolved++;
    const hasDeterministicCommercialSignal = item.rule_codes.some((code) =>
      code === 'GENERIC_PAYMENT' || code === 'GENERIC_SERVICE');
    const unsafeBusinessPromotion = decision.label === 'business_revenue' && !hasDeterministicCommercialSignal;
    const effectiveLabel: RevenueLabel = decision.label === 'review' ||
      decision.confidence < REVENUE_REVIEW_THRESHOLD || unsafeBusinessPromotion
      ? 'review'
      : decision.label;
    return {
      ...item,
      label: effectiveLabel,
      confidence: unsafeBusinessPromotion ? Math.min(84, Math.round(decision.confidence)) : Math.round(decision.confidence),
      source: 'llm_adjudication' as const,
      explanation_vi: unsafeBusinessPromotion
        ? `LLM đề xuất doanh thu nhưng rule engine không có bằng chứng thương mại độc lập; giữ lại để rà soát. ${decision.explanation_vi}`
        : decision.explanation_vi,
      requires_review: effectiveLabel === 'review',
    };
  });
  return {
    ...revenue,
    classifications,
    llm_adjudication: {
      requested,
      resolved,
      failed: Math.max(failed, requested - resolved),
      model_used: requested > 0,
    },
    ...summarizeRevenue(classifications, transactions),
  };
}

function buildWorkingRows(
  analysis: StatementAnalysisResult,
  enrichment: StatementEnrichmentResult,
): WorkingRow[] {
  return enrichment.transactions.map((enriched) => {
    const tx = analysis.data_raw[enriched.source_index - 1];
    const date = parseVNDate(tx.transaction_date);
    return {
      tx,
      enriched,
      amountIn: parseAmount(tx.credit) ?? 0,
      amountOut: parseAmount(tx.debit) ?? 0,
      balance: parseAmount(tx.balance),
      epochDay: date?.epochDay ?? null,
      monthKey: date?.monthKey ?? null,
    };
  });
}

function amountsClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) <= Math.max(1_000, Math.max(a, b) * AMOUNT_MATCH_TOLERANCE);
}

function robustLargeAmount(rows: WorkingRow[]): number {
  const values = rows.flatMap((row) => [row.amountIn, row.amountOut]).filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length === 0) return MIN_LARGE_AMOUNT;
  const q75 = quantileSorted(values, 0.75);
  return Math.max(MIN_LARGE_AMOUNT, q75);
}

function makeFinding(
  id: string,
  category: FraudFinding['category'],
  severity: FraudSeverity,
  title: string,
  detail: string,
  rows: WorkingRow[],
  evidence: Record<string, unknown>,
): FraudFinding {
  return {
    id,
    category,
    severity,
    title,
    detail,
    transaction_ids: rows.map((row) => row.enriched.transaction_id),
    txIndexes: rows.map((row) => row.enriched.source_index),
    evidence,
  };
}

function computeAdjustedBalance(
  analysis: StatementAnalysisResult,
  rows: WorkingRow[],
  suspiciousIds: Set<string>,
): FraudDetectionResult['adjusted_balance'] {
  if (suspiciousIds.size === 0) {
    return {
      original_selected_avg_sdbq: analysis.selected_window.avg_sdbq,
      adjusted_selected_avg_sdbq: analysis.selected_window.avg_sdbq,
      monthly: analysis.monthly_balances.map((item) => ({
        month: item.month,
        original_sdbq: item.sdbq,
        adjusted_sdbq: item.sdbq,
      })),
    };
  }

  const selectedMonths = new Set(analysis.monthly_balances.map((item) => item.month));
  const balanceExcludedIndexes = new Set(analysis.ocr_quality_detail?.balance_excluded_indexes ?? []);
  const chronological = [...rows].filter((row) => row.epochDay != null).sort((a, b) =>
    (a.epochDay! - b.epochDay!) || (a.enriched.source_index - b.enriched.source_index));
  let suspiciousNet = 0;
  const adjustedByMonth = new Map<string, number[]>();
  for (const row of chronological) {
    if (suspiciousIds.has(row.enriched.transaction_id)) suspiciousNet += row.amountIn - row.amountOut;
    if (balanceExcludedIndexes.has(row.enriched.source_index)) continue;
    if (row.balance == null || !row.monthKey || !selectedMonths.has(row.monthKey)) continue;
    const values = adjustedByMonth.get(row.monthKey) ?? [];
    values.push(row.balance - suspiciousNet);
    adjustedByMonth.set(row.monthKey, values);
  }

  const monthly = analysis.monthly_balances.map((item) => {
    const values = adjustedByMonth.get(item.month) ?? [];
    const adjusted = values.length > 0 ? (Math.min(...values) + Math.max(...values)) / 2 : item.sdbq;
    return { month: item.month, original_sdbq: item.sdbq, adjusted_sdbq: adjusted };
  });
  const adjustedValues = monthly.map((item) => item.adjusted_sdbq).filter((v): v is number => v != null);
  return {
    original_selected_avg_sdbq: analysis.selected_window.avg_sdbq,
    adjusted_selected_avg_sdbq: adjustedValues.length > 0
      ? adjustedValues.reduce((sum, value) => sum + value, 0) / adjustedValues.length
      : analysis.selected_window.avg_sdbq,
    monthly,
  };
}

interface TransferPair {
  incoming: WorkingRow;
  outgoing: WorkingRow;
}

function lowerBoundByAmount(rows: WorkingRow[], target: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].amountOut < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Greedy one-to-one matching: each outgoing row can offset at most one incoming row. */
function matchTransfersOneToOne(
  entityRows: WorkingRow[],
  maxDays: number,
  predicate?: (incoming: WorkingRow, outgoing: WorkingRow) => boolean,
): TransferPair[] {
  const incoming = entityRows
    .filter((row) => row.amountIn > 0 && row.epochDay != null)
    .sort((a, b) => (a.epochDay! - b.epochDay!) || a.enriched.source_index - b.enriched.source_index);
  const outgoing = entityRows
    .filter((row) => row.amountOut > 0 && row.epochDay != null)
    .sort((a, b) => a.amountOut - b.amountOut);
  const consumed = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const input of incoming) {
    const minAmount = input.amountIn * (1 - AMOUNT_MATCH_TOLERANCE);
    const maxAmount = input.amountIn / (1 - AMOUNT_MATCH_TOLERANCE);
    let best: WorkingRow | null = null;
    let bestScore = Infinity;
    for (let index = lowerBoundByAmount(outgoing, minAmount); index < outgoing.length; index++) {
      const output = outgoing[index];
      if (output.amountOut > maxAmount) break;
      if (consumed.has(output.enriched.transaction_id) || !amountsClose(input.amountIn, output.amountOut)) continue;
      const dayGap = Math.abs(output.epochDay! - input.epochDay!);
      if (dayGap > maxDays || (predicate && !predicate(input, output))) continue;
      const score = dayGap * 10 + Math.abs(input.amountIn - output.amountOut) / Math.max(input.amountIn, output.amountOut);
      if (score < bestScore) {
        best = output;
        bestScore = score;
      }
    }
    if (best) {
      consumed.add(best.enriched.transaction_id);
      pairs.push({ incoming: input, outgoing: best });
    }
  }
  return pairs;
}

export function detectFraudAndAnomalies(
  analysis: StatementAnalysisResult,
  enrichment: StatementEnrichmentResult,
  revenue: RevenueNormalizationResult,
): FraudDetectionResult {
  const rows = buildWorkingRows(analysis, enrichment);
  const findings: FraudFinding[] = [];
  const graph = new MultiDirectedGraph();
  const accountNode = `account:${analysis.account_no ?? 'unknown'}`;
  graph.addNode(accountNode, { type: 'account' });

  const byEntity = new Map<string, WorkingRow[]>();
  for (const row of rows) {
    const entityId = row.enriched.counterparty.entity_id;
    if (!entityId || row.enriched.counterparty.is_account_holder) continue;
    const node = `counterparty:${entityId}`;
    if (!graph.hasNode(node)) graph.addNode(node, { type: 'counterparty' });
    const direction = row.amountIn > 0 ? 'in' : row.amountOut > 0 ? 'out' : null;
    if (direction) {
      graph.addDirectedEdgeWithKey(
        row.enriched.transaction_id,
        direction === 'in' ? node : accountNode,
        direction === 'in' ? accountNode : node,
        { amount: direction === 'in' ? row.amountIn : row.amountOut, epochDay: row.epochDay },
      );
    }
    const list = byEntity.get(entityId) ?? [];
    list.push(row);
    byEntity.set(entityId, list);
  }

  const largeThreshold = robustLargeAmount(rows);
  const windowPairs: TransferPair[] = [];
  const roundTripPairs: TransferPair[] = [];

  for (const entityRows of byEntity.values()) {
    roundTripPairs.push(...matchTransfersOneToOne(entityRows, ROUND_TRIP_HOURS / 24));
    windowPairs.push(...matchTransfersOneToOne(entityRows, 6, (input, output) => {
      const inDate = parseVNDate(input.tx.transaction_date);
      const outDate = parseVNDate(output.tx.transaction_date);
      return !!inDate && !!outDate &&
        inDate.month === 12 && inDate.day >= 28 &&
        outDate.year === inDate.year + 1 && outDate.month === 1 && outDate.day <= 3 &&
        input.amountIn >= largeThreshold && output.epochDay! >= input.epochDay!;
    }));
  }

  if (windowPairs.length > 0) {
    const pairRows = [...new Map(windowPairs
      .flatMap((pair) => [pair.incoming, pair.outgoing])
      .map((row) => [row.enriched.transaction_id, row])).values()];
    findings.push(makeFinding(
      'window-dressing-year-end', 'window_dressing', 'high',
      `Làm đẹp số dư quanh ngày chốt năm (${windowPairs.length} cặp)`,
      'Phát hiện tiền vào lớn từ cùng một đối tác trong 28–31/12 và rút gần tương ứng trước hoặc trong 03/01. Các dòng này được loại khỏi SDBQ điều chỉnh.',
      pairRows,
      { pair_count: windowPairs.length, large_amount_threshold: largeThreshold, amount_tolerance: AMOUNT_MATCH_TOLERANCE },
    ));
  }

  if (roundTripPairs.length > 0) {
    const pairRows = [...new Map(roundTripPairs
      .flatMap((pair) => [pair.incoming, pair.outgoing])
      .map((row) => [row.enriched.transaction_id, row])).values()];
    findings.push(makeFinding(
      'observed-round-trip-72h', 'round_trip', 'high',
      `Dòng tiền quay vòng quan sát được (${roundTripPairs.length} cặp)`,
      'Phát hiện hai chiều giữa tài khoản và cùng một đối tác, số tiền gần bằng trong tối đa 72 giờ. Tiền vào liên quan được loại khỏi doanh thu chuẩn hóa.',
      pairRows,
      { pair_count: roundTripPairs.length, max_hours: ROUND_TRIP_HOURS, amount_tolerance: AMOUNT_MATCH_TOLERANCE },
    ));
  }

  let behaviorMatches = 0;
  for (const rule of BEHAVIOR_RULES) {
    const matches = rows.filter((row) => rule.pattern.test(transactionText(row.tx, row.enriched)));
    if (matches.length === 0) continue;
    behaviorMatches += matches.length;
    findings.push(makeFinding(
      `behavior-${rule.code.toLowerCase()}`, 'behavior', rule.severity, rule.title,
      `Có ${matches.length} giao dịch khớp danh mục từ khóa hành vi rủi ro; cần đối chiếu chứng từ và mục đích giao dịch.`,
      matches,
      { rule_code: rule.code, deterministic_keyword_match: true },
    ));
  }

  const salaryIds = new Set(revenue.classifications
    .filter((item) => item.label === 'personal_income')
    .map((item) => item.transaction_id));
  const lowBeforeSalary: WorkingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const current = rows[i];
    if (!salaryIds.has(current.enriched.transaction_id)) continue;
    const previous = rows[i - 1];
    if (previous.balance != null && previous.balance <= Math.max(100_000, current.amountIn * 0.05)) {
      lowBeforeSalary.push(previous, current);
    }
  }
  if (lowBeforeSalary.length > 0) {
    const unique = [...new Map(lowBeforeSalary.map((row) => [row.enriched.transaction_id, row])).values()];
    findings.push(makeFinding(
      'near-zero-before-income', 'behavior', 'medium', 'Số dư gần 0 trước kỳ nhận thu nhập',
      'Số dư ngay trước một hoặc nhiều khoản thu nhập không vượt quá 5% khoản nhận (tối thiểu 100.000), cho thấy biên thanh khoản thấp.',
      unique,
      { threshold: 'max(100000, income * 5%)' },
    ));
  }

  const amounts = rows.flatMap((row) => [row.amountIn, row.amountOut]).filter((value) => value > 0).sort((a, b) => a - b);
  let statisticalOutliers = 0;
  if (amounts.length >= 5) {
    const med = median(amounts);
    const deviations = amounts.map((value) => Math.abs(value - med)).sort((a, b) => a - b);
    const mad = median(deviations);
    const threshold = mad > 0 ? med + 6 * mad : Math.max(largeThreshold, med * 5);
    const outliers = rows.filter((row) => Math.max(row.amountIn, row.amountOut) >= threshold);
    statisticalOutliers = outliers.length;
    if (outliers.length > 0) {
      findings.push(makeFinding(
        'robust-amount-outliers', 'statistical', 'medium', `Giao dịch lệch chuẩn mạnh (${outliers.length})`,
        'Số tiền vượt ngưỡng robust median + 6×MAD của chính sao kê; đây là tín hiệu rà soát, không tự kết luận gian lận.',
        outliers,
        { median: med, median_absolute_deviation: mad, threshold },
      ));
    }
  }

  const balanceBreakIndexes = analysis.ocr_quality_detail?.balance_breaks?.map((item) => item.index) ?? [];
  if (balanceBreakIndexes.length > 0) {
    const affected = rows.filter((row) => balanceBreakIndexes.includes(row.enriched.source_index));
    findings.push(makeFinding(
      'balance-chain-data-quality', 'data_quality', 'high', 'Dữ liệu số dư không khớp chuỗi',
      'Các kết luận downstream có thể sai do OCR thiếu dòng hoặc đọc sai số; cần kiểm tra bản gốc.',
      affected,
      { balance_break_count: balanceBreakIndexes.length },
    ));
  }

  const windowRows = windowPairs.flatMap((pair) => [pair.incoming, pair.outgoing]);
  const windowIds = new Set(windowRows.map((row) => row.enriched.transaction_id));
  const roundTripRevenueIds = new Set(roundTripPairs.map((pair) => pair.incoming.enriched.transaction_id));
  const windowRevenueIds = windowPairs.map((pair) => pair.incoming.enriched.transaction_id);
  const revenueExclusions = new Set([...roundTripRevenueIds, ...windowRevenueIds]);

  const severityOrder: Record<FraudSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    version: STATEMENT_INTELLIGENCE_VERSION,
    engine: {
      runtime: 'typescript',
      libraries: ['graphology@0.26.0', 'simple-statistics@7.8.8', 'zod@3.25.76'],
      observed_graph_nodes: graph.order,
      observed_graph_edges: graph.size,
      limitations: [
        'Sao kê một tài khoản chỉ chứng minh được cạnh đi/đến tài khoản đó; không thể khẳng định chu trình A→B→C→A nếu thiếu sao kê B và C.',
        'Dữ liệu OCR hiện chỉ có ngày, nên cửa sổ 72 giờ được đánh giá với độ phân giải theo ngày.',
        'Kết quả là tín hiệu hỗ trợ rà soát, không phải kết luận gian lận hay AML.',
      ],
    },
    findings,
    exclusions: {
      revenue_transaction_ids: [...revenueExclusions],
      average_balance_transaction_ids: [...windowIds],
    },
    adjusted_balance: computeAdjustedBalance(analysis, rows, windowIds),
    metrics: {
      window_dressing_pairs: windowPairs.length,
      observed_round_trip_pairs: roundTripPairs.length,
      behavior_matches: behaviorMatches,
      statistical_outliers: statisticalOutliers,
    },
  };
}

export function applyFraudExclusionsToRevenue(
  revenue: RevenueNormalizationResult,
  transactions: StatementTransaction[],
  fraud: FraudDetectionResult,
): RevenueNormalizationResult {
  const excluded = new Set(fraud.exclusions.revenue_transaction_ids);
  return { ...revenue, ...summarizeRevenue(revenue.classifications, transactions, excluded) };
}
