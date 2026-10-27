'use client';

import { useMemo } from 'react';
import { XCircle, Activity, DollarSign } from 'lucide-react';
import DashboardStats from './LegacyDashboardStats';
import TrendChart from './LegacyTrendChart';
import TopListCard, { type TopListEntry } from './TopListCard';
import ThroughputPanel from './ThroughputPanel';
import { useTimeseries } from '../hooks/useTimeseries';
import { useBreakdown } from '../hooks/useBreakdown';
import type { OperationFiltersState, OperationState } from '../types';

interface OverviewTabProps {
  filters: OperationFiltersState;
  isToday: boolean;
  onSelectState: (state: OperationState | 'ALL') => void;
  onDrillEndpoint: (endpointKey: string) => void;
  onDrillProfile: (profileKey: string) => void;
}

const TOP_N = 5;

export default function OverviewTab({
  filters, isToday, onSelectState, onDrillEndpoint, onDrillProfile,
}: OverviewTabProps) {
  const {
    points, bucket, truncated, coverageStart,
    loading: tsLoading, error: tsError, retry: retryTimeseries,
  } = useTimeseries({ filters });
  const {
    rows: endpointRows, loading: epLoading, error: epError, retry: retryEndpoints,
  } = useBreakdown({ groupBy: 'endpoint', filters });
  const {
    rows: profileRows, loading: pfLoading, error: pfError, retry: retryProfiles,
  } = useBreakdown({ groupBy: 'profile', filters });

  const topFailed: TopListEntry[] = useMemo(
    () =>
      [...endpointRows]
        .filter((r) => r.failed > 0)
        .sort((a, b) => b.failed - a.failed)
        .slice(0, TOP_N)
        .map((r) => ({ key: r.key, name: r.name, value: r.failed, subValue: `/${r.total}`, tone: 'danger' as const })),
    [endpointRows],
  );

  const topVolume: TopListEntry[] = useMemo(
    () =>
      [...endpointRows]
        .sort((a, b) => b.total - a.total)
        .slice(0, TOP_N)
        .map((r) => ({ key: r.key, name: r.name, value: r.total })),
    [endpointRows],
  );

  const topCost: TopListEntry[] = useMemo(
    () =>
      [...profileRows]
        .filter((r) => r.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, TOP_N)
        .map((r) => ({ key: r.key, name: r.name, value: r.cost, tone: 'money' as const })),
    [profileRows],
  );

  const drillEndpoint = (key: string) => { if (key !== '__none__') onDrillEndpoint(key); };
  const drillProfile = (key: string) => onDrillProfile(key);

  return (
    <div className="space-y-6">
      <DashboardStats filters={filters} pollingEnabled={isToday} onSelectState={onSelectState} />

      <TrendChart
        points={points}
        bucket={bucket}
        truncated={truncated}
        coverageStart={coverageStart}
        loading={tsLoading}
        error={tsError}
        onRetry={retryTimeseries}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopListCard
          title="Top quy trình lỗi"
          icon={<XCircle className="w-4 h-4" />}
          entries={topFailed}
          loading={epLoading}
          error={epError}
          onRetry={retryEndpoints}
          emptyText="Không có lỗi 🎉"
          onSelect={drillEndpoint}
        />
        <TopListCard
          title="Top quy trình nhiều request"
          icon={<Activity className="w-4 h-4" />}
          entries={topVolume}
          loading={epLoading}
          error={epError}
          onRetry={retryEndpoints}
          onSelect={drillEndpoint}
        />
        <TopListCard
          title="Top profile chi phí"
          icon={<DollarSign className="w-4 h-4" />}
          entries={topCost}
          loading={pfLoading}
          error={pfError}
          onRetry={retryProfiles}
          emptyText="Chưa phát sinh chi phí"
          onSelect={drillProfile}
        />
      </div>

      <ThroughputPanel filters={filters} minuteEnabled={isToday} onDrillProfile={drillProfile} />
    </div>
  );
}
