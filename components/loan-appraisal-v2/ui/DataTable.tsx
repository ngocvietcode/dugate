'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './Button';

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
}

const PAGE = 50;

/** Bảng có caption cho trình đọc màn hình, vùng cuộn focus được, và "Hiện thêm" sau 50 dòng. */
export function DataTable<Row>({ caption, columns, rows, rowKey, empty, minWidth = 640 }: {
  caption: string;
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row, index: number) => string;
  empty: string;
  minWidth?: number;
}) {
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.slice(0, limit);
  return (
    <div>
      <div tabIndex={0} role="region" aria-label={caption} className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <table className="w-full border-collapse text-left" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 text-xs font-semibold text-muted-foreground">{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-xs text-muted-foreground">{empty}</td></tr>
            ) : visible.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-t border-border align-top">
                {columns.map((column) => (
                  <td key={column.key} className={`px-3 py-2 text-xs ${column.className ?? ''}`}>{column.cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Đang hiện {limit}/{rows.length} dòng</span>
          <Button size="sm" onClick={() => setLimit((value) => value + PAGE)}>Hiện thêm</Button>
        </div>
      )}
    </div>
  );
}
