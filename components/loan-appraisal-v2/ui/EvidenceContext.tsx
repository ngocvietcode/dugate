'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { EvidenceRecord } from '@/app/loan-appraisal/types';
import { buildEvidenceLookup } from '@/app/loan-appraisal-v2/lib/selectors';

const EvidenceContext = createContext<Map<string, EvidenceRecord>>(new Map());

export function EvidenceProvider({ records, children }: { records: EvidenceRecord[] | null | undefined; children: ReactNode }) {
  const lookup = useMemo(() => buildEvidenceLookup(records), [records]);
  return <EvidenceContext.Provider value={lookup}>{children}</EvidenceContext.Provider>;
}

export function useEvidenceLookup(): Map<string, EvidenceRecord> {
  return useContext(EvidenceContext);
}
