// lib/useHomeMode.ts
// Client-side hook to fetch home_mode setting

'use client';

import { useState, useEffect } from 'react';

export type HomeMode = 'showcase' | 'developer';

export function useHomeMode(): HomeMode {
  const [mode, setMode] = useState<HomeMode>('showcase');

  useEffect(() => {
    fetch('/api/home-mode')
      .then(r => r.json())
      .then(data => setMode(data.mode || 'showcase'))
      .catch(() => {});
  }, []);

  return mode;
}
