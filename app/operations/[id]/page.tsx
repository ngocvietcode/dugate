'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { resolveOperationsBackUrl } from '../lib/backTarget';
import { useOperationDetail } from '../hooks/useOperationDetail';
import OperationHeader from './components/OperationHeader';
import RequestInfoSection from './components/RequestInfoSection';
import PipelineTimeline from './components/PipelineTimeline';
import ResultSection from './components/ResultSection';
import UsageSection from './components/UsageSection';
import WebhookSection from './components/WebhookSection';
import WaitingInputSection from './components/WaitingInputSection';
import CancelDialog from './components/CancelDialog';

export default function OperationDetailPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const { operation, loading, error, errorStatus, pollError, refresh } = useOperationDetail(id);

  // Back target: prefer the exact list URL we came from (preserves all filters),
  // otherwise fall back to this operation's profile request list, then bare list.
  const fromParam = searchParams.get('from');
  const backUrl = resolveOperationsBackUrl(fromParam, operation?.apiKeyId);

  // RBAC: require an authenticated session (ADMIN or OPS).
  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!session) {
      router.push('/');
    }
  }, [session, sessionStatus, router]);

  // 401 → redirect login
  useEffect(() => {
    if (errorStatus === 401) {
      router.push('/login');
    }
  }, [errorStatus, router]);

  // Session loading or unauthenticated
  if (sessionStatus === 'loading' || !session) {
    return (
      <div className="p-12 text-center text-muted-foreground flex justify-center items-center">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Đang tải...
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // 403 → Forbidden
  if (errorStatus === 403) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="modern-card flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-foreground mb-2">Không có quyền</p>
          <p className="text-sm text-muted-foreground mb-4">
            Bạn không có quyền xem operation này.
          </p>
          <Link
            href={backUrl}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  // 404 → Not found
  if (errorStatus === 404 || (!loading && !operation && error)) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <div className="modern-card flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-foreground mb-2">
            Operation không tồn tại
          </p>
          <p className="text-xs font-mono text-muted-foreground mb-4">{id}</p>
          <Link
            href={backUrl}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  if (!operation) return null;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      {/* Back button */}
      <Link
        href={backUrl}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Quay lại danh sách
      </Link>

      {/* Header */}
      <OperationHeader operation={operation} />

      {pollError && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          {pollError}
        </div>
      )}

      {operation.contentPurgedAt && (
        <div role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Nội dung request và kết quả đã hết hạn lưu trữ và đã được xóa lúc{' '}
          {new Date(operation.contentPurgedAt).toLocaleString('vi-VN')}. Metadata, trạng thái, token và chi phí vẫn được giữ.
        </div>
      )}

      {/* Request info (files, parameter names) */}
      <RequestInfoSection operation={operation} />

      {/* Waiting input section (prominent when WAITING_USER_INPUT) */}
      <WaitingInputSection operation={operation} onResumed={refresh} />

      {/* Pipeline timeline */}
      <PipelineTimeline
        pipelineJson={operation.pipelineJson}
        stepsResultJson={operation.stepsResultJson}
        currentStep={operation.currentStep}
        failedAtStep={operation.failedAtStep}
        operationState={operation.state}
        endpointSlug={operation.endpointSlug}
        progressMessage={operation.progressMessage}
        subSteps={operation.subSteps}
      />

      {/* Result section (SUCCEEDED or FAILED) */}
      <ResultSection operation={operation} />

      {/* Usage section */}
      <UsageSection operation={operation} />

      {/* Webhook section */}
      <WebhookSection
        webhookUrl={operation.webhookUrl}
        webhookSentAt={operation.webhookSentAt}
        webhookAttempts={operation.webhookAttempts}
        webhookLastError={operation.webhookLastError}
      />

      {/* Cancel button */}
      <CancelDialog
        operationId={operation.id}
        done={operation.done}
        onCancelled={refresh}
      />
    </div>
  );
}
