'use client';

// Trợ lý hiệu chỉnh (COR-R18…R21; T-COR-08): người thẩm định mô tả bằng lời, hệ thống đề xuất từng hiệu chỉnh để Đồng ý / Bỏ.
// Không đề xuất nào tự áp: bản đồng ý vào cùng khay với hiệu chỉnh tay. Chỉ thị không lưu ở đâu ngoài state của trang.
import { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { AppraisalResult } from '@/app/loan-appraisal/types';
import { getOperation, submitCorrectionDraft } from '@/app/loan-appraisal-v2/lib/api';
import { KIND_LABELS, newCorrectionId, type Correction } from '@/app/loan-appraisal-v2/lib/corrections';
import { DRAFT_INPUT_CONTRACT, MAX_INSTRUCTION_LENGTH, type CorrectionDraft } from '@/lib/loan-dossier/corrections/draft';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { FOCUS_RING } from '../ui/toneClasses';

const INPUT = `w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground disabled:opacity-60 ${FOCUS_RING}`;
const POLL_MS = 1500;
const MAX_POLLS = 80;

const STATUS: Record<CorrectionDraft['status'], { label: string; tone: 'info' | 'warning' | 'success' | 'danger' }> = {
  PROPOSED: { label: 'Đề xuất', tone: 'info' },
  NEEDS_CLARIFICATION: { label: 'Cần làm rõ', tone: 'warning' },
  NO_CHANGE: { label: 'Không cần sửa', tone: 'success' },
  REJECTED: { label: 'Không dùng được', tone: 'danger' },
};

async function waitForDrafts(id: string, apiKey: string | undefined): Promise<CorrectionDraft[]> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const op = await getOperation(id, { apiKey }) as { done?: boolean; metadata?: { state?: string }; result?: { extracted_data?: { drafts?: CorrectionDraft[] } }; error?: { message?: string } };
    if (op.metadata?.state === 'FAILED' || op.metadata?.state === 'CANCELLED') throw new Error(op.error?.message ?? 'Trợ lý không chạy được');
    if (op.done) return op.result?.extracted_data?.drafts ?? [];
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Trợ lý chạy quá lâu, thử lại sau');
}

export function CorrectionAssistant({ result, apiKey, author, onAccept }: {
  result: AppraisalResult;
  apiKey?: string;
  /** Người sửa (bắt buộc trước khi đồng ý). */
  author: string;
  onAccept: (c: Correction) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [drafts, setDrafts] = useState<Array<CorrectionDraft & { decided?: 'ok' | 'no' }>>([]);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const sealed = Boolean(result.case_seal);

  const run = async () => {
    if (!instruction.trim()) { setMessage('Nhập ít nhất một câu mô tả'); return; }
    setState('running'); setMessage(null); setDrafts([]);
    try {
      const input = { contract: DRAFT_INPUT_CONTRACT, contract_version: '1.0', documents: result.documents, dossier_precheck: result.dossier_precheck ?? null, case_seal: result.case_seal, instruction: instruction.trim() };
      const id = await submitCorrectionDraft(new File([JSON.stringify(input)], 'correction_draft.json', { type: 'application/json' }), apiKey);
      setDrafts(await waitForDrafts(id, apiKey));
      setState('idle');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Trợ lý không chạy được');
    }
  };
  const accept = (i: number) => {
    const d = drafts[i];
    if (!d.correction) return;
    if (!author.trim()) { setMessage('Nhập người sửa trong khay bên dưới trước khi đồng ý'); return; }
    onAccept({ ...d.correction, correction_id: newCorrectionId(), reason: (d.quote || instruction).slice(0, 500), corrected_by: author.trim(), corrected_at: new Date().toISOString() } as Correction);
    setDrafts(drafts.map((x, k) => (k === i ? { ...x, decided: 'ok' } : x)));
  };

  return (
    <section aria-label="Trợ lý hiệu chỉnh" className="rounded-lg border border-border p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="h-3.5 w-3.5" aria-hidden />Mô tả điều cần sửa</h4>
      <textarea className={`${INPUT} min-h-[64px]`} value={instruction} maxLength={MAX_INSTRUCTION_LENGTH} disabled={!sealed || state === 'running'}
        placeholder="Số CCCD của khách vay đúng là 001090000001. Ông Hùng sinh 1965 không phải khách vay."
        onChange={(e) => { setInstruction(e.target.value); setMessage(null); }} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Hệ thống chỉ đề xuất. Bạn duyệt từng mục trước khi tính lại.</span>
        <Button size="sm" disabled={!sealed || state === 'running'} onClick={() => { void run(); }}><Sparkles className="h-3.5 w-3.5" aria-hidden />{state === 'running' ? 'Đang đề xuất…' : 'Đề xuất hiệu chỉnh'}</Button>
      </div>
      {message && <p className="mt-1 text-xs text-[rgb(var(--la2-danger))]">{message}</p>}
      {drafts.length > 0 && (
        <ul className="mt-3 space-y-2 text-xs">
          {drafts.map((d, i) => (
            <li key={i} className="flex flex-wrap items-start gap-2 border-t border-border pt-2">
              <Badge tone={STATUS[d.status].tone}>{d.correction ? KIND_LABELS[d.correction.kind] : STATUS[d.status].label}</Badge>
              <div className="min-w-0 flex-1">
                <p>{d.summary}</p>
                {d.quote && <p className="text-[11px] text-muted-foreground">Từ câu: &ldquo;{d.quote}&rdquo;</p>}
                {d.note && <p className="text-[11px] text-muted-foreground">{d.note}</p>}
              </div>
              {d.status === 'PROPOSED' && !d.decided && (
                <>
                  <Button size="sm" variant="primary" onClick={() => accept(i)}><Check className="h-3.5 w-3.5" aria-hidden />Đồng ý</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDrafts(drafts.map((x, k) => (k === i ? { ...x, decided: 'no' } : x)))}><X className="h-3.5 w-3.5" aria-hidden />Bỏ</Button>
                </>
              )}
              {d.decided === 'ok' && <span className="text-[rgb(var(--la2-success))]">Đã thêm vào khay</span>}
              {d.decided === 'no' && <span className="text-muted-foreground">Đã bỏ</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
