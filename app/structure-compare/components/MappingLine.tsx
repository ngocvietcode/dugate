'use client';

// app/structure-compare/components/MappingLine.tsx
// SVG bezier curve connecting mapped sections between two columns.

import React from 'react';
import type { MappingLineProps, MatchType } from '../types';
import { MATCH_TYPE_COLORS } from '../types';

const COLOR_MAP: Record<string, string> = {
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  red: '#ef4444',
  purple: '#a855f7',
  orange: '#f97316',
};

export function MappingLine({ from, to, matchType, isHighlighted = false }: MappingLineProps) {
  const colorName = MATCH_TYPE_COLORS[matchType] || 'gray';
  const strokeColor = COLOR_MAP[colorName] || '#9ca3af';
  const strokeWidth = isHighlighted ? 3 : 2;
  const opacity = isHighlighted ? 1 : 0.6;

  // Calculate bezier control points for a smooth curve
  const midX = (from.x + to.x) / 2;
  const path = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;

  return (
    <path
      d={path}
      fill="none"
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      opacity={opacity}
      strokeLinecap="round"
      className="transition-all duration-200"
    />
  );
}
