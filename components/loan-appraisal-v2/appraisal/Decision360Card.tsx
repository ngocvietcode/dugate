import type { ReactNode } from 'react';
import { Banknote, Building2, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { AttentionItem, AttentionSeverity, Decision360 } from '@/app/loan-appraisal-v2/lib/decision-360';
import { formatCurrencyVnd, formatNumber } from '@/app/loan-appraisal-v2/lib/format';
import { Badge } from '../ui/Badge';
import { DataTable } from '../ui/DataTable';
import { Disclosure } from '../ui/Disclosure';
import { TONE_BOX } from '../ui/toneClasses';

const ATTENTION_LABELS: Record<AttentionSeverity, string> = { danger: 'Phải xử lý', warning: 'Cần soát', info: 'Lưu ý' };

function SummaryCell({ label, icon: Icon, value, children, badge }: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  children?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        {badge}
      </div>
      <dt className="mt-3 text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold tabular-nums text-foreground">{value}</dd>
      {children && <dd className="mt-2 text-xs text-muted-foreground">{children}</dd>}
    </div>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.subject}-${item.title}-${index}`} className="rounded-lg border border-border px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={item.severity}>{ATTENTION_LABELS[item.severity]}</Badge>
            <strong className="text-foreground">{item.subject}</strong>
            <span className="text-foreground">{item.title}</span>
          </div>
          {item.detail && <p className="mt-1 text-muted-foreground">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/** D-113: đọc tóm tắt và điểm cần xử lý trước, tra nguồn thu / hộ kinh doanh sau. */
export function Decision360Card({ decision }: { decision: Decision360 }) {
  const { loan, income, businesses, counts, borrower, attention } = decision;
  const business = businesses[0];
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loan && (
          <SummaryCell label="Khoản vay" icon={Banknote} value={formatCurrencyVnd(loan.requested)} badge={loan.disputed.length > 0 ? <Badge tone="danger">Tranh chấp</Badge> : undefined}>
            đề xuất {formatCurrencyVnd(loan.proposed)} · {loan.termMonths === null ? 'Chưa rõ thời hạn' : `${formatNumber(loan.termMonths)} tháng`} · {loan.interestRate === null ? 'Chưa rõ lãi suất' : `${formatNumber(loan.interestRate, 2)}%/năm`}
          </SummaryCell>
        )}
        {income.lines.length > 0 && (
          <SummaryCell label="Thu nhập / tháng" icon={Wallet} value={formatCurrencyVnd(income.monthlyTotal)}>
            {income.lines.length - income.unevidenced}/{income.lines.length} nguồn có chứng từ
          </SummaryCell>
        )}
        {business && (
          <SummaryCell label="Hộ kinh doanh" icon={Building2} value={<>{business.name ?? 'Chưa rõ tên'}{businesses.length > 1 && <span className="ml-1 text-sm text-muted-foreground">+{businesses.length - 1}</span>}</>} badge={<Badge tone={business.ownerVerified ? 'success' : 'warning'}>{business.ownerVerified ? 'Chủ hộ đã xác minh' : 'Chưa xác minh chủ hộ'}</Badge>}>
            Số GCN: {business.registrationNumber ?? 'Chưa có'}
          </SummaryCell>
        )}
        <SummaryCell label="Người & tài sản" icon={Users} value={`${counts.people} người · ${counts.collateral} TSBĐ`}>
          {borrower}
        </SummaryCell>
      </dl>

      <section aria-label="Cần chú ý">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cần chú ý ({attention.length})</h4>
        {attention.length === 0 ? (
          <p className={`rounded-lg border px-3 py-2 text-xs ${TONE_BOX.success}`}>Không có điểm cần chú ý</p>
        ) : (
          <div className="space-y-2">
            <AttentionList items={attention.slice(0, 5)} />
            {attention.length > 5 && (
              <Disclosure summary={`Xem thêm ${attention.length - 5} điểm`}>
                <AttentionList items={attention.slice(5)} />
              </Disclosure>
            )}
          </div>
        )}
      </section>

      {income.lines.length > 0 && (
        <section aria-label="Nguồn thu">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nguồn thu</h4>
          {/* Dùng tfoot để tổng luôn nằm sau toàn bộ nguồn thu, đúng cột số tiền. */}
          <div tabIndex={0} role="region" aria-label="Bảng nguồn thu" className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <caption className="sr-only">Nguồn thu hàng tháng</caption>
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Loại</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Của ai</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Hộ kinh doanh</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Số tiền/tháng</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Chứng từ</th>
                </tr>
              </thead>
              <tbody>
                {income.lines.map((line) => (
                  <tr key={line.incomeId} className="border-t border-border align-top">
                    <td className="px-3 py-2">{line.kindLabel}</td>
                    <td className="px-3 py-2">{line.personName ?? 'Chưa xác định'}</td>
                    <td className="px-3 py-2">{line.businessName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyVnd(line.monthly)}</td>
                    <td className="px-3 py-2">{line.evidenced ? <span aria-label="Có chứng từ">✓</span> : <span className="text-muted-foreground">chỉ lời khai</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 font-semibold">
                <tr>
                  <th scope="row" colSpan={3} className="px-3 py-2">Tổng</th>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyVnd(income.monthlyTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {businesses.length > 0 && (
        <section aria-label="Hộ kinh doanh">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hộ kinh doanh</h4>
          <DataTable
            caption="Hộ kinh doanh trong hồ sơ"
            rows={businesses}
            rowKey={(row) => row.businessId}
            empty="Chưa có hộ kinh doanh"
            columns={[
              { key: 'name', header: 'Tên', cell: (row) => row.name ?? 'Chưa rõ tên' },
              { key: 'registration', header: 'Số GCN', cell: (row) => row.registrationNumber ?? 'Chưa có' },
              { key: 'line', header: 'Ngành', cell: (row) => row.businessLine ?? 'Chưa có' },
              { key: 'owner', header: 'Chủ hộ', cell: (row) => row.ownerNames.join(', ') || 'Chưa xác định' },
              { key: 'verified', header: 'Xác minh', cell: (row) => <Badge tone={row.ownerVerified ? 'success' : 'warning'}>{row.ownerVerified ? 'Chủ hộ đã xác minh' : 'Chưa xác minh chủ hộ'}</Badge> },
              { key: 'documents', header: 'Chứng từ', cell: (row) => <div className="flex flex-wrap gap-1">{row.documents.map((doc, index) => <span key={`${doc}-${index}`} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{doc}</span>)}</div> },
            ]}
          />
        </section>
      )}
    </div>
  );
}
