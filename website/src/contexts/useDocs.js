'use client';

import { useContext } from 'react';
import { DocsContext } from './docs-context';

export function useDocs() {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error('useDocs must be used within DocsProvider');
  return ctx;
}
