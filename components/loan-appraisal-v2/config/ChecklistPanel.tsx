'use client';

// Override mức yêu cầu checklist THEO SẢN PHẨM và LUỒNG (S4-R25). Chỉ đổi mức yêu cầu của mục đã có trong catalog
// ở luồng đã có của chương trình; không tạo được mục / luồng mới. Để mặc định = không ghi gì vào cấu hình.

import { useMemo, useState } from 'react';
import { loadChecklistCatalog } from '@/lib/loan-dossier/s4/catalog';
import { programForProduct } from '@/lib/loan-dossier/s4/programs';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { FOCUS_RING } from '../ui/toneClasses';
import type { ConfigPanelProps } from './AiStepsPanel';

const LABEL: Record<string, string> = { REQUIRED: 'Bắt buộc', CONDITIONAL: 'Có điều kiện', NOT_REQUIRED: 'Không bắt buộc', NONE: 'Không sinh dòng' };
const SELECT = `h-8 w-full rounded-md border border-border bg-background px-2 text-xs disabled:opacity-60 ${FOCUS_RING}`;

export function ChecklistPanel({ config, update, canEdit, productCode }: ConfigPanelProps & { productCode: string }) {
  const program = programForProduct(productCode);
  const catalog = useMemo(() => loadChecklistCatalog(), []);
  const [group, setGroup] = useState('all');
  const [onlyChanged, setOnlyChanged] = useState(false);

  if (!program) return <EmptyState title="Sản phẩm này chưa thuộc chương trình checklist nào.">Thêm sản phẩm vào checklist_programs.json trước khi cấu hình.</EmptyState>;

  const overrides = config.checklist ?? {};
  const items = catalog.items.filter((item) => item.item_key in program.requirements)
    .filter((item) => group === 'all' || item.checklist_group === group)
    .filter((item) => !onlyChanged || overrides[item.item_key]);
  const changedCount = Object.keys(overrides).length;

  const set = (itemKey: string, flow: string, value: string) => update((current) => {
    const checklist = structuredClone(current.checklist ?? {});
    const byFlow = { ...(checklist[itemKey] ?? {}) };
    if (value === '') delete byFlow[flow];
    else byFlow[flow] = value === 'NONE' ? null : value;
    if (Object.keys(byFlow).length) checklist[itemKey] = byFlow; else delete checklist[itemKey];
    const next = { ...current };
    if (Object.keys(checklist).length) next.checklist = checklist; else delete next.checklist;
    return next;
  });

  const valueOf = (itemKey: string, flow: string): string => {
    const byFlow = overrides[itemKey];
    if (!byFlow || !(flow in byFlow)) return '';
    return byFlow[flow] === null ? 'NONE' : String(byFlow[flow]);
  };

  return (
    <Card as="div">
      <CardHeader
        title={`Checklist chứng từ · ${program.program_label}`}
        subtitle="Đổi mức yêu cầu của từng mục theo luồng. Để mặc định = giữ theo chương trình. Không tạo được mục hoặc luồng mới."
        actions={<Badge tone={changedCount ? 'info' : 'neutral'}>{changedCount} mục đã đổi</Badge>}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground">Nhóm{' '}
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${SELECT} ml-1 inline-block w-auto`}>
              <option value="all">Tất cả</option>
              {catalog.groups.map((g) => <option key={g.checklist_group} value={g.checklist_group}>{g.group_label}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="h-4 w-4" />Chỉ mục đã đổi</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-semibold">Mục</th>
                {program.flows.map((f) => <th key={f.flow_key} scope="col" className="px-2 py-2 font-semibold">{f.flow_label}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.item_key} className="border-b border-border/60 align-top">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <span className="block font-semibold text-foreground">{item.item_label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{item.item_key}</span>
                  </th>
                  {program.flows.map((f) => {
                    const base = program.requirements[item.item_key]?.[f.flow_key] ?? null;
                    const current = valueOf(item.item_key, f.flow_key);
                    return (
                      <td key={f.flow_key} className="px-2 py-2">
                        <select aria-label={`${item.item_label} · ${f.flow_label}`} value={current} disabled={!canEdit} onChange={(e) => set(item.item_key, f.flow_key, e.target.value)} className={`${SELECT} ${current ? 'border-primary' : ''}`}>
                          <option value="">Mặc định ({base ? LABEL[base] : LABEL.NONE})</option>
                          <option value="REQUIRED">{LABEL.REQUIRED}</option>
                          {item.condition_id && <option value="CONDITIONAL">{LABEL.CONDITIONAL}</option>}
                          <option value="NOT_REQUIRED">{LABEL.NOT_REQUIRED}</option>
                          <option value="NONE">{LABEL.NONE}</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={program.flows.length + 1} className="py-6 text-center text-muted-foreground">Không có mục nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
