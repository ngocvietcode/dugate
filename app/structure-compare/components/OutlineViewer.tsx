'use client';

// app/structure-compare/components/OutlineViewer.tsx
// Displays a DocumentOutline as a collapsible tree with hierarchy indentation.

import React, { useState, useCallback } from 'react';
import type { OutlineViewerProps } from '../types';
import type { OutlineSection } from '@/lib/structure-compare/types';

export function OutlineViewer({
  outline,
  highlightedSections = [],
  onSectionClick,
}: OutlineViewerProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((sectionId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const renderSection = (section: OutlineSection, depth: number = 0) => {
    const isHighlighted = highlightedSections.includes(section.id);
    const isCollapsed = collapsedIds.has(section.id);
    const hasChildren = section.children && section.children.length > 0;
    const hasLowOcr = section.ocrConfidence !== undefined && section.ocrConfidence < 70;

    return (
      <div key={section.id} className="select-none">
        <div
          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 ${
            isHighlighted ? 'bg-blue-50 ring-1 ring-blue-200' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSectionClick?.(section.id)}
          role="treeitem"
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-selected={isHighlighted}
        >
          {/* Collapse toggle */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(section.id);
              }}
              className="flex h-4 w-4 items-center justify-center text-gray-400 hover:text-gray-600"
              aria-label={isCollapsed ? 'Mở rộng' : 'Thu gọn'}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>
          )}
          {!hasChildren && <span className="w-4" />}

          {/* Level indicator */}
          <span className="inline-block min-w-[3rem] rounded bg-gray-100 px-1.5 py-0.5 text-center text-xs font-mono text-gray-500">
            L{section.level}
          </span>

          {/* Identifier */}
          <span className="font-medium text-gray-700">
            {section.identifier}
          </span>

          {/* Title */}
          <span className="flex-1 truncate text-gray-500">
            {section.title}
          </span>

          {/* OCR confidence warning */}
          {hasLowOcr && (
            <span
              className="text-xs text-yellow-600"
              title={`OCR confidence: ${section.ocrConfidence}%`}
            >
              ⚠️
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && !isCollapsed && (
          <div role="group">
            {section.children!.map(child => renderSection(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            {outline.documentName}
          </h3>
          <p className="text-xs text-gray-500">
            {outline.sections.length} mục • Confidence: {outline.confidence}%
            {outline.isUncertain && (
              <span className="ml-1 text-yellow-600">⚠️ Không chắc chắn</span>
            )}
          </p>
        </div>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {outline.source}
        </span>
      </div>

      {/* Tree */}
      <div className="max-h-[500px] overflow-y-auto p-2" role="tree">
        {outline.sections.map(section => renderSection(section))}
      </div>
    </div>
  );
}
