'use client';

import { useCallback, useEffect, useState } from 'react';
import { isValidOperationId } from '../lib/operation-id';

/**
 * Đọc `?op=` một lần khi vào trang và ghi lại CHỈ mã operation (history.replaceState).
 * Tuyệt đối không ghi API key vào URL.
 */
export function useOperationUrl() {
  const [initialOperation, setInitialOperation] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setInitialOperation(new URLSearchParams(window.location.search).get('op'));
    setReady(true);
  }, []);

  const writeOperation = useCallback((operationId: string | null) => {
    if (operationId !== null && !isValidOperationId(operationId)) return;
    const url = new URL(window.location.href);
    if (operationId) url.searchParams.set('op', operationId);
    else url.searchParams.delete('op');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return { initialOperation, ready, writeOperation };
}
