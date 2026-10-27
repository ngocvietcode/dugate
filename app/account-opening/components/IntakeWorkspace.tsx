'use client';

// Giai đoạn 1: tiếp nhận và hoàn thiện hồ sơ mở tài khoản.
// Trọng tâm là việc cần làm để hồ sơ đủ điều kiện, không phải dữ liệu kỹ thuật.
// Lưu ý nghiệp vụ: hồ sơ chưa đầy đủ KHÔNG bị chặn, vẫn được đánh giá tiếp.

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  FileCheck2,
  FileQuestion,
  Fingerprint,
  GitCompareArrows,
  Info,
  ListChecks,
  ScanSearch,
  XCircle,
} from 'lucide-react';
import type { AccountOpeningResult, ClassifiedDoc, ExtractedDoc } from '../types';
import { PROFILE_GROUPS, type ChecklistTemplateItem, type ProductTemplate, type SegmentTemplate } from '../segments';
import {
  ChecklistStatusIcon,
  DetailField,
  EmptyInline,
  SURFACE,
  StatusBadge,
  checklistStatusLabel,
  checklistTone,
  filesForKey,
  readinessMeta,
  renderValue,
  safeArray,
  statusToneClass,
  type StatusTone,
} from './primitives';

interface IntakeWorkspaceProps {
  segment: SegmentTemplate;
  product: ProductTemplate;
  template: ChecklistTemplateItem[];
  classification: ClassifiedDoc[] | null;
  extraction: ExtractedDoc[] | null;
  result: AccountOpeningResult | null;
  onGoToAssessment: () => void;
}

