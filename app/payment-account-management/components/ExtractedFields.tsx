'use client';

// app/payment-account-management/components/ExtractedFields.tsx
// One document's extracted-field panel: human labels (from the UI-owned
// `field-labels` map), per-leaf confidence, structured rendering for nested
// objects and arrays of records, plus a low-confidence filter and Copy JSON.
// All the recursive rendering lives in FieldRenderer; this file is just the
// toolbar + wrapper.
//
// This component does NOT import from `@/lib/pipelines/...` on purpose — the
// UI keeps its own duplicate of the labels so the client bundle has no
// server-only code chained in and the app/lib layers stay decoupled.

import React, { useState } from 'react';
import { TopLevelFields } from './FieldRenderer';
import { hasAnyValidation } from './validation-summary';
import { T, EYEBROW, CONFIDENCE_MID } from './ui';

interface ExtractedFieldsProps {
  fields: Record<string, unknown>;
  /**
   * Document code from classification (e.g. "MB01"). Used to look up display
   * labels in the UI's own `field-labels` map. When omitted or unknown, or when
   * a specific key has no mapping, the renderer falls back to the raw key —
   * the UI stays functional, just with less friendly copy.
   */
  docCode?: string;
}

/**
 * Threshold for the "chỉ hiện <60%" review filter — the confidence badge's amber
 * boundary (shared from ./ui), so what the badge calls "amber-or-red" is exactly
 * what the filter surfaces. Fields with a NULL confidence (AI didn't emit a
 * marker) are also shown, since they're effectively "unknown quality".
 */
const LOW_CONFIDENCE_THRESHOLD = CONFIDENCE_MID;

/** One review filter checkbox. Both toolbar filters render identically. */
function FilterToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className={`flex items-center gap-1 ${T.micro} text-muted-foreground cursor-pointer select-none`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3 h-3 accent-primary"
      />
      {label}
    </label>
  );
}

export function ExtractedFields({ fields, docCode }: ExtractedFieldsProps) {
  const [copied, setCopied] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  const [reconciledOnly, setReconciledOnly] = useState(false);
  const entries = Object.entries(fields);

  // Only offer the reconciliation filter when this document actually carries
  // validations (mode=update at stage e2e); it would be a dead toggle otherwise.
  const hasValidations = hasAnyValidation(fields);

  // The reconciled-only view keeps just the top-level fields that carry a
  // validation somewhere beneath them — 8 checks out of hundreds of MB03 fields.
  const visibleFields = reconciledOnly
    ? Object.fromEntries(entries.filter(([, v]) => hasAnyValidation(v)))
    : fields;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(fields, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (entries.length === 0) {
    return <p className={`${T.body} text-muted-foreground italic`}>Không có trường nào.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar: field count · filters · copy JSON */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={EYEBROW}>{entries.length} trường</span>
        <div className="flex items-center gap-3">
          {hasValidations && (
            <FilterToggle
              checked={reconciledOnly}
              onChange={setReconciledOnly}
              label="Chỉ hiện field đã đối chiếu"
            />
          )}
          <FilterToggle
            checked={lowOnly}
            onChange={setLowOnly}
            label={`Chỉ hiện < ${Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}%`}
          />
          <button
            type="button"
            onClick={handleCopy}
            className={`${T.micro} text-primary hover:underline font-medium rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50`}
          >
            {copied ? '✓ Đã copy' : '⧉ Copy JSON'}
          </button>
        </div>
      </div>

      {/* The recursive tree: scalar band + one section per container field.
       *  Labels are resolved by `docCode` via the UI-owned `field-labels` map. */}
      <TopLevelFields
        fields={visibleFields}
        docCode={docCode}
        lowOnly={lowOnly}
        threshold={LOW_CONFIDENCE_THRESHOLD}
      />
    </div>
  );
}
