'use client';

import { Info, KeyRound, Package, Route, UserRound, WalletCards } from 'lucide-react';
import type { LoanFlow } from '@/app/loan-appraisal/types';
import { COPY } from '@/app/loan-appraisal-v2/copy';
import { PRODUCT_OPTIONS, flowOptionsFor } from '@/app/loan-appraisal-v2/lib/product-options';
import type { RunPhase } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FOCUS_RING } from '../ui/toneClasses';
import { FileList, type FileEntry } from './FileList';
import { RunControls } from './RunControls';
import { UploadDropzone } from './UploadDropzone';

const INPUT = `h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60 ${FOCUS_RING}`;

export interface CaseSetupProps {
  phase: RunPhase;
  apiKey: string;
  onApiKey: (value: string) => void;
  productCode: string;
  productLocked: boolean;
  onProduct: (value: string) => void;
  flow: LoanFlow;
  onFlow: (value: LoanFlow) => void;
  customerName: string;
  customerLocked: boolean;
  onCustomerName: (value: string) => void;
  loanNeed: string;
  onLoanNeed: (value: string) => void;
  /** Tham số stop_after_intake: chọn = dừng sau giai đoạn 1, bỏ chọn (mặc định) = chạy hết một lần. */
  stopAfterIntake?: boolean;
  onStopAfterIntake?: (value: boolean) => void;
  entries: FileEntry[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onRun: () => void;
  onCancel: () => void;
}

export function CaseSetupPanel(props: CaseSetupProps) {
  const busy = props.phase === 'submitting' || props.phase === 'running' || props.phase === 'cancelling' || props.phase === 'resuming';
  const flowOptions = flowOptionsFor(props.productCode);
  const rerunnable = props.phase === 'succeeded' || props.phase === 'failed' || props.phase === 'cancelled' || props.phase === 'paused';
  const canRun = props.entries.length > 0 && !busy && props.apiKey.trim().length > 0;
  return (
    <Card labelledBy="la2-setup-title">
      <CardHeader id="la2-setup-title" title="Thiết lập hồ sơ" subtitle="API key, sản phẩm, luồng vay và tài liệu đầu vào" />
      <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="la2-api-key" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><KeyRound className="h-3.5 w-3.5" aria-hidden />API key</label>
              <input id="la2-api-key" type="password" autoComplete="off" value={props.apiKey} onChange={(event) => props.onApiKey(event.target.value)} disabled={busy} placeholder="API key cho phiên thẩm định" className={INPUT} />
            </div>
            <div>
              <label htmlFor="la2-product" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Package className="h-3.5 w-3.5" aria-hidden />Sản phẩm vay</label>
              <select id="la2-product" value={props.productCode} onChange={(event) => props.onProduct(event.target.value)} disabled={busy || props.productLocked} className={INPUT}>
                {PRODUCT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="la2-flow" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Route className="h-3.5 w-3.5" aria-hidden />Luồng vay</label>
              <select id="la2-flow" value={props.flow} onChange={(event) => props.onFlow(event.target.value as LoanFlow)} disabled={busy} className={INPUT}>
                {flowOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">Luồng thuộc chương trình checklist của sản phẩm; mỗi luồng áp một bộ checklist khác nhau.{rerunnable && ' Đổi luồng rồi bấm Chạy lại sẽ tạo phiên thẩm định mới với luồng đã chọn.'}</p>
            <div>
              <label htmlFor="la2-customer" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><UserRound className="h-3.5 w-3.5" aria-hidden />Khách hàng</label>
              <input id="la2-customer" value={props.customerName} onChange={(event) => props.onCustomerName(event.target.value)} disabled={busy || props.customerLocked} placeholder="Nguyễn Văn A" className={INPUT} />
            </div>
            <div>
              <label htmlFor="la2-need" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><WalletCards className="h-3.5 w-3.5" aria-hidden />Nhu cầu vay</label>
              <input id="la2-need" value={props.loanNeed} onChange={(event) => props.onLoanNeed(event.target.value)} disabled={busy} placeholder="2.500.000.000 đ" className={INPUT} />
            </div>
          </div>
          <label htmlFor="la2-stop-after-intake" className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
            <input id="la2-stop-after-intake" type="checkbox" checked={Boolean(props.stopAfterIntake)} onChange={(event) => props.onStopAfterIntake?.(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0" />
            <span><span className="font-semibold text-foreground">Dừng sau giai đoạn 1 (<code>stop_after_intake</code>)</span><span className="mt-0.5 block text-muted-foreground">Chỉ phân loại và kiểm tra sơ bộ, xem kết quả rồi mới chuyển sang giai đoạn 2. Bỏ chọn: chạy hết cả 2 giai đoạn một lần.</span></span>
          </label>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Tên khách hàng và nhu cầu vay chỉ để trình bày; hệ thống dùng dữ liệu trích xuất từ chứng từ.</p>
        </div>
        <div className="space-y-3">
          <UploadDropzone disabled={busy} onFiles={props.onFiles} />
          <FileList entries={props.entries} locked={busy} onRemove={props.onRemove} onClear={props.onClear} />
          <RunControls phase={props.phase} canRun={canRun} onRun={props.onRun} onCancel={props.onCancel} />
          {!canRun && !busy && props.phase === 'idle' && <p className="text-xs text-[rgb(var(--la2-warning))]">{COPY.quickRun}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
