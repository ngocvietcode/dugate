'use client';

import { CheckCircle, Loader2, Circle, XCircle, ChevronDown, ChevronRight, Network } from 'lucide-react';
import { Fragment, useState } from 'react';
import { getStepDisplayStatus } from '../../types';
import type { PipelineStep, StepResult, OperationState, StepDisplayStatus, SubStep } from '../../types';
import OperationStateBadge from '../../components/OperationStateBadge';
import { formatCost, formatTokens } from '../../lib/format';

interface PipelineTimelineProps {
  pipelineJson: PipelineStep[];
  stepsResultJson: StepResult[];
  currentStep: number;
  failedAtStep: number | null;
  operationState: OperationState;
  endpointSlug: string | null;
  progressMessage?: string | null;
  subSteps?: SubStep[];
}

const STATUS_ICON: Record<StepDisplayStatus, React.ReactNode> = {
  completed: <CheckCircle className="w-5 h-5 text-green-500 dark:text-green-400 shrink-0" aria-hidden="true" />,
  running: <Loader2 className="w-5 h-5 text-blue-500 dark:text-blue-400 animate-spin shrink-0" aria-hidden="true" />,
  pending: <Circle className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" aria-hidden="true" />,
  failed: <XCircle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0" aria-hidden="true" />,
};

const STATUS_LABEL: Record<StepDisplayStatus, string> = {
  completed: 'Hoàn thành',
  running: 'Đang chạy',
  pending: 'Chờ xử lý',
  failed: 'Thất bại',
};

/** Check if this is a workflow operation (stepsResult has stepName field) */
function isWorkflowSteps(stepsResult: StepResult[]): boolean {
  return stepsResult.length > 0 && 'stepName' in stepsResult[0];
}

/**
 * Timeline of HOW the request ran: steps, processors, states, sub-steps and the
 * connectors they called. Step artifacts and prompts are not returned by the API.
 */
export default function PipelineTimeline({
  pipelineJson,
  stepsResultJson,
  currentStep,
  failedAtStep,
  operationState,
  endpointSlug,
  progressMessage,
  subSteps,
}: PipelineTimelineProps) {
  const isWorkflow = isWorkflowSteps(stepsResultJson) || endpointSlug?.startsWith('workflows:');

  // For workflows: render from stepsResultJson (actual steps executed)
  // For standard pipelines: render from pipelineJson (pipeline definition)
  if (isWorkflow) {
    return (
      <WorkflowTimeline
        stepsResult={stepsResultJson}
        currentStep={currentStep}
        failedAtStep={failedAtStep}
        operationState={operationState}
        progressMessage={progressMessage}
        subSteps={subSteps}
      />
    );
  }

  return (
    <StandardPipelineTimeline
      pipelineJson={pipelineJson}
      stepsResultJson={stepsResultJson}
      currentStep={currentStep}
      failedAtStep={failedAtStep}
      operationState={operationState}
    />
  );
}

