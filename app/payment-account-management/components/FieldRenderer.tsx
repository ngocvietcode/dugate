'use client';

// app/payment-account-management/components/FieldRenderer.tsx
// Recursive renderer for one document's extracted-field tree.
//
// `parseFieldConfidence` produces a tree where scalars are wrapped as
// { value, confidence }, but containers (arrays and objects) stay unwrapped so
// the container shape is preserved. This file renders that tree:
//
//   scalar leaf         → row in a 2-column table + confidence badge
//   plain object        → nested 2-column table (per-key rows)
//   array of scalars    → chip list
//   array of records    → stack of numbered RecordCards
//   empty array / null  → "Không có" placeholders
//
// The pure helpers (`classifyShape`, `aggregateConfidence`, `isScalarWrapper`)
// are exported for unit testing — no React rendering involved.

import React, { useState } from 'react';
import type { FieldValidationEntry } from '../types';
import { getFieldLabel, getRecordLabel, getListFieldKind, type ListFieldKind } from './field-labels';
import { readLeafValidations, hasFailedValidation } from './validation-summary';
import {
  T,
  Badge,
  StatusBadge,
  ConfidenceBadge,
  FailMarker,
  ComparePair,
} from './ui';
import {
  classifyShape,
  aggregateConfidence,
  hasLowConfidence,
  type ParsedLeaf,
} from './FieldRenderer.helpers';

// The pure classification / aggregation helpers live in `./FieldRenderer.helpers`
// so they can be unit-tested without a JSX-aware transformer. Re-export the ones
// callers of this file might want, so consumers only need one import site.
export {
  classifyShape,
  aggregateConfidence,
  hasLowConfidence,
  isScalarWrapper,
} from './FieldRenderer.helpers';
export type { ParsedLeaf, FieldShape } from './FieldRenderer.helpers';

// ─── Small formatting helpers ───────────────────────────────────────────────

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function formatValue(value: unknown): string {
  if (isEmptyValue(value)) return '—';
  if (typeof value === 'boolean') return value ? '✓ có' : '✗ không';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ─── Per-field validation (mode=update reconciliation) ──────────────────────
// The update runner attaches its compare results INSIDE the extracted tree: any
// leaf it judged becomes { value, confidence, validation: [...] }. Rendering them
// here — on the field itself, next to the bank's value — is the whole point of
// the feature: a reviewer sees the mismatch where they'd look for it.

/**
 * One validation entry under its field: status chip, the RAW bank value it was
 * compared against, and (for non-passes) the LLM's Vietnamese reason.
 *
 * The status label is dropped here — the chip sits directly beneath the field it
 * judged, so the icon plus the comparison carries it without repeating "Lệch"
 * next to a value the reader can already see differs.
 */
function ValidationRow({ entry }: { entry: FieldValidationEntry }) {
  return (
    <div
      className={`flex items-start gap-1.5 ${T.meta}`}
      title={entry.reason ?? entry.code}
    >
      <StatusBadge status={entry.status} size="nano" compact />
      <ComparePair bankValue={entry.bank_value} showDoc={false} />
      {entry.status !== 'pass' && entry.reason && (
        <span className="text-muted-foreground/80 italic break-words flex-1">{entry.reason}</span>
      )}
    </div>
  );
}

/**
 * Render one scalar leaf's value + optional confidence badge, inline, plus any
 * validation entries the update runner attached to it.
 */
function LeafValue({ leaf }: { leaf: ParsedLeaf }) {
  const validations = readLeafValidations(leaf);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <span>{formatValue(leaf.value)}</span>
        {leaf.confidence !== null && !isEmptyValue(leaf.value) && (
          <ConfidenceBadge score={leaf.confidence} />
        )}
      </div>
      {validations.map((entry, i) => <ValidationRow key={i} entry={entry} />)}
    </div>
  );
}

// ─── List rendering (three kinds, three different claims) ───────────────────

