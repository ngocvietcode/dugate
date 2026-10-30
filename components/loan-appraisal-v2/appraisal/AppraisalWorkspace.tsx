'use client';

import { useState } from 'react';
import { BarChart3, Pencil, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import type { AppraisalResult, DossierEvidence } from '@/app/loan-appraisal/types';
import { Badge } from '../ui/Badge';
import { Card, CardBody } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Tabs, panelProps } from '../ui/Tabs';
import { OcrResults } from '../intake/OcrResults';
import { hasDossierCheckResults } from '@/app/loan-appraisal-v2/lib/selectors';
import { CorrectionsPanel } from './CorrectionsPanel';
import { CustomerProfile } from './CustomerProfile';
import { DecisionCockpit } from './DecisionCockpit';
import { FindingsPanel } from './FindingsPanel';
import { PolicyPanel } from './PolicyPanel';
import { ProvisionalBanner } from './ProvisionalBanner';
import { RecommendationPanel } from './RecommendationPanel';

type View = 'profile' | 'controls' | 'decision' | 'corrections';
const PREFIX = 'la2-appraisal';
const TABS = [
  { id: 'profile' as const, label: 'Hồ sơ khách hàng', icon: UserRound },
  { id: 'controls' as const, label: 'Kiểm tra theo rule', icon: ShieldCheck },
  { id: 'decision' as const, label: 'Rủi ro & khuyến nghị', icon: BarChart3 },
  { id: 'corrections' as const, label: 'Hiệu chỉnh', icon: Pencil },
];

/** Kết quả V1 cũ (không có output_version): chỉ có tóm tắt hợp nhất. */
function LegacySummary({ result }: { result: AppraisalResult }) {
  return (
    <Card labelledBy="la2-legacy-title">
      <CardBody>
        <Badge tone="info">Kết quả V1 tương thích</Badge>
        <h3 id="la2-legacy-title" className="mt-3 text-xl font-semibold">Kết quả hợp nhất hồ sơ</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Kết quả phiên bản cũ: chỉ hiển thị độ đầy đủ hồ sơ.</p>
        <p className="mt-3 text-sm">Độ đầy đủ: <strong className="tabular-nums">{result.completeness_percent}%</strong></p>
      </CardBody>
    </Card>
  );
}

/** Giai đoạn 2. Luôn xem được, kể cả khi hồ sơ chưa đủ chứng từ. */
export function AppraisalWorkspace({ result, extraction = null, onRecompute, busy = false }: {
  result: AppraisalResult | null;
  /** OCR giữa chừng (từ checkpoint bước 1) để tab Hồ sơ khách hàng hiện sớm khi giai đoạn 2 đang chạy; kết quả cuối ưu tiên hơn. */
  extraction?: DossierEvidence[] | null;
  /** COR-R16: gửi case_input.json để tính lại sau hiệu chỉnh. */
  onRecompute?: (file: File) => void;
  busy?: boolean;
}) {
  const [view, setView] = useState<View>('profile');
  if (!result) {
    return <EmptyState icon={Sparkles} title="Chưa có kết quả thẩm định">Tải hồ sơ và chạy pipeline để xem chỉ số tài chính, kết quả các rule và khuyến nghị.</EmptyState>;
  }
  // D-51: mới xong giai đoạn 1 — giai đoạn 2 chưa chạy hoặc đang chạy, chưa có chỉ số/khuyến nghị.
  if (result.result_phase === 'DOSSIER_INTAKE') {
    return (
      <div className="space-y-4">
        <EmptyState icon={Sparkles} title="Giai đoạn 2 chưa có kết quả">
          Giai đoạn 2 (OCR, tài chính, rule engine & rule LLM, khuyến nghị) chỉ chạy khi bấm &ldquo;Chuyển sang giai đoạn 2&rdquo; ở giai đoạn 1. Nếu vừa bấm, kết quả sẽ hiện khi chạy xong.
        </EmptyState>
        {extraction && extraction.length > 0 && <OcrResults evidences={extraction} />}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ProvisionalBanner result={result} onGoToProfile={() => setView('profile')} />
      {!result.output_version ? <LegacySummary result={result} /> : (
        <>
          <ErrorBoundary label="Decision cockpit"><DecisionCockpit result={result} /></ErrorBoundary>
          <Card>
            <Tabs items={TABS} active={view} onChange={setView} label="Chi tiết thẩm định" idPrefix={PREFIX} />
            <div {...panelProps(PREFIX, view)} className={`${panelProps(PREFIX, view).className} p-4 sm:p-5`}>
              <ErrorBoundary label="Chi tiết thẩm định" key={view}>
                {view === 'profile' && <CustomerProfile result={result} evidences={result.documents?.evidences?.length ? result.documents.evidences : extraction ?? undefined} />}
                {view === 'controls' && (
                  <div className="space-y-8">
                    <PolicyPanel result={result} />
                    {hasDossierCheckResults(result) && <div className="border-t border-border pt-6"><FindingsPanel result={result} /></div>}
                  </div>
                )}
                {view === 'decision' && (
                  <RecommendationPanel result={result} />
                )}
                {view === 'corrections' && <CorrectionsPanel result={result} onRecompute={onRecompute} busy={busy} />}
              </ErrorBoundary>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
