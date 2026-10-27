'use client';

// app/payment-account-management/components/ValidationSummary.tsx
// The reconciliation view for one MB03 document (mode=update, stage=e2e).
//
// Renders every compare as a named row — driven off the entry `code`, which the
// verify prompt guarantees is stable for exactly this purpose — so a reviewer
// sees all 8 checks in one place instead of hunting for 8 leaves inside a tree
// of hundreds of collapsed fields. Failures sort first.
//
// Rows come from ./validation-summary (pure, unit-tested). This file is layout.

import React, { useState } from 'react';
import type { BankData, CardValidation } from '../types';
import { buildSummaryRows, countRows, type SummaryRow } from './validation-summary';
import { T, EYEBROW, Badge, StatusBadge, ComparePair, STATUS } from './ui';

interface ValidationSummaryProps {
  /** The document's extracted tree — validations are attached to its leaves. */
  extracted: Record<string, unknown> | null;
  /** Doc-level envelope: carries `error` when the verify step could not run. */
  validation: CardValidation;
  /** The parsed payload the backend echoed back, for unmatched-people detection. */
  bankData: BankData | null;
}

/** Leaf values are `{ value, confidence }`; show the inner value as text. */
function docValueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Row({ row }: { row: SummaryRow }) {
  const showCompare = row.bankValue !== null || row.kind === 'checked';

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-t border-border/40 first:border-t-0">
      <StatusBadge status={row.status} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <p className={`${T.body} font-medium break-words`}>{row.label}</p>

        {showCompare && (
          <ComparePair
            bankValue={row.bankValue}
            docValue={docValueText(row.docValue)}
            // An unmatched bank record has no MB03 counterpart to show.
            showDoc={row.kind === 'checked'}
          />
        )}

        {row.reason && (
          <p className={`${T.micro} text-muted-foreground italic leading-snug break-words`}>
            {row.reason}
          </p>
        )}

        {row.path && (
          <p className={`${T.nano} font-mono text-muted-foreground/60 break-all`}>{row.path}</p>
        )}
      </div>
    </div>
  );
}

export function ValidationSummary({ extracted, validation, bankData }: ValidationSummaryProps) {
  const [showPassed, setShowPassed] = useState(false);

  // The verify step itself failed — no rows exist, so say why instead of
  // rendering an empty "all clear" panel.
  if (validation.error) {
    return (
      <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 flex flex-col gap-0.5">
        <p className={`${T.body} font-semibold text-amber-700`}>⚠ Không đối chiếu được</p>
        <p className={`${T.meta} text-amber-700/90 leading-snug`}>{validation.error}</p>
      </div>
    );
  }

  const { rows } = buildSummaryRows(extracted, bankData);
  const counts = countRows(rows);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 p-3">
        <p className={`${T.body} text-muted-foreground`}>
          Không có trường nào được đối chiếu.
          {' '}Kiểm tra lại dữ liệu core bank đã gửi ở <strong>metadata.data</strong>.
        </p>
      </div>
    );
  }

  const attention = rows.filter(r => r.status !== 'pass');
  const passed = rows.filter(r => r.status === 'pass');

  // The doc `summary` counts every entry the LLM emitted; our rows only include
  // entries whose path resolved in the tree. A gap means some entries were
  // silently dropped — surface it rather than letting the numbers disagree.
  const emitted = validation.summary.pass + validation.summary.fail + validation.summary.skip;
  const collected = rows.filter(r => r.kind === 'checked').length;
  const dropped = Math.max(0, emitted - collected);

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header: counts, in the same attention order the rows are sorted in.
          `pass` always shows so the panel states a total even when all is well. */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 flex-wrap">
        <span className={EYEBROW}>Đối chiếu MB03 ↔ Core bank</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {(['fail', 'missing', 'skip', 'pass'] as const).map((status) =>
            counts[status] > 0 || status === 'pass' ? (
              <Badge key={status} tone={STATUS[status].chip} title={STATUS[status].label}>
                <span aria-hidden="true">{STATUS[status].icon}</span>
                <span className="tabular-nums">{counts[status]}</span>
              </Badge>
            ) : null,
          )}
        </div>
      </div>

      {dropped > 0 && (
        <p className={`px-3 py-1.5 ${T.micro} text-amber-700 bg-amber-500/5 border-t border-amber-400/30 leading-snug`}>
          ⚠ {dropped} kết quả đối chiếu không gắn được vào trường nào trong MB03 (đường dẫn không khớp schema)
          — vẫn được tính trong tổng số nhưng không hiển thị bên dưới.
        </p>
      )}

      {/* Rows needing attention */}
      {attention.map((row, i) => <Row key={`a${i}`} row={row} />)}

      {attention.length === 0 && (
        <p className={`px-3 py-2 ${T.meta} text-emerald-600 border-t border-border/40`}>
          ✓ Tất cả {counts.pass} trường đối chiếu đều khớp.
        </p>
      )}

      {/* Passing rows, collapsed by default */}
      {passed.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPassed(o => !o)}
            aria-expanded={showPassed}
            className={`w-full px-3 py-1.5 ${T.micro} text-left text-muted-foreground hover:text-foreground hover:bg-muted/30 border-t border-border/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`}
          >
            {showPassed ? '▾ Ẩn' : '▸ Hiện'} {passed.length} trường khớp
          </button>
          {showPassed && passed.map((row, i) => <Row key={`p${i}`} row={row} />)}
        </>
      )}
    </div>
  );
}
