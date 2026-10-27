// app/api/statement-analyze/ask/route.ts
// Q&A tương tác trên dữ liệu sao kê ĐÃ phân tích.
// Nhận { question, csv, summary, mode } → build prompt → gọi connector LLM đồng bộ
// (generate:report = ext-content-gen; risk = ext-quality-eval) → trả { answer }.
//
// Dữ liệu giao dịch được gửi dạng CSV rút gọn (đã bỏ cột null ở client) để giảm token.

import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { BASE_TYPE_URI } from '@/lib/errors';
import { resolveCallerIdentity } from '@/lib/auth-resolve-key';
import { runConnectorPrompt } from '@/lib/pipelines/run-connector-prompt';
import { resolveStatementAskOverride } from '@/lib/pipelines/statement-ask-config';
import { buildStatementQaPrompt, buildStatementRiskPrompt } from '@/lib/pipelines/workflows/prompts/statement-analyze-prompts';

export const dynamic = 'force-dynamic';

const MAX_QUESTION = 2000;
const MAX_CSV = 200_000;
const MAX_SUMMARY = 8000;

// Connector cho từng chế độ. 'qa' dùng generate (kể/phân tích số liệu như chuyên gia);
// 'risk' dùng analyze:risk. Đổi slug ở đây nếu hạ tầng dùng connector khác.
const MODE_CONNECTOR: Record<string, string> = {
  qa: 'ext-content-gen',
  risk: 'ext-quality-eval',
};

const RISK_PRESET_QUESTION =
  'Đánh giá RỦI RO tổng thể của tài khoản dựa trên sao kê: (1) tính ổn định dòng tiền, ' +
  '(2) dấu hiệu chia nhỏ/cấu trúc hoá giao dịch, (3) dòng tiền vào–ra nhanh (trung chuyển), ' +
  '(4) "làm đẹp" số dư sát cuối kỳ, (5) mức độ tập trung đối tác, (6) các cờ đỏ khác. ' +
  'Kết luận bằng một xếp hạng rủi ro (Thấp/Trung bình/Cao) kèm lý do và các giao dịch dẫn chứng.';

function jsonError(status: number, title: string, detail: string) {
  return NextResponse.json(
    { type: `${BASE_TYPE_URI}/error`, title, status, detail },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const logger = new Logger({ correlationId, service: 'statement-ask' });

  try {
    // ── Auth: yêu cầu người dùng đăng nhập hoặc API key hợp lệ ──
    const { apiKeyId, userId } = await resolveCallerIdentity(req);
    if (!apiKeyId && !userId) {
      return jsonError(401, 'Unauthorized', 'Cần đăng nhập để sử dụng chức năng hỏi đáp.');
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Invalid Body', 'Body phải là JSON.');
    }

    const mode = body?.mode === 'risk' ? 'risk' : 'qa';
    const rawQuestion = typeof body?.question === 'string' ? body.question.trim() : '';
    const question = mode === 'risk' && !rawQuestion ? RISK_PRESET_QUESTION : rawQuestion;
    const csv = typeof body?.csv === 'string' ? body.csv : '';
    const summary = typeof body?.summary === 'string' ? body.summary : '';

    if (!question) {
      return jsonError(400, 'Missing Question', 'Thiếu câu hỏi (question).');
    }
    if (question.length > MAX_QUESTION) {
      return jsonError(400, 'Question Too Long', `Câu hỏi vượt ${MAX_QUESTION} ký tự.`);
    }
    if (!csv) {
      return jsonError(400, 'Missing Data', 'Thiếu dữ liệu giao dịch (csv).');
    }

    // Cắt bớt để tránh vượt context (ưu tiên giữ đầu — thường là kỳ gần nhất/đủ ngữ cảnh).
    let usedCsv = csv;
    let truncated = false;
    if (usedCsv.length > MAX_CSV) {
      usedCsv = usedCsv.slice(0, MAX_CSV);
      truncated = true;
    }
    const usedSummary = summary.slice(0, MAX_SUMMARY);

    const slug = MODE_CONNECTOR[mode];

    // Override prompt/model do ADMIN cấu hình trong Profile (nếu có apiKey).
    const step = mode === 'risk' ? 'statement_risk' : 'statement_qa';
    const { promptOverride, modelOverride } = await resolveStatementAskOverride(apiKeyId, step);

    const prompt = mode === 'risk'
      ? buildStatementRiskPrompt(question, usedCsv, usedSummary, promptOverride)
      : buildStatementQaPrompt(question, usedCsv, usedSummary, promptOverride);

    logger.info(`[STATEMENT_ASK] mode=${mode} slug=${slug} qLen=${question.length} csvLen=${usedCsv.length} truncated=${truncated} promptOverride=${!!promptOverride} modelOverride=${modelOverride ?? '-'}`);

    const { content, modelUsed } = await runConnectorPrompt(slug, prompt, { model: modelOverride, correlationId });

    return NextResponse.json({
      answer: content,
      model: modelUsed,
      mode,
      truncated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[STATEMENT_ASK] failed', { correlationId }, err);
    // Lỗi cấu hình connector → 503 để UI báo rõ; còn lại 500.
    const isConfig = msg.startsWith('CONNECTOR_NOT_FOUND') || msg.startsWith('CONNECTOR_DISABLED');
    return jsonError(
      isConfig ? 503 : 500,
      isConfig ? 'Service Unavailable' : 'Internal Error',
      isConfig ? 'Chức năng hỏi đáp chưa sẵn sàng (connector chưa cấu hình).' : `Không xử lý được câu hỏi. Ref: ${correlationId}`,
    );
  }
}
