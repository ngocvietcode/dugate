// app/payment-account-management/components/card-grouping.ts
// How result cards are grouped for display. Pure, so the ordering rules can be
// unit-tested without a JSX transformer (same split as FieldRenderer.helpers.ts).

import type { DocCard } from '../types';
import { isFormTemplate } from './field-labels';

/**
 * Split a card list into application forms (mẫu biểu) and everything else,
 * preserving the incoming order within each group.
 *
 * Forms come first because they are the point of the run: in `update` mode MB03
 * is the required document and the ONLY one extracted; in `open` mode MB02/MB04
 * are the application itself. The rest of the dossier is supporting context, so
 * the document that matters shouldn't need a scroll to reach.
 *
 * Cards classified `unknown` (or not yet classified) land in `others` — their own
 * grey styling already flags them, so they don't warrant a separate group.
 */
export function partitionByFormTemplate(cards: ReadonlyArray<DocCard>): {
  forms: DocCard[];
  others: DocCard[];
} {
  const forms: DocCard[] = [];
  const others: DocCard[] = [];
  for (const card of cards) {
    (isFormTemplate(card.classification?.code) ? forms : others).push(card);
  }
  return { forms, others };
}

/** One split-mode group: the parent scan file and the segments cut out of it. */
export interface FileGroup {
  fileId: string;
  name: string;
  cards: DocCard[];
}

/**
 * Group split segments by the parent scan file they came from, in first-seen
 * order. This grouping is the OUTER axis in split mode: it exists so a reviewer
 * can see which scan each segment came from, and re-cutting the list by document
 * type instead would destroy that.
 */
export function groupByParentFile(cards: ReadonlyArray<DocCard>): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const card of cards) {
    const fileId = card.source?.file_id ?? '—';
    if (!groups.has(fileId)) {
      groups.set(fileId, {
        fileId,
        name: card.source?.name ?? card.fileName,
        cards: [],
      });
    }
    groups.get(fileId)!.cards.push(card);
  }
  return [...groups.values()];
}
