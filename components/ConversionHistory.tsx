'use client';

// components/ConversionHistory.tsx
// Reads from unified /api/operations endpoint

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, Clock, Ban, Trash2 } from 'lucide-react';

interface OperationItem {
  name: string;
  done: boolean;
  metadata: {
    state: string;
    pipeline: string[];
    progress_percent: number;
    create_time: string;
    update_time: string;
  };
}

function StatusBadge({ state }: { state: string }) {
  switch (state) {
    case 'RUNNING':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20"><Clock className="w-3 h-3" /> Đang xử lý</span>;
    case 'SUCCEEDED':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-600 border border-green-500/20"><CheckCircle2 className="w-3 h-3" /> Hoàn tất</span>;
    case 'FAILED':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-600 border border-red-500/20"><XCircle className="w-3 h-3" /> Thất bại</span>;
    case 'CANCELLED':
      return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-500/10 text-gray-500 border border-gray-500/20"><Ban className="w-3 h-3" /> Đã hủy</span>;
    default:
      return <span className="text-xs text-muted-foreground">{state}</span>;
  }
}

export default function ConversionHistory() {
  const { data: session } = useSession();
  const canDelete = session?.user?.role !== 'VIEWER';
  const [ops, setOps] = useState<OperationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/operations?page_size=50')
      .then(r => r.json())
      .then(data => { setOps(data.operations ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function deleteOp(opId: string) {
    if (!confirm('Xóa operation này?')) return;
    await fetch(`/api/operations/${opId}`, { method: 'DELETE' });
    setOps(prev => prev.filter(op => op.name !== `operations/${opId}`));
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
        <p className="text-muted-foreground font-medium">Đang tải lịch sử...</p>
      </div>
    );
  }

  if (ops.length === 0) {
    return (
      <div className="text-center py-16 modern-card p-8">
        <p className="text-muted-foreground font-medium">Chưa có hoạt động nào.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ops.map(op => {
        const opId = op.name.replace('operations/', '');
        const createdAt = new Date(op.metadata.create_time).toLocaleString('vi-VN');
        return (
          <div key={op.name} className="modern-card p-4 flex items-center gap-4 group hover:shadow-md transition-shadow">
            <div className="flex-1 min-w-0">
              <Link href={`/operations/${opId}`} className="block">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge state={op.metadata.state} />
                  <span className="text-xs text-muted-foreground">{createdAt}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {op.metadata.pipeline.map((p, i) => (
                    <span key={i} className="px-2 py-0.5 bg-muted text-xs font-medium rounded text-foreground border border-border">
                      {p}
                    </span>
                  ))}
                </div>
              </Link>
            </div>

            {canDelete && (
              <button
                onClick={() => deleteOp(opId)}
                className="shrink-0 p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