/** Timeline for workflow operations — renders from stepsResultJson */
function WorkflowTimeline({
  stepsResult,
  currentStep,
  failedAtStep,
  operationState,
  progressMessage,
  subSteps,
}: {
  stepsResult: StepResult[];
  currentStep: number;
  failedAtStep: number | null;
  operationState: OperationState;
  progressMessage?: string | null;
  subSteps?: SubStep[];
}) {
  if (!stepsResult || stepsResult.length === 0) {
    if (operationState === 'RUNNING' || (subSteps && subSteps.length > 0)) {
      return (
        <div className="modern-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Workflow Pipeline</h3>
          {operationState === 'RUNNING' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Đang khởi tạo workflow...
            </div>
          )}
          <SubStepsPanel subSteps={subSteps} />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="modern-card p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        Workflow Pipeline
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          ({stepsResult.length} bước{subSteps && subSteps.length > 0 ? ` · ${subSteps.length} bước con` : ''})
        </span>
      </h3>
      <ol className="relative space-y-0">
        {stepsResult.map((step, index) => {
          const isLast = index === stepsResult.length - 1;
          const status: StepDisplayStatus = failedAtStep === index
            ? 'failed'
            : index < currentStep || operationState === 'SUCCEEDED'
              ? 'completed'
              : index === currentStep && operationState === 'RUNNING'
                ? 'running'
                : 'pending';

          return (
            <WorkflowStepItem
              key={index}
              step={step}
              index={index}
              status={status}
              isLast={isLast}
            />
          );
        })}

        {/* Show progress log when running OR last progress when completed */}
        {(operationState === 'RUNNING' || (operationState === 'SUCCEEDED' && progressMessage)) && (
          <li className="flex gap-3">
            <div className="flex flex-col items-center">
              {operationState === 'RUNNING'
                ? <Loader2 className="w-5 h-5 text-blue-500 dark:text-blue-400 animate-spin shrink-0" aria-hidden="true" />
                : <CheckCircle className="w-5 h-5 text-green-500 dark:text-green-400 shrink-0" aria-hidden="true" />
              }
            </div>
            <div className="pb-4 flex-1 min-w-0">
              {progressMessage ? (
                <details open={operationState === 'RUNNING'}>
                  <summary className="text-xs text-primary cursor-pointer hover:underline">
                    {operationState === 'RUNNING' ? 'Live progress' : 'Xem log xử lý'}
                  </summary>
                  <pre className="mt-1 text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed text-foreground">
                    {progressMessage}
                  </pre>
                </details>
              ) : (
                <p className="text-sm text-muted-foreground italic">Đang xử lý bước tiếp theo...</p>
              )}
            </div>
          </li>
        )}
      </ol>

      <SubStepsPanel subSteps={subSteps} />
    </div>
  );
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Bảng các bước con: connector nào được gọi, model, trạng thái, thời gian, token, chi phí, lỗi. */
function SubStepsPanel({ subSteps }: { subSteps?: SubStep[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!subSteps || subSteps.length === 0) return null;

  const failed = subSteps.filter((s) => s.state === 'FAILED').length;
  const hasContent = subSteps.some((s) => s.prompt != null || s.output != null);

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
        <Network className="w-4 h-4 text-primary" aria-hidden="true" />
        Bước con (connector đã gọi)
        <span className="text-xs font-normal text-muted-foreground">
          ({subSteps.length}{failed > 0 ? ` · ${failed} lỗi` : ''})
        </span>
      </button>

      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Danh sách bước con của workflow</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="pb-2 pr-3 font-medium">#</th>
                <th scope="col" className="pb-2 pr-3 font-medium">Connector</th>
                <th scope="col" className="pb-2 pr-3 font-medium">Model</th>
                <th scope="col" className="pb-2 pr-3 font-medium">File</th>
                <th scope="col" className="pb-2 pr-3 font-medium">Trạng thái</th>
                <th scope="col" className="pb-2 pr-3 font-medium">Bắt đầu</th>
                <th scope="col" className="pb-2 pr-3 font-medium text-right">Thời gian</th>
                <th scope="col" className="pb-2 pr-3 font-medium text-right">Token in / out</th>
                <th scope="col" className="pb-2 pr-3 font-medium text-right">Chi phí</th>
                <th scope="col" className="pb-2 font-medium">Prompt</th>
              </tr>
            </thead>
            <tbody>
              {subSteps.map((s, i) => (
                <Fragment key={s.id}>
                <tr className="border-b border-border/50 align-top">
                  <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-foreground">{s.processor ?? '—'}</span>
                    {(s.errorCode || s.errorMessage) && (
                      <p className="mt-1 text-[11px] text-red-600 dark:text-red-400 break-words max-w-[360px]">
                        {s.errorCode && <code className="font-mono">{s.errorCode}</code>}
                        {s.errorCode && s.errorMessage ? ' — ' : ''}
                        {s.errorMessage}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {s.model ?? '—'}
                    {s.reasoningEffort && <span className="ml-1 text-[10px]">({s.reasoningEffort})</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground max-w-[180px] truncate" title={s.fileName ?? undefined}>
                    {s.fileName ?? '—'}
                  </td>
                  <td className="py-2 pr-3"><SubStepState state={s.state} /></td>
                  <td className="py-2 pr-3 text-muted-foreground tabular-nums" title={s.createdAt}>{formatTime(s.createdAt)}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{formatDurationMs(s.durationMs)}</td>
                  <td className="py-2 pr-3 text-right text-foreground tabular-nums">
                    {formatTokens(s.inputTokens)} / {formatTokens(s.outputTokens)}
                  </td>
                  <td className="py-2 pr-3 text-right text-foreground tabular-nums">{formatCost(s.costUsd)}</td>
                  <td className="py-2 text-muted-foreground">
                    {s.promptLength !== null ? (
                      <span title={s.promptSha256 ? `sha256: ${s.promptSha256}` : undefined}>
                        {formatTokens(s.promptLength)} ký tự
                      </span>
                    ) : '—'}
                    {(s.prompt != null || s.output != null) && (
                      <button
                        type="button"
                        onClick={() => setExpanded((v) => (v === s.id ? null : s.id))}
                        aria-expanded={expanded === s.id}
                        className="ml-2 text-primary hover:underline"
                      >
                        {expanded === s.id ? 'Ẩn' : 'Xem'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === s.id && (
                  <tr className="border-b border-border/50">
                    <td colSpan={10} className="py-2">
                      <p className="mb-1 font-medium text-foreground">Prompt</p>
                      <pre className="mb-3 text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed text-foreground">
                        {s.prompt ?? '—'}
                      </pre>
                      <p className="mb-1 font-medium text-foreground">Kết quả</p>
                      <pre className="text-xs bg-muted/50 rounded-lg p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto font-mono leading-relaxed text-foreground">
                        {s.output ?? '—'}
                      </pre>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {hasContent
              ? 'Prompt và kết quả của bước con (không gồm file) được giữ theo thời hạn lưu nội dung của Operation; chỉ ADMIN xem được.'
              : 'Nội dung prompt và kết quả của bước con không được lưu trữ sau khi workflow kết thúc.'}
          </p>
        </div>
      )}
    </div>
  );
}

function SubStepState({ state }: { state: string }) {
  const known = ['SUCCEEDED', 'FAILED', 'RUNNING', 'WAITING_USER_INPUT', 'CANCELLED', 'PENDING'];
  if (known.includes(state)) return <OperationStateBadge state={state as OperationState} />;
  return <span className="text-muted-foreground">{state}</span>;
}

/** Single workflow step: number, status, name, processor — no artifacts. */
function WorkflowStepItem({
  step,
  index,
  status,
  isLast,
}: {
  step: StepResult;
  index: number;
  status: StepDisplayStatus;
  isLast: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        {STATUS_ICON[status]}
        {!isLast && <div className="w-px flex-1 min-h-[24px] bg-border" />}
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Bước {index + 1}
          </span>
          <span className="text-xs text-muted-foreground">
            ({STATUS_LABEL[status]})
          </span>
          {step.status && (
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{step.status}</span>
          )}
          {step.is_human_edited && (
            <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 px-1.5 py-0.5 rounded">Đã chỉnh tay</span>
          )}
        </div>
        <p className="text-sm font-medium text-foreground">
          {step.stepName || step.processor || '—'}
        </p>
        {step.processor && step.stepName && step.processor !== 'code' && step.processor !== 'webhook' && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Processor: <span className="font-mono">{step.processor}</span>
            {typeof step.sub_result_count === 'number' && step.sub_result_count > 0 && (
              <span className="ml-2">· {step.sub_result_count} kết quả con</span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

/** Timeline for standard pipeline operations — renders from pipelineJson */
function StandardPipelineTimeline({
  pipelineJson,
  stepsResultJson,
  currentStep,
  failedAtStep,
  operationState,
}: {
  pipelineJson: PipelineStep[];
  stepsResultJson: StepResult[];
  currentStep: number;
  failedAtStep: number | null;
  operationState: OperationState;
}) {
  if (!pipelineJson || pipelineJson.length === 0) return null;

  return (
    <div className="modern-card p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        Pipeline
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          ({pipelineJson.length} bước)
        </span>
      </h3>
      <ol className="relative space-y-0">
        {pipelineJson.map((step, index) => {
          const status = getStepDisplayStatus(index, stepsResultJson, currentStep, failedAtStep, operationState);
          const result = stepsResultJson.find((r) => r.step === index);
          const isLast = index === pipelineJson.length - 1;

          return (
            <li key={index} className="flex gap-3">
              <div className="flex flex-col items-center">
                {STATUS_ICON[status]}
                {!isLast && <div className="w-px flex-1 min-h-[24px] bg-border" />}
              </div>
              <div className="pb-4 flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">Bước {index + 1}</span>
                  <span className="text-xs text-muted-foreground">({STATUS_LABEL[status]})</span>
                </div>
                <p className="text-sm font-medium text-foreground font-mono">
                  {step.processor ?? '—'}
                </p>
                {result?.output_format && (
                  <p className="text-xs text-muted-foreground mt-0.5">Format: {result.output_format}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
