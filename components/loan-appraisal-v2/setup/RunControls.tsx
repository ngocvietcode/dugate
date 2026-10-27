'use client';

import { useState } from 'react';
import { Check, Loader2, Play, Square } from 'lucide-react';
import type { RunPhase } from '@/app/loan-appraisal-v2/lib/run-reducer';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function RunControls({ phase, canRun, onRun, onCancel }: {
  phase: RunPhase;
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
}) {
  const [confirm, setConfirm] = useState<'rerun' | 'cancel' | null>(null);
  const busy = phase === 'submitting' || phase === 'running' || phase === 'cancelling' || phase === 'resuming';
  const finished = phase === 'succeeded' || phase === 'failed' || phase === 'cancelled' || phase === 'paused';
  const label = busy ? 'Đang thẩm định' : phase === 'succeeded' ? 'Chạy lại' : finished ? 'Chạy lại' : 'Bắt đầu thẩm định';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        disabled={!canRun}
        onClick={() => (finished ? setConfirm('rerun') : onRun())}
        className="flex-1"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : phase === 'succeeded' ? <Check className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {label}
      </Button>
      {(phase === 'running' || phase === 'cancelling') && (
        <Button variant="danger" disabled={phase === 'cancelling'} onClick={() => setConfirm('cancel')}>
          <Square className="h-4 w-4" aria-hidden />
          {phase === 'cancelling' ? 'Đang huỷ…' : 'Huỷ'}
        </Button>
      )}

      <Dialog
        open={confirm === 'rerun'}
        onClose={() => setConfirm(null)}
        title="Chạy lại thẩm định?"
        description="Một phiên thẩm định mới sẽ được tạo và kết quả hiện tại sẽ được thay thế trên màn hình."
        footer={(
          <>
            <Button onClick={() => setConfirm(null)}>Giữ kết quả hiện tại</Button>
            <Button variant="primary" onClick={() => { setConfirm(null); onRun(); }}>Chạy lại</Button>
          </>
        )}
      />
      <Dialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title="Huỷ phiên thẩm định?"
        description="Workflow đang chạy sẽ bị dừng và không có kết quả. Thao tác này không hoàn tác được."
        footer={(
          <>
            <Button onClick={() => setConfirm(null)}>Tiếp tục chạy</Button>
            <Button variant="danger" onClick={() => { setConfirm(null); onCancel(); }}>Huỷ phiên</Button>
          </>
        )}
      />
    </div>
  );
}
