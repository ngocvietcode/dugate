// app/tracing-portal/components/ResultTable.tsx
// Table displaying extracted BBKQ data with highlight for discrepancies.

import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import type { TracingDocument } from '../types';

interface ResultTableProps {
  documents: TracingDocument[];
}

function hasDiscrepancy(doc: TracingDocument): boolean {
  const amount = doc.extracted_data?.so_tien_chenh_lech;
  if (!amount) return false;
  return amount !== '0';
}

export function ResultTable({ documents }: ResultTableProps) {
  const successDocs = documents.filter((d) => d.status === 'success');
  const errorDocs = documents.filter((d) => d.status === 'error');

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {successDocs.length} thành công
        </span>
        {errorDocs.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
            {errorDocs.length} lỗi
          </span>
        )}
      </div>

      {/* Error files */}
      {errorDocs.length > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-1">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">Các file lỗi:</p>
          {errorDocs.map((doc, idx) => (
            <p key={`${doc.file_name}-${idx}`} className="text-sm text-red-600 dark:text-red-300">
              • {doc.file_name}{doc.error_message ? `: ${doc.error_message}` : ''}
            </p>
          ))}
        </div>
      )}

      {/* Results table */}
      {successDocs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-sm" role="table" aria-label="Kết quả trích xuất biên bản kiểm quỹ">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">#</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Tên file</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Loại tài liệu</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Đơn vị tiếp quỹ</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Mã máy</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Loại máy</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Ngày BĐ chu kỳ</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Ngày kiểm quỹ</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">Chênh lệch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {successDocs.map((doc, idx) => {
                const highlighted = hasDiscrepancy(doc);
                return (
                  <tr
                    key={`${doc.file_name}-${idx}`}
                    className={highlighted
                      ? 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/30'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                    }
                  >
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate" title={doc.file_name}>{doc.file_name}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{doc.extracted_data?.loai_tai_lieu ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{doc.extracted_data?.don_vi_tiep_quy ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 font-mono">{doc.extracted_data?.ma_may ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{doc.extracted_data?.loai_may ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{doc.extracted_data?.ngay_bat_dau_chu_ky ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{doc.extracted_data?.ngay_kiem_quy ?? '—'}</td>
                    <td className={`px-3 py-2 font-medium ${highlighted ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                      {doc.extracted_data?.so_tien_chenh_lech ?? '—'}
                      {highlighted && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-amber-500" aria-label="Có chênh lệch" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
