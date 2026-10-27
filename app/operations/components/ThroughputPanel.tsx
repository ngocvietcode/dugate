'use client';

import { useEffect, useState } from 'react';
import { Gauge, Info, Loader2, RotateCcw } from 'lucide-react';
import { useThroughput } from '../hooks/useThroughput';
import { formatTokens } from '../lib/format';
import type { OperationFiltersState } from '../types';

interface ThroughputPanelProps {
  filters: OperationFiltersState;
  minuteEnabled: boolean;
  onDrillProfile?: (profileKey: string) => void;
}

type ThroughputBucket = 'minute' | 'hour';

export default function ThroughputPanel({
  filters, minuteEnabled, onDrillProfile,
}: ThroughputPanelProps) {
  const [bucket, setBucket] = useState<ThroughputBucket>(minuteEnabled ? 'minute' : 'hour');

  useEffect(() => {
    setBucket(minuteEnabled ? 'minute' : 'hour');
  }, [minuteEnabled]);

  const requestedBucket: ThroughputBucket = minuteEnabled ? bucket : 'hour';
  const { data, loading, error, retry } = useThroughput({ filters, bucket: requestedBucket });
  const effectiveBucket = data?.bucket ?? requestedBucket;
  const unit = effectiveBucket === 'minute' ? 'req/phút' : 'req/giờ';

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Throughput theo Profile</h3>
        </div>
        <div className="flex items-center gap-3">
          {data && <span className="hidden sm:inline text-[11px] text-muted-foreground">Đơn vị: {unit}</span>}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="group" aria-label="Đơn vị throughput">
            <button
              type="button"
              onClick={() => setBucket('minute')}
              disabled={!minuteEnabled}
              aria-pressed={bucket === 'minute'}
              title={minuteEnabled ? 'Hiển thị theo phút' : 'Theo phút chỉ khả dụng với bộ lọc Hôm nay'}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${bucket === 'minute' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Phút
            </button>
            <button
              type="button"
              onClick={() => setBucket('hour')}
              aria-pressed={bucket === 'hour'}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${bucket === 'hour' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Giờ
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-1.5 mb-3 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Throughput = số request <strong>nhận vào</strong> mỗi {effectiveBucket === 'minute' ? 'phút' : 'giờ'} (proxy để tính rate-limit AIHub).
          Đây KHÔNG phải số request chạy đồng thời (concurrent).
          {!minuteEnabled && ' Chế độ theo phút chỉ khả dụng với bộ lọc Hôm nay.'}
        </span>
      </div>

      {data?.truncated && data.coverageStart && (
        <p className="mb-3 text-[11px] text-amber-700 dark:text-amber-400">
          Dữ liệu throughput được giới hạn để bảo vệ hệ thống, từ {formatCoverageDate(data.coverageStart)}.
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></div>
      ) : error ? (
        <div className="py-8 text-center" role="alert">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={retry} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80">
            <RotateCcw className="w-3.5 h-3.5" /> Thử lại
          </button>
        </div>
      ) : !data || data.perProfile.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Không có dữ liệu trong khoảng thời gian này.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-medium py-2">Profile</th>
                <th className="text-right font-medium py-2">Tổng request</th>
                <th className="text-right font-medium py-2">Peak ({unit})</th>
                <th className="text-right font-medium py-2">TB ({unit})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.perProfile.map((profile) => (
                <tr
                  key={profile.key}
                  className={`${onDrillProfile && profile.key !== '__none__' ? 'cursor-pointer hover:bg-muted/40' : ''} transition-colors`}
                  onClick={() => { if (onDrillProfile && profile.key !== '__none__') onDrillProfile(profile.key); }}
                >
                  <td className="py-2">
                    <span className={`text-sm ${profile.key === '__none__' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>{profile.name}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{formatTokens(profile.total)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-foreground">{formatTokens(profile.peak)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{profile.avg.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCoverageDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}
