'use client';

import { ScanText } from 'lucide-react';
import type { DossierEvidence } from '@/app/loan-appraisal/types';
import { evidenceFields } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Disclosure } from '../ui/Disclosure';

/** "N bản thể · x lỗi · y nhận nhầm loại": bản không thấy mẫu biểu không phải lỗi đọc. */
function ocrSubtitle(evidences: DossierEvidence[]): string {
  const wrong = evidences.filter((e) => e.reason_code === 'FORM_NOT_FOUND').length;
  const errors = evidences.filter((e) => e.status === 'ERROR').length - wrong;
  return [`${evidences.length} bản thể`, `${errors} lỗi`, wrong ? `${wrong} nhận nhầm loại` : ''].filter(Boolean).join(' · ');
}

/** Kết quả OCR theo evidence của S2 (V2-R10): mỗi bản thể chứng từ một khối, lá có nhãn + giá trị + trang nguồn. */
export function OcrResults({ evidences }: { evidences: DossierEvidence[] }) {
  if (evidences.length === 0) return null;
  return (
    <Card labelledBy="la2-ocr-title">
      <CardHeader id="la2-ocr-title" icon={ScanText} title="Kết quả OCR theo chứng từ" subtitle={ocrSubtitle(evidences)} />
      <CardBody>
        <div className="space-y-2">
          {evidences.map((e) => {
            const rows = evidenceFields(e);
            const where = `${e.file_name}${e.instance_index > 1 ? ` (bản ${e.instance_index})` : ''} · tr.${e.page_range[0]}–${e.page_range[1]}`;
            // S4-R26: bản không thấy mẫu biểu → không gắn nhãn loại sai lên file.
            const head = e.reason_code === 'FORM_NOT_FOUND' ? `${where} · không phải "${e.doc_type_label}"` : `${e.doc_type_label} · ${where}`;
            return (
              <Disclosure key={e.evidence_id} defaultOpen lazy={false} summary={head}>
                {e.status === 'ERROR' && e.reason_code === 'FORM_NOT_FOUND'
                  ? <p className="text-xs"><Badge tone="neutral">Nhận diện nhầm loại</Badge> Không phải &ldquo;{e.doc_type_label}&rdquo;: bước đọc không thấy mẫu này ở tr.{e.page_range[0]}–{e.page_range[1]}. Không tính vào checklist.</p>
                  : e.status === 'ERROR'
                  ? <p className="text-xs"><Badge tone="warning">Không đọc được</Badge> {e.message ?? e.reason_code}</p>
                  : (
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                      {rows.map((r) => (
                        <div key={r.path} className="contents">
                          <dt className="text-muted-foreground">{r.label}</dt>
                          <dd className="break-words">
                            {r.value}
                            {r.confidence !== null && r.confidence < 0.8 && <span className="ml-1"><Badge tone="warning">cần kiểm tra</Badge></span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                {e.reason_code === 'REQUIRED_FIELD_UNREADABLE' && <p className="mt-2 text-xs text-muted-foreground">Không đọc được trường định danh bắt buộc.</p>}
                {e.reason_code === 'FIELD_FORMAT_INVALID' && <p className="mt-2 text-xs text-muted-foreground">Một số trường sai định dạng nên để trống, cần kiểm tra trên chứng từ: {e.message}</p>}
              </Disclosure>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
