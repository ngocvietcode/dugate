'use client';

import { OperationState, STATE_BADGE_CONFIG } from '../types';

interface OperationStateBadgeProps {
  state: OperationState;
  size?: 'sm' | 'md';
}

export default function OperationStateBadge({ state, size = 'sm' }: OperationStateBadgeProps) {
  const config = STATE_BADGE_CONFIG[state];
  const sizeClass = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap ${sizeClass} ${config.className}`}
    >
      {state === 'RUNNING' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
        </span>
      )}
      {config.label}
    </span>
  );
}