/**
 * Render a list field's items in the form its kind warrants:
 *   ticks   → ☑ chips, wrapping inline (an unordered set of ticked options)
 *   ordered → numbered rows (position carries meaning)
 *   items   → bulleted rows (a plain collection: documents, account numbers, …)
 *
 * The marker is the claim: a number asserts sequence, a tick asserts someone
 * checked a box. `items` is the neutral default — see `ListFieldKind`.
 */
function ListItems({ items, kind }: { items: unknown[]; kind: ListFieldKind }) {
  if (kind === 'ticks') {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className={`inline-flex items-start gap-1 max-w-full px-2 py-0.5 rounded-md bg-primary/5 border border-primary/20 ${T.meta} leading-snug`}
          >
            <span className="shrink-0 text-primary" aria-hidden="true">☑</span>
            <span className="break-words">{formatValue(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  const Tag = kind === 'ordered' ? 'ol' : 'ul';
  return (
    <Tag className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-2 ${T.meta} leading-snug`}>
          <span
            className="shrink-0 mt-px w-4 text-right tabular-nums text-muted-foreground"
            aria-hidden={kind === 'items' ? true : undefined}
          >
            {kind === 'ordered' ? `${i + 1}.` : '•'}
          </span>
          <span className="break-words">{formatValue(item)}</span>
        </li>
      ))}
    </Tag>
  );
}

// ─── Collapsible header (shared by ContainerSection and RecordCard) ─────────

/**
 * The disclosure row both collapsible shells use: caret, title with a muted
 * subtitle, then the fail marker and rolled-up confidence. Was duplicated in
 * both components, which is how their padding and text sizes drifted apart.
 */
function CollapsibleHeader({
  open,
  onToggle,
  title,
  subtitle,
  hasFail,
  confidence,
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  subtitle?: string;
  hasFail: boolean;
  confidence: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
    >
      <span className={`${T.body} text-muted-foreground`} aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
      <span className={`${T.body} font-semibold flex-1 truncate`}>
        {title}
        {subtitle && <span className="text-muted-foreground font-normal"> · {subtitle}</span>}
      </span>
      {hasFail && <FailMarker />}
      {confidence !== null && <ConfidenceBadge score={confidence} />}
    </button>
  );
}

// ─── Scalar 2-column table (shared building block) ──────────────────────────

interface ScalarRow {
  key: string;
  label: string;
  leaf: ParsedLeaf | null;
}

function ScalarTable({ rows }: { rows: ScalarRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <table className={`w-full ${T.body}`}>
        <tbody>
          {rows.map(({ key, label, leaf }, i) => (
            <tr key={key} className={i % 2 === 0 ? 'bg-muted/30' : ''}>
              <td className={`px-2.5 py-1.5 ${T.meta} text-muted-foreground align-top w-2/5 break-words`}>
                {label}
              </td>
              <td className="px-2.5 py-1.5 align-top break-words">
                {leaf === null ? (
                  <span className="text-muted-foreground italic">—</span>
                ) : (
                  <LeafValue leaf={leaf} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Numbered record card (one item in an array-of-records) ─────────────────

interface RecordCardProps {
  record: Record<string, unknown>;
  /** Parent field key — drives `getRecordLabel` lookup. */
  parentKey: string;
  /** Document code — passed through for any nested container that needs
   *  top-level `getFieldLabel` (rare; kept for symmetry with the container path). */
  docCode: string | undefined;
  /** 0-based position in the list; shown as `#index+1`. */
  index: number;
  defaultOpen: boolean;
  lowOnly: boolean;
  threshold: number;
}

/**
 * One record inside an array-of-objects field. Header shows "#N · <name>" plus
 * an aggregate-confidence badge; body is a scalar table for the record's scalar
 * fields plus a nested ContainerSection for any sub-container.
 */
export function RecordCard({
  record,
  parentKey,
  docCode,
  index,
  defaultOpen,
  lowOnly,
  threshold,
}: RecordCardProps) {
  const hasFail = hasFailedValidation(record);
  // A record hiding a mismatch starts expanded — otherwise the one thing wrong in
  // the dossier sits behind a collapsed header the reviewer has no reason to open.
  const [open, setOpen] = useState(defaultOpen || hasFail);
  const { avg } = aggregateConfidence(record);

  // Try to pull a display name from `full_name` (common across our person schemas).
  // If it's not a scalar or is empty, we fall back to just "#N".
  const nameShape = classifyShape(record.full_name);
  const displayName =
    nameShape.kind === 'scalar' && !isEmptyValue(nameShape.leaf.value)
      ? String(nameShape.leaf.value)
      : null;

  // Split the record's fields into scalar rows and container entries.
  const scalarRows: ScalarRow[] = [];
  const containerEntries: [string, unknown][] = [];
  for (const [k, v] of Object.entries(record)) {
    const s = classifyShape(v);
    if (s.kind === 'scalar') {
      scalarRows.push({ key: k, label: getRecordLabel(parentKey, k), leaf: s.leaf });
    } else if (s.kind === 'null') {
      scalarRows.push({ key: k, label: getRecordLabel(parentKey, k), leaf: null });
    } else {
      containerEntries.push([k, v]);
    }
  }

  // Low-conf filter: keep rows whose confidence is missing (unknown) or below
  // the threshold. This surfaces both explicitly weak AI reads AND unmarked
  // fields that may need a second look.
  //
  // A row carrying a FAILED reconciliation is always kept, whatever its
  // confidence — see the matching note in ContainerSection.
  const filteredScalars = lowOnly
    ? scalarRows.filter(
        (r) =>
          r.leaf === null ||
          r.leaf.confidence === null ||
          r.leaf.confidence < threshold ||
          hasFailedValidation(r.leaf),
      )
    : scalarRows;

  return (
    <div className="rounded-lg border border-border/50">
      <CollapsibleHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        title={`#${index + 1}`}
        subtitle={displayName ?? undefined}
        hasFail={hasFail}
        confidence={avg}
      />
      {open && (
        <div className="p-3 pt-1 space-y-3">
          {filteredScalars.length > 0 ? (
            <ScalarTable rows={filteredScalars} />
          ) : (
            <p className={`${T.meta} text-muted-foreground italic`}>
              {lowOnly ? 'Không có trường nào dưới ngưỡng' : 'Không có trường'}
            </p>
          )}
          {containerEntries.map(([k, v]) => (
            <ContainerSection
              key={k}
              label={getRecordLabel(parentKey, k)}
              parentKey={k}
              value={v}
              docCode={docCode}
              lowOnly={lowOnly}
              threshold={threshold}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Container section (titled, collapsible wrapper around one field body) ──

interface ContainerSectionProps {
  label: string;
  parentKey: string;
  value: unknown;
  docCode: string | undefined;
  lowOnly: boolean;
  threshold: number;
}

export function ContainerSection({
  label,
  parentKey,
  value,
  docCode,
  lowOnly,
  threshold,
}: ContainerSectionProps) {
  const [open, setOpen] = useState(true);
  const shape = classifyShape(value);
  const { avg } = aggregateConfidence(value);
  const hasFail = hasFailedValidation(value);

  // A one-line subtitle so the reviewer can see the section shape at a glance
  // without expanding it.
  let subtitle = '';
  if (shape.kind === 'array-of-objects') subtitle = `${shape.items.length} bản ghi`;
  else if (shape.kind === 'array-of-scalars') subtitle = `${shape.items.length} mục`;
  else if (shape.kind === 'string-list') {
    // For a tick group the count is a selection ("2 đã tick"), not a length.
    subtitle = getListFieldKind(parentKey) === 'ticks'
      ? `${shape.items.length} đã tick`
      : `${shape.items.length} mục`;
  }
  else if (shape.kind === 'array-empty') subtitle = 'Không có';
  else if (shape.kind === 'null') subtitle = 'Không có dữ liệu';

  // When lowOnly is on, hide the whole section if there is nothing below the
  // threshold to look at. Keeps the review screen tight.
  //
  // A section holding a FAILED reconciliation is never hidden: the confidence
  // filter asks "did the AI read this well?", while a fail says "the AI read it
  // fine but it disagrees with the bank" — usually at high confidence. Filtering
  // those out would hide exactly what the reviewer is looking for.
  if (lowOnly && !hasLowConfidence(value, threshold) && !hasFail) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border/50">
      <CollapsibleHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        title={label}
        subtitle={subtitle || undefined}
        hasFail={hasFail}
        confidence={avg}
      />
      {open && (
        <div className="p-3 pt-1">
          <FieldBody
            value={value}
            parentKey={parentKey}
            docCode={docCode}
            lowOnly={lowOnly}
            threshold={threshold}
          />
        </div>
      )}
    </section>
  );
}

// ─── The recursive body renderer (dispatches on shape) ──────────────────────

interface FieldBodyProps {
  value: unknown;
  parentKey: string;
  docCode: string | undefined;
  lowOnly: boolean;
  threshold: number;
}

function FieldBody({
  value,
  parentKey,
  docCode,
  lowOnly,
  threshold,
}: FieldBodyProps) {
  const shape = classifyShape(value);

  // An empty tick group arrives as bare `null` (parseStringArrayConfidence maps
  // [] → null so "no data" has one shape), so both the null and empty-array
  // branches have to answer for it. For a tick group that is a real answer —
  // "nothing was ticked" — not absent data, and the distinction matters: the
  // org-name checks are gated on whether a specific option was ticked.
  const listKind = getListFieldKind(parentKey);

  if (shape.kind === 'null' || shape.kind === 'array-empty') {
    return (
      <p className={`${T.meta} text-muted-foreground italic`}>
        {listKind === 'ticks'
          ? 'Không có mục nào được tick'
          : shape.kind === 'null'
            ? 'Không có dữ liệu'
            : 'Không có'}
      </p>
    );
  }

  if (shape.kind === 'scalar') {
    return <LeafValue leaf={shape.leaf} />;
  }

  if (shape.kind === 'string-list') {
    // A wrapper whose value is an empty array (rare — parseStringArrayConfidence
    // normally maps [] to null, handled above).
    if (shape.items.length === 0) {
      return (
        <p className={`${T.meta} text-muted-foreground italic`}>
          {listKind === 'ticks' ? 'Không có mục nào được tick' : 'Không có'}
        </p>
      );
    }

    return (
      <div className="space-y-1.5">
        {/* One confidence covers the whole field, so the badge sits once here
            rather than being repeated on every item. */}
        {shape.confidence !== null && (
          <div className="flex justify-end">
            <ConfidenceBadge score={shape.confidence} />
          </div>
        )}
        <ListItems items={shape.items} kind={listKind} />
      </div>
    );
  }

  if (shape.kind === 'array-of-scalars') {
    // Coerce each element to a leaf so we get one rendering path.
    const leaves: ParsedLeaf[] = shape.items.map((it) => {
      if (it === null || it === undefined) return { value: null, confidence: null };
      const s = classifyShape(it);
      return s.kind === 'scalar' ? s.leaf : { value: it, confidence: null };
    });
    const filtered = lowOnly
      ? leaves.filter((l) => l.confidence === null || l.confidence < threshold)
      : leaves;
    if (filtered.length === 0) {
      return (
        <p className={`${T.meta} text-muted-foreground italic`}>
          {lowOnly ? 'Không có mục dưới ngưỡng' : 'Không có'}
        </p>
      );
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {filtered.map((leaf, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 ${T.meta}`}
          >
            {formatValue(leaf.value)}
            {leaf.confidence !== null && !isEmptyValue(leaf.value) && (
              <ConfidenceBadge score={leaf.confidence} />
            )}
          </span>
        ))}
      </div>
    );
  }

  if (shape.kind === 'array-of-objects') {
    const items = shape.items.map((rec, i) => ({ record: rec, originalIndex: i }));
    const filtered = lowOnly
      ? items.filter(({ record }) => hasLowConfidence(record, threshold))
      : items;
    if (filtered.length === 0) {
      return (
        <p className={`${T.meta} text-muted-foreground italic`}>
          {lowOnly ? 'Không có bản ghi dưới ngưỡng' : 'Không có'}
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {filtered.map(({ record, originalIndex }, listPos) => (
          <RecordCard
            key={originalIndex}
            record={record}
            parentKey={parentKey}
            docCode={docCode}
            index={originalIndex}
            // First rendered card is open; the rest collapsed so a 10-rep MB01
            // form is still scannable.
            defaultOpen={listPos === 0}
            lowOnly={lowOnly}
            threshold={threshold}
          />
        ))}
      </div>
    );
  }

  // shape.kind === 'object' (plain nested object)
  const scalarRows: ScalarRow[] = [];
  const containerEntries: [string, unknown][] = [];
  for (const [k, v] of shape.entries) {
    const s = classifyShape(v);
    const label = getRecordLabel(parentKey, k);
    if (s.kind === 'scalar') scalarRows.push({ key: k, label, leaf: s.leaf });
    else if (s.kind === 'null') scalarRows.push({ key: k, label, leaf: null });
    else containerEntries.push([k, v]);
  }
  const filteredScalars = lowOnly
    ? scalarRows.filter(
        (r) => r.leaf === null || r.leaf.confidence === null || r.leaf.confidence < threshold,
      )
    : scalarRows;
  return (
    <div className="space-y-2">
      <ScalarTable rows={filteredScalars} />
      {containerEntries.map(([k, v]) => (
        <ContainerSection
          key={k}
          label={getRecordLabel(parentKey, k)}
          parentKey={k}
          value={v}
          docCode={docCode}
          lowOnly={lowOnly}
          threshold={threshold}
        />
      ))}
    </div>
  );
}

// ─── Top-level entry: split a whole document's fields into two bands ────────

interface TopLevelFieldsProps {
  fields: Record<string, unknown>;
  /** Document code (e.g. "MB01") — drives top-level label lookup. */
  docCode: string | undefined;
  lowOnly: boolean;
  threshold: number;
}

/**
 * Render the WHOLE `extracted` bag: band 1 is the scalar table (uses top-level
 * labels via `getFieldLabel`), band 2 is one ContainerSection per non-scalar
 * field. Used by `ExtractedFields`.
 */
export function TopLevelFields({
  fields,
  docCode,
  lowOnly,
  threshold,
}: TopLevelFieldsProps) {
  const scalarRows: ScalarRow[] = [];
  const containerEntries: [string, unknown][] = [];

  for (const [k, v] of Object.entries(fields)) {
    const s = classifyShape(v);
    const label = getFieldLabel(docCode, k);
    if (s.kind === 'scalar') scalarRows.push({ key: k, label, leaf: s.leaf });
    else if (s.kind === 'null') scalarRows.push({ key: k, label, leaf: null });
    else containerEntries.push([k, v]);
  }

  const filteredScalars = lowOnly
    ? scalarRows.filter(
        (r) => r.leaf === null || r.leaf.confidence === null || r.leaf.confidence < threshold,
      )
    : scalarRows;

  return (
    <div className="space-y-3">
      {filteredScalars.length > 0 ? (
        <ScalarTable rows={filteredScalars} />
      ) : lowOnly && scalarRows.length > 0 ? (
        <p className={`${T.meta} text-muted-foreground italic`}>
          Không có trường nào dưới ngưỡng
        </p>
      ) : null}
      {containerEntries.map(([k, v]) => (
        <ContainerSection
          key={k}
          label={getFieldLabel(docCode, k)}
          parentKey={k}
          value={v}
          docCode={docCode}
          lowOnly={lowOnly}
          threshold={threshold}
        />
      ))}
    </div>
  );
}
