import { Coins } from 'lucide-react';
import { formatNumber, formatUsd } from '@/app/loan-appraisal-v2/lib/format';
import type { OperationUsage } from '@/app/loan-appraisal-v2/lib/usage';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { KeyValue, KeyValueGrid } from '../ui/KeyValue';
import { Disclosure } from '../ui/Disclosure';
import { DataTable } from '../ui/DataTable';

const dash = (value: number | null) => (value === null ? '—' : formatNumber(value));

export function UsageCard({ usage }: { usage: OperationUsage }) {
  return (
    <Card labelledBy="la2-usage-title">
      <CardHeader id="la2-usage-title" icon={Coins} title="Chi phí & token" subtitle="Số liệu sử dụng của phiên này" />
      <CardBody className="space-y-3">
        <KeyValueGrid columns="grid-cols-2">
          <KeyValue label="Token đầu vào" value={dash(usage.inputTokens)} />
          <KeyValue label="Token đầu ra" value={dash(usage.outputTokens)} />
          <KeyValue label="Chi phí (USD)" value={formatUsd(usage.costUsd)} />
          {usage.pages !== null && <KeyValue label="Số trang" value={formatNumber(usage.pages)} />}
          {usage.model && <KeyValue label="Model" value={usage.model} />}
        </KeyValueGrid>
        {usage.breakdown.length > 0 && (
          <Disclosure defaultOpen lazy={false} summary={`Chi tiết theo processor (${usage.breakdown.length})`}>
            <DataTable
              caption="Chi phí theo processor"
              rows={usage.breakdown}
              rowKey={(row, index) => `${row.processor}-${index}`}
              empty="Không có dữ liệu."
              minWidth={420}
              columns={[
                { key: 'processor', header: 'Processor', cell: (row) => row.processor },
                { key: 'model', header: 'Model', cell: (row) => row.model ?? '—' },
                { key: 'in', header: 'Vào', cell: (row) => dash(row.inputTokens), className: 'tabular-nums' },
                { key: 'out', header: 'Ra', cell: (row) => dash(row.outputTokens), className: 'tabular-nums' },
                { key: 'cost', header: 'USD', cell: (row) => formatUsd(row.costUsd), className: 'tabular-nums' },
              ]}
            />
          </Disclosure>
        )}
      </CardBody>
    </Card>
  );
}
