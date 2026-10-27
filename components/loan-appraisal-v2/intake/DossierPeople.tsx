'use client';

import { Users } from 'lucide-react';
import type { DossierEvidence, DossierOutputV3 } from '@/app/loan-appraisal/types';
import { assetContextView } from '@/app/loan-appraisal-v2/lib/dossier-view';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';

const ROLE_LABELS: Record<string, string> = { borrower: 'Khách hàng vay', co_borrower: 'Người đồng vay', collateral_owner: 'Chủ TSBĐ', other: 'Đối tượng khác' };
const MARITAL: Record<string, string> = { SINGLE: 'Độc thân', MARRIED: 'Đã kết hôn', DIVORCED: 'Ly hôn', WIDOWED: 'Góa' };
const ASSET_TYPES: Record<string, string> = { real_estate: 'Bất động sản', apartment: 'Căn hộ', vehicle: 'Xe', deposit: 'Tiền gửi', other: 'Khác' };

/** Customer 360 của S3: người, vai trò, số định danh, tài sản (V2-R10). `evidences` (S2) để ghi tên file nguồn của tài sản. */
export function DossierPeople({ map, evidences = [] }: { map: DossierOutputV3['customer_360']; evidences?: DossierEvidence[] }) {
  if (!map || map.role_registry.length === 0) {
    return (
      <Card labelledBy="la2-people-title">
        <CardHeader id="la2-people-title" icon={Users} title="Người & tài sản trong hồ sơ" subtitle="Chưa xác định được người vay (thiếu giấy đề nghị vay vốn đọc được)." />
      </Card>
    );
  }
  return (
    <Card labelledBy="la2-people-title">
      <CardHeader id="la2-people-title" icon={Users} title="Người & tài sản trong hồ sơ" subtitle={`${map.role_registry.length} người · ${map.asset_registry.length} tài sản`} />
      <CardBody>
        <ul className="grid gap-2 sm:grid-cols-2">
          {map.customer_360.map((c) => {
            const reg = map.role_registry.find((p) => p.person_id === c.person_id)!;
            return (
              <li key={c.person_id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{c.identity.full_name ?? c.person_id}</p>
                  <div className="flex flex-wrap gap-1">{c.roles.map((r) => <Badge key={r} tone="info">{ROLE_LABELS[r] ?? r}</Badge>)}</div>
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
                  {c.identity.id_number && <><dt>Số định danh</dt><dd className="text-foreground">{c.identity.id_number}</dd></>}
                  {c.identity.date_of_birth && <><dt>Ngày sinh</dt><dd className="text-foreground">{c.identity.date_of_birth}</dd></>}
                  {c.identity.permanent_address?.full_text && <><dt>Thường trú</dt><dd className="text-foreground">{c.identity.permanent_address.full_text}</dd></>}
                  {c.marital_status && <><dt>Hôn nhân</dt><dd className="text-foreground">{MARITAL[c.marital_status] ?? c.marital_status}</dd></>}
                </dl>
                {reg.id_number_check.requires_review && <p className="mt-1"><Badge tone={reg.id_number_check.severity === 'HIGH' ? 'warning' : 'warning'}>Số định danh cần rà soát</Badge></p>}
              </li>
            );
          })}
        </ul>
        {map.asset_registry.length > 0 && (
          <ul className="mt-3 space-y-1">
            {map.asset_registry.map((a) => {
              const id = a.identifiers;
              const key = id.certificate_number ?? id.license_plate ?? id.chassis_number ?? ([id.land_parcel_number, id.map_sheet_number].filter(Boolean).join('/') || '—');
              const view = assetContextView(a, evidences);
              return (
                <li key={a.asset_id} className="rounded-lg border border-border px-3 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><strong>{a.asset_id}</strong> · {ASSET_TYPES[a.asset_type] ?? a.asset_type} · {key}</span>
                    <Badge tone={view.tone}>{view.label}</Badge>
                  </div>
                  {view.reason && <p className="mt-1 text-muted-foreground">{view.reason}</p>}
                  {view.conflicts.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">{view.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
                  )}
                  {view.sources.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Nguồn: {view.sources.join('; ')}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
