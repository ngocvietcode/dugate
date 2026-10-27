'use client';

// app/structure-compare/components/MappingEditor.tsx
// Mapping editor with dropdown boxes. Manages internal state for edits,
// emits final result only on confirm.

import React, { useState, useCallback, useMemo } from 'react';
import { Check, RefreshCw, AlertTriangle, Unlink } from 'lucide-react';
import type { MappingEditorProps, MatchType } from '../types';
import { MATCH_TYPE_COLORS } from '../types';
import type { MappingEntry, MappingTable, OutlineSection } from '@/lib/structure-compare/types';
import { flattenSections } from '@/lib/structure-compare/section-mapper';

const BADGE_STYLES: Record<string, string> = {
  SAME: 'bg-green-100 text-green-700',
  RENUMBERED: 'bg-blue-100 text-blue-700',
  CHANGED: 'bg-yellow-100 text-yellow-800',
  NEW: 'bg-emerald-100 text-emerald-700',
  DELETED: 'bg-red-100 text-red-700',
  SPLIT: 'bg-purple-100 text-purple-700',
  MERGED: 'bg-purple-100 text-purple-700',
  MOVED: 'bg-orange-100 text-orange-700',
};

export function MappingEditor({
  mappingTable,
  onConfirm,
  onAutoRemap,
  onUnmatch,
  onReassign,
}: MappingEditorProps) {
  // Internal editable copy of entries
  const [entries, setEntries] = useState<MappingEntry[]>(() => [...mappingTable.entries]);
  const [hasEdits, setHasEdits] = useState(false);

  const v1Sections = useMemo(() => flattenSections(mappingTable.v1Outline.sections), [mappingTable]);
  const v2Sections = useMemo(() => flattenSections(mappingTable.v2Outline.sections), [mappingTable]);
  const v1Map = useMemo(() => new Map(v1Sections.map(s => [s.id, s])), [v1Sections]);
  const v2Map = useMemo(() => new Map(v2Sections.map(s => [s.id, s])), [v2Sections]);

  // Sort entries by V1 position
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const posA = a.v1Sections.length > 0
        ? Math.min(...a.v1Sections.map(id => v1Map.get(id)?.startPos ?? Infinity))
        : Infinity;
      const posB = b.v1Sections.length > 0
        ? Math.min(...b.v1Sections.map(id => v1Map.get(id)?.startPos ?? Infinity))
        : Infinity;
      if (posA === Infinity && posB === Infinity) {
        const v2PosA = a.v2Sections.length > 0 ? Math.min(...a.v2Sections.map(id => v2Map.get(id)?.startPos ?? Infinity)) : Infinity;
        const v2PosB = b.v2Sections.length > 0 ? Math.min(...b.v2Sections.map(id => v2Map.get(id)?.startPos ?? Infinity)) : Infinity;
        return v2PosA - v2PosB;
      }
      return posA - posB;
    });
  }, [entries, v1Map, v2Map]);

  const needsReviewCount = entries.filter(e => e.needsReview).length;

  // Determine match type from V1/V2 selection
  const inferMatchType = (v1Ids: string[], v2Ids: string[]): MatchType => {
    if (v1Ids.length === 0 && v2Ids.length > 0) return 'NEW';
    if (v1Ids.length > 0 && v2Ids.length === 0) return 'DELETED';
    return 'CHANGED';
  };

  // Handle V1 dropdown change
  const handleV1Change = useCallback((entryId: string, newV1Id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const v1Sections = newV1Id === '__none__' ? [] : [newV1Id];
      return { ...e, v1Sections, matchType: inferMatchType(v1Sections, e.v2Sections) };
    }));
    setHasEdits(true);
  }, []);

  // Handle V2 dropdown change
  const handleV2Change = useCallback((entryId: string, newV2Id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const v2Sections = newV2Id === '__none__' ? [] : [newV2Id];
      return { ...e, v2Sections, matchType: inferMatchType(e.v1Sections, v2Sections) };
    }));
    setHasEdits(true);
  }, []);

  // Unmatch: split into DELETED + NEW
  const handleUnmatch = useCallback((entryId: string) => {
    setEntries(prev => {
      const entry = prev.find(e => e.id === entryId);
      if (!entry) return prev;
      const others = prev.filter(e => e.id !== entryId);
      const newEntries: MappingEntry[] = [];
      if (entry.v1Sections.length > 0) {
        newEntries.push({ ...entry, id: `${entry.id}-del`, v2Sections: [], matchType: 'DELETED', confidenceScore: 100, needsReview: false });
      }
      if (entry.v2Sections.length > 0) {
        newEntries.push({ ...entry, id: `${entry.id}-new`, v1Sections: [], matchType: 'NEW', confidenceScore: 100, needsReview: false });
      }
      return [...others, ...newEntries];
    });
    setHasEdits(true);
  }, []);

  // Confirm: emit the edited mapping table
  const handleConfirm = useCallback(() => {
    const updatedTable: MappingTable = {
      ...mappingTable,
      entries,
      isLocked: true,
    };
    onConfirm(updatedTable);
  }, [mappingTable, entries, onConfirm]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700">BẢNG ÁNH XẠ CẤU TRÚC</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {entries.length} cặp • {mappingTable.autoMappedPercentage}% tự động
            {needsReviewCount > 0 && <span className="ml-1.5 text-yellow-600 font-medium">• {needsReviewCount} cần kiểm tra</span>}
            {hasEdits && <span className="ml-1.5 text-blue-600 font-medium">• Đã chỉnh sửa</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onAutoRemap} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50">
            <RefreshCw className="h-3 w-3" /> Auto-remap
          </button>
          <button onClick={handleConfirm} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
            <Check className="h-3.5 w-3.5" /> Xác nhận & Tiếp tục
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[36px_1fr_64px_1fr_32px] gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <span className="text-[10px] font-bold text-slate-500">#</span>
        <span className="text-[10px] font-bold text-slate-500">V1 (BẢN CŨ)</span>
        <span className="text-[10px] font-bold text-slate-500 text-center">LOẠI</span>
        <span className="text-[10px] font-bold text-slate-500">V2 (BẢN MỚI)</span>
        <span></span>
      </div>

      {/* Rows */}
      <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-50">
        {sortedEntries.map((entry, idx) => {
          const badgeStyle = BADGE_STYLES[entry.matchType] || 'bg-slate-100 text-slate-600';
          const hasWarning = entry.needsReview;
          const currentV1 = entry.v1Sections[0] || '__none__';
          const currentV2 = entry.v2Sections[0] || '__none__';

          return (
            <div key={entry.id} className={`grid grid-cols-[36px_1fr_64px_1fr_32px] gap-2 items-center px-4 py-2 ${hasWarning ? 'bg-yellow-50/40' : 'hover:bg-slate-50/50'}`}>
              <span className="text-xs text-slate-400 font-mono">{idx + 1}</span>

              {/* V1 dropdown */}
              <select
                value={currentV1}
                onChange={(e) => handleV1Change(entry.id, e.target.value)}
                className={`w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 ${
                  currentV1 === '__none__' ? 'text-red-400 italic' : ''
                }`}
              >
                <option value="__none__">[KHÔNG CÓ]</option>
                {v1Sections.map(s => (
                  <option key={s.id} value={s.id}>{s.identifier} — {s.title}</option>
                ))}
              </select>

              {/* Match type */}
              <div className="flex flex-col items-center gap-0.5">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${badgeStyle}`}>{entry.matchType}</span>
                {hasWarning && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
              </div>

              {/* V2 dropdown */}
              <select
                value={currentV2}
                onChange={(e) => handleV2Change(entry.id, e.target.value)}
                className={`w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 ${
                  currentV2 === '__none__' ? 'text-emerald-500 italic' : ''
                }`}
              >
                <option value="__none__">[KHÔNG CÓ]</option>
                {v2Sections.map(s => (
                  <option key={s.id} value={s.id}>{s.identifier} — {s.title}</option>
                ))}
              </select>

              {/* Unmatch */}
              <div className="flex justify-center">
                {entry.v1Sections.length > 0 && entry.v2Sections.length > 0 && (
                  <button onClick={() => handleUnmatch(entry.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Tách cặp">
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 bg-slate-50/50">
        <div className="flex flex-wrap gap-2">
          {(['SAME', 'CHANGED', 'NEW', 'DELETED', 'RENUMBERED'] as MatchType[]).map(type => (
            <span key={type} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${BADGE_STYLES[type]}`}>{type}</span>
          ))}
        </div>
        <p className="text-[10px] text-slate-400">Dùng dropdown để chọn lại • Unlink để tách cặp</p>
      </div>
    </div>
  );
}