export function IntakeWorkspace({
  segment,
  product,
  template,
  classification,
  extraction,
  result,
  onGoToAssessment,
}: IntakeWorkspaceProps) {
  const readiness = result?.dossier_readiness;
  const meta = readinessMeta(readiness?.status);
  const supplements = safeArray(readiness?.supplement_requests);
  const conflicts = safeArray(readiness?.conflicts);
  const unclassified = safeArray(readiness?.unclassified_files);
  const extractionErrors = safeArray(readiness?.extraction_errors);
  const extractedDocs = safeArray(extraction);
  const classifiedDocs = safeArray(classification);

  if (!result && extractedDocs.length === 0 && classifiedDocs.length === 0) {
    return <EmptyInline icon={ScanSearch} text="Tải hồ sơ và bắt đầu để xem kết quả tiếp nhận." />;
  }

  return (
    <div className="space-y-6">
      <section className={`rounded-2xl border p-5 ${statusToneClass(meta.tone)}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={meta.label} tone={meta.tone} />
              {readiness?.assessment_conditional && <StatusBadge label="Kết quả đánh giá là tạm" tone="warning" />}
              <StatusBadge label={segment.shortName} tone="info" />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">{meta.headline}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-700">
              {readiness?.assessment_conditional
                ? 'Hồ sơ vẫn được đánh giá tiếp và bạn có thể bổ sung chứng từ sau. Kết quả hiện tại là tạm, chưa dùng làm kết luận mở tài khoản.'
                : `Hồ sơ đã có đủ chứng từ theo yêu cầu của sản phẩm ${product.shortName}.`}
            </p>
          </div>
          <div className="grid w-full max-w-sm grid-cols-2 gap-3">
            <DetailField label="Chứng từ bắt buộc" value={readiness ? `${readiness.required_present}/${readiness.required_total}` : '—'} />
            <DetailField label="Độ đầy đủ" value={readiness ? `${readiness.completeness_percent}%` : result ? `${result.completeness_percent}%` : '—'} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onGoToAssessment}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-400 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            Xem kết quả đánh giá
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-slate-600">Giai đoạn đánh giá luôn xem được, kể cả khi hồ sơ chưa đầy đủ.</span>
        </div>
      </section>

      <ChecklistCoverage
        segment={segment}
        template={template}
        classification={classification}
        result={result}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${SURFACE} p-5`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><ListChecks className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Việc cần hoàn tất</h3>
              <p className="mt-0.5 text-[10px] text-slate-500">{supplements.length} nội dung cần bổ sung hoặc làm rõ</p>
            </div>
          </div>
          {supplements.length > 0 ? (
            <ol className="space-y-2">
              {supplements.map((item, index) => (
                <li key={item} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">{index + 1}</span>
                  <p className="text-[11px] leading-5 text-slate-800">{item}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyInline icon={CheckCircle2} text="Không còn nội dung nào cần bổ sung." />
          )}
        </section>

        <section className={`${SURFACE} p-5`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><GitCompareArrows className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Đối chiếu chéo chứng từ</h3>
              <p className="mt-0.5 text-[10px] text-slate-500">{conflicts.length} phát hiện từ so khớp dữ liệu</p>
            </div>
          </div>
          {conflicts.length > 0 ? (
            <ul className="space-y-2.5">
              {conflicts.map((conflict, index) => {
                const tone: StatusTone = conflict.severity === 'error' ? 'danger' : conflict.severity === 'warning' ? 'warning' : 'info';
                return (
                  <li key={`${conflict.title}-${index}`} className={`rounded-xl border p-3 ${statusToneClass(tone)}`}>
                    <div className="flex items-start gap-2">
                      {conflict.severity === 'error'
                        ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        : conflict.severity === 'warning'
                          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{conflict.title}</p>
                        <p className="mt-1 text-[11px] leading-5">{conflict.message}</p>
                        {conflict.documents.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {conflict.documents.map((document) => (
                              <span key={document} className="rounded-md border border-white/40 bg-white/60 px-1.5 py-0.5 font-mono text-[9px]">{document}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyInline icon={CheckCircle2} text="Không phát hiện mâu thuẫn thực chất giữa các chứng từ." />
          )}
        </section>
      </div>

      {(unclassified.length > 0 || extractionErrors.length > 0) && (
        <section className={`${SURFACE} p-5`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><FileQuestion className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tài liệu cần xử lý lại</h3>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {unclassified.length} chưa nhận dạng · {extractionErrors.length} không đọc được dữ liệu
              </p>
            </div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {unclassified.map((item) => (
              <div key={`unclassified-${item.file_name}`} className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                <p className="truncate text-xs font-semibold text-slate-800" title={item.file_name}>{item.file_name}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-600">{item.reason}</p>
              </div>
            ))}
            {extractionErrors.map((item) => (
              <div key={`error-${item.file_name}-${item.doc_type_key}`} className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5">
                <p className="truncate text-xs font-semibold text-slate-800" title={item.file_name}>{item.file_name}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-600">{item.error}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <CustomerProfilePanel result={result} />

      <ExtractedDataPanel extraction={extraction} />
    </div>
  );
}

// ─── Checklist theo phân khúc ─────────────────────────────────────────────────

function ChecklistCoverage({ segment, template, classification, result }: {
  segment: SegmentTemplate;
  template: ChecklistTemplateItem[];
  classification: ClassifiedDoc[] | null;
  result: AccountOpeningResult | null;
}) {
  const checklist = safeArray(result?.checklist);
  const statusByKey = new Map(checklist.map((item) => [item.key, item]));
  const requiredItems = template.filter((item) => item.required);
  const presentRequired = requiredItems.filter((item) => statusByKey.get(item.key)?.status === 'present').length;

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><ListChecks className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Checklist chứng từ · phân khúc {segment.key}</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {presentRequired}/{requiredItems.length} chứng từ bắt buộc đã có · {template.length} loại trong danh mục
            </p>
          </div>
        </div>
        <StatusBadge
          label={presentRequired === requiredItems.length ? 'Đủ chứng từ bắt buộc' : 'Còn thiếu'}
          tone={presentRequired === requiredItems.length ? 'success' : 'warning'}
        />
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        {template.map((item) => {
          const found = statusByKey.get(item.key);
          const files = filesForKey(item.key, classification, result);
          const tone = checklistTone(found?.status);
          return (
            <div key={item.key} className={`rounded-xl border px-3 py-2.5 ${found ? statusToneClass(tone) : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-start gap-2.5">
                <ChecklistStatusIcon status={found?.status} hasFile={files.length > 0} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-900">{item.label}</p>
                    {item.required
                      ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700">Bắt buộc</span>
                      : <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">Tùy chọn</span>}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">{checklistStatusLabel(found?.status, files.length > 0)}</p>
                  {files.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {files.map((file) => (
                        <span key={file} className="max-w-full truncate rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-600" title={file}>{file}</span>
                      ))}
                    </div>
                  )}
                  {found?.note && <p className="mt-1.5 text-[10px] leading-4 text-slate-600">{found.note}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Customer Profile + provenance ────────────────────────────────────────────

const PROVENANCE_META: Record<string, { label: string; tone: StatusTone }> = {
  VERIFIED: { label: 'Truy được nguồn', tone: 'success' },
  NEEDS_REVIEW: { label: 'Nguồn cần rà soát', tone: 'warning' },
  UNVERIFIED: { label: 'Không truy được nguồn', tone: 'danger' },
  MISSING: { label: 'Chưa có dữ liệu', tone: 'danger' },
};

function CustomerProfilePanel({ result }: { result: AccountOpeningResult | null }) {
  const profile = result?.customer_profile;
  const provenance = result?.profile_provenance;
  if (!profile || Object.keys(profile).length === 0) {
    return <EmptyInline icon={Fingerprint} text="Chưa có Customer Profile hợp nhất." />;
  }

  const provenanceByPath = new Map(safeArray(provenance?.fields).map((field) => [field.field_path, field]));

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700"><Fingerprint className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Customer Profile hợp nhất</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {provenance
                ? `${provenance.summary.verified} trường truy được nguồn · ${provenance.summary.traceable_percent}% có dẫn chiếu chứng từ`
                : 'Dữ liệu hợp nhất từ toàn bộ chứng từ trong hồ sơ'}
            </p>
          </div>
        </div>
        {provenance && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={`CIF bắt buộc ${provenance.mandatory_coverage_percent}%`} tone={provenance.mandatory_coverage_percent >= 85 ? 'success' : 'warning'} />
          </div>
        )}
      </div>

      {provenance && provenance.mandatory_fields.length > 0 && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Trường CIF bắt buộc của phân khúc</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {provenance.mandatory_fields.map((field) => {
              const status = PROVENANCE_META[field.status] ?? PROVENANCE_META.MISSING;
              return (
                <div key={field.field_path} className={`rounded-xl border px-2.5 py-2 ${statusToneClass(status.tone)}`}>
                  <p className="text-[11px] font-semibold text-slate-800">{field.label}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-wide">{status.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {PROFILE_GROUPS.map((group) => {
          const values = profile[group.key] as Record<string, unknown> | undefined;
          if (!values || Object.keys(values).length === 0) return null;
          return (
            <div key={group.key} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <span aria-hidden="true">{group.icon}</span>
                {group.label}
              </p>
              <div className="mt-2.5 space-y-1.5">
                {Object.entries(values).map(([key, value]) => {
                  const fieldProvenance = provenanceByPath.get(`${group.key}.${key}`);
                  const tone = fieldProvenance ? PROVENANCE_META[fieldProvenance.provenance]?.tone : undefined;
                  return (
                    <div key={key} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">{key.replace(/_/g, ' ')}</p>
                        <p className="mt-0.5 break-words text-[11px] font-medium text-slate-800">{renderValue(value)}</p>
                      </div>
                      {fieldProvenance && tone && (
                        <span
                          className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase ${statusToneClass(tone)}`}
                          title={fieldProvenance.source_documents.join(', ') || 'Không có chứng từ dẫn chiếu'}
                        >
                          {fieldProvenance.provenance === 'VERIFIED' ? 'Nguồn' : fieldProvenance.provenance === 'NEEDS_REVIEW' ? 'Soát' : 'Trống'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Dữ liệu bóc tách thô ─────────────────────────────────────────────────────

function ExtractedDataPanel({ extraction }: { extraction: ExtractedDoc[] | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'fields' | 'json'>('fields');
  const documents = safeArray(extraction);
  if (documents.length === 0) return <EmptyInline icon={Database} text="Dữ liệu bóc tách sẽ xuất hiện sau bước OCR." />;

  return (
    <section className={`${SURFACE} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Database className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Dữ liệu bóc tách theo chứng từ</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">{documents.filter((item) => item.status === 'success').length}/{documents.length} chứng từ đọc được · mở để xem dữ liệu gốc</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Chế độ xem dữ liệu bóc tách">
          {([
            { id: 'fields' as const, label: 'Trường dữ liệu', icon: ListChecks },
            { id: 'json' as const, label: 'JSON', icon: Braces },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              aria-pressed={viewMode === id}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                viewMode === id ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map((document, index) => {
          const id = `${document.file_name}-${document.doc_type_key}-${index}`;
          const open = expanded === id;
          const failed = document.status !== 'success';
          const fields = failed ? [] : flattenFields(document.data);
          return (
            <article key={id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${failed ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {failed ? <CircleAlert className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-800">{document.doc_type_label}</p>
                  <p className="mt-1 truncate font-mono text-[9px] text-slate-600" title={document.file_name}>{document.file_name}</p>
                </div>
                <span className="shrink-0 text-[9px] text-slate-500">{failed ? 'Lỗi' : `${fields.length} trường`}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="max-h-80 overflow-auto border-t border-slate-200 bg-white p-3">
                  {failed ? (
                    <p className="text-[10px] leading-4 text-rose-700">{document.error || 'Lỗi bóc tách'}</p>
                  ) : viewMode === 'json' ? (
                    <pre className="overflow-auto font-mono text-[10px] leading-5 text-slate-700">{JSON.stringify(document.data ?? {}, null, 2)}</pre>
                  ) : fields.length > 0 ? (
                    <dl className="space-y-1.5">
                      {fields.map((field) => (
                        <div key={field.path} className="grid grid-cols-[minmax(90px,45%)_1fr] gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                          <dt className="break-all font-mono text-[9px] leading-4 text-slate-500">{field.path}</dt>
                          <dd className="break-words text-[10px] leading-4 text-slate-800">{renderValue(field.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="text-[10px] italic text-slate-400">Không có trường dữ liệu.</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className="mt-4 flex items-start gap-2 border-t border-slate-200 pt-3 text-[10px] leading-4 text-slate-500">
        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
        Mỗi trường dữ liệu ở đây là nguồn được dùng lại cho các kết luận ở giai đoạn đánh giá.
      </div>
    </section>
  );
}

function flattenFields(value: unknown, path = '', out: Array<{ path: string; value: unknown }> = []): Array<{ path: string; value: unknown }> {
  if (value === null || value === undefined) return out;
  if (typeof value !== 'object') {
    out.push({ path: path || 'value', value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenFields(item, `${path}[${index}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenFields(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}
