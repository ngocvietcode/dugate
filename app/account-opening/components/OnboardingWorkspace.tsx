'use client';

// Khung hai giai đoạn: cột trái là bộ hồ sơ đầu vào (upload + tóm tắt), cột phải
// là workspace của giai đoạn đang chọn. Tách khỏi page.tsx để page chỉ còn lo
// state của phiên chạy.

import React from 'react';
import { BadgeCheck, FileSearch, Gauge, ListChecks, Route, ScanSearch, ShieldCheck } from 'lucide-react';
import type { AccountOpeningResult, AccountPhaseKey, ClassifiedDoc, ExtractedDoc } from '../types';
import type { ChecklistTemplateItem, ProductTemplate, SegmentTemplate } from '../segments';
import { IntakeWorkspace } from './IntakeWorkspace';
import { AssessmentWorkspace } from './AssessmentWorkspace';
import { MiniStat, SURFACE, StatusBadge, filesForKey, safeArray } from './primitives';

interface OnboardingWorkspaceProps {
  segment: SegmentTemplate;
  product: ProductTemplate;
  template: ChecklistTemplateItem[];
  classification: ClassifiedDoc[] | null;
  extraction: ExtractedDoc[] | null;
  result: AccountOpeningResult | null;
  uploadSlot: React.ReactNode;
  activePhase: AccountPhaseKey;
  onPhaseChange: (phase: AccountPhaseKey) => void;
  caseId: string;
}

export function OnboardingWorkspace({
  segment,
  product,
  template,
  classification,
  extraction,
  result,
  uploadSlot,
  activePhase,
  onPhaseChange,
  caseId,
}: OnboardingWorkspaceProps) {
  const hasAnyResult = Boolean(result) || safeArray(classification).length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)] xl:items-start">
      <DossierPanel
        segment={segment}
        product={product}
        template={template}
        classification={classification}
        result={result}
        uploadSlot={uploadSlot}
        caseId={caseId}
      />

      <div className="min-w-0 space-y-5">
        <PhaseTabs activePhase={activePhase} onPhaseChange={onPhaseChange} />
        {!hasAnyResult ? (
          <EmptyOnboardingPlane segment={segment} product={product} />
        ) : activePhase === 'DOSSIER_INTAKE' ? (
          <IntakeWorkspace
            segment={segment}
            product={product}
            template={template}
            classification={classification}
            extraction={extraction}
            result={result}
            onGoToAssessment={() => onPhaseChange('ONBOARDING_ASSESSMENT')}
          />
        ) : (
          <AssessmentWorkspace segment={segment} product={product} result={result} />
        )}
      </div>
    </div>
  );
}

function PhaseTabs({ activePhase, onPhaseChange }: {
  activePhase: AccountPhaseKey;
  onPhaseChange: (phase: AccountPhaseKey) => void;
}) {
  const tabs: Array<{ key: AccountPhaseKey; label: string; caption: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'DOSSIER_INTAKE', label: 'Tiếp nhận hồ sơ', caption: 'Chứng từ, Customer Profile, đối chiếu chéo', icon: ListChecks },
    { key: 'ONBOARDING_ASSESSMENT', label: 'Đánh giá & kết luận', caption: 'Điều kiện, CDD, policy, tuyến xử lý', icon: ShieldCheck },
  ];
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" role="tablist" aria-label="Giai đoạn xử lý hồ sơ">
      {tabs.map((tab) => {
        const isActive = activePhase === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPhaseChange(tab.key)}
            className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
              isActive
                ? 'border-cyan-400 bg-white shadow-[0_10px_30px_rgba(14,116,144,.12)] ring-2 ring-cyan-500/30'
                : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-cyan-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <tab.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{tab.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{tab.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DossierPanel({ segment, product, template, classification, result, uploadSlot, caseId }: {
  segment: SegmentTemplate;
  product: ProductTemplate;
  template: ChecklistTemplateItem[];
  classification: ClassifiedDoc[] | null;
  result: AccountOpeningResult | null;
  uploadSlot: React.ReactNode;
  caseId: string;
}) {
  const requiredTotal = result?.intake?.required_total ?? template.filter((item) => item.required).length;
  const requiredPresent = result?.intake?.required_present
    ?? template.filter((item) => item.required && filesForKey(item.key, classification, result).length > 0).length;
  const documents = safeArray(result?.documents).length || safeArray(classification).length;
  const checklist = safeArray(result?.checklist);

  return (
    <aside className={`${SURFACE} overflow-hidden xl:sticky xl:top-5`}>
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Hồ sơ mở tài khoản</p>
            <h2 className="mt-1.5 text-lg font-semibold text-slate-900">Bộ hồ sơ đầu vào</h2>
            <p className="mt-1 text-[10px] text-slate-500">{caseId} · {product.shortName}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-700">
            <FileSearch className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge label={`Phân khúc ${segment.key}`} tone="info" />
          {segment.isOrganization && <StatusBadge label="Khách hàng tổ chức" tone="neutral" />}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Đã nhận diện" value={String(documents)} />
          <MiniStat label="Bắt buộc" value={`${requiredPresent}/${requiredTotal}`} />
          <MiniStat label="Độ đầy đủ" value={result ? `${result.completeness_percent}%` : '—'} />
        </div>
      </div>

      <div className="p-5">{uploadSlot}</div>

      {result && (
        <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tình trạng chứng từ</p>
            <StatusBadge
              label={checklist.some((item) => item.status === 'missing') ? 'Còn thiếu' : 'Đã kiểm tra'}
              tone={checklist.some((item) => item.status === 'missing') ? 'warning' : 'success'}
            />
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            Chi tiết từng loại chứng từ nằm trong giai đoạn tiếp nhận hồ sơ.
          </p>
        </div>
      )}
    </aside>
  );
}

function EmptyOnboardingPlane({ segment, product }: { segment: SegmentTemplate; product: ProductTemplate }) {
  const capabilities = [
    { icon: ScanSearch, label: 'Chứng từ', caption: 'Phân loại và bóc tách có truy vết' },
    { icon: Gauge, label: 'Điều kiện', caption: 'Tuổi, hiệu lực giấy tờ, trường CIF' },
    { icon: BadgeCheck, label: 'CDD', caption: 'Năm yếu tố rủi ro khách hàng' },
    { icon: Route, label: 'Kết luận', caption: 'Tuyến rà soát có người kiểm soát' },
  ];
  return (
    <section className={`${SURFACE} relative overflow-hidden p-6 sm:p-8`}>
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-200/40 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Sẵn sàng tiếp nhận</p>
        <h3 className="mt-2 max-w-xl text-xl font-semibold leading-snug text-slate-900">
          Tải bộ hồ sơ của {segment.shortName.toLowerCase()} để bắt đầu phân loại, chấm checklist và đánh giá điều kiện mở tài khoản.
        </h3>
        <p className="mt-2.5 max-w-2xl text-xs leading-6 text-slate-600">
          Sản phẩm đang chọn: <strong className="text-slate-800">{product.name}</strong>. {product.description}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((capability) => (
            <div key={capability.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-cyan-700 shadow-sm">
                <capability.icon className="h-4 w-4" />
              </div>
              <p className="mt-2.5 text-xs font-semibold text-slate-800">{capability.label}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{capability.caption}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
