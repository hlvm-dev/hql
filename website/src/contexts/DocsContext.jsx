'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { DOCS_EVENTS } from '../constants/events';
import { DocsContext } from './docs-context';

export function DocsProvider({ children, manifest }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Global Cmd+K / Ctrl+K shortcut for search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  // Listen for custom events from NavBar
  useEffect(() => {
    const handleOpenSearch = () => setSearchOpen(true);
    const handleToggleSidebar = () => setSidebarOpen((prev) => !prev);

    window.addEventListener(DOCS_EVENTS.OPEN_SEARCH, handleOpenSearch);
    window.addEventListener(DOCS_EVENTS.TOGGLE_SIDEBAR, handleToggleSidebar);
    return () => {
      window.removeEventListener(DOCS_EVENTS.OPEN_SEARCH, handleOpenSearch);
      window.removeEventListener(DOCS_EVENTS.TOGGLE_SIDEBAR, handleToggleSidebar);
    };
  }, []);

  const docBySlug = useMemo(() => {
    const map = new Map();
    for (const doc of manifest?.flat || []) {
      map.set(doc.slug, doc);
    }
    return map;
  }, [manifest]);

  const findDocBySlug = useCallback((slug) => {
    return docBySlug.get(slug) || null;
  }, [docBySlug]);

  const value = useMemo(() => ({
    manifest,
    loading: false,
    error: null,
    sidebarOpen,
    setSidebarOpen,
    searchOpen,
    setSearchOpen,
    findDocBySlug,
  }), [
    manifest,
    sidebarOpen,
    searchOpen,
    findDocBySlug,
  ]);

  return (
    <DocsContext.Provider value={value}>
      {children}
    </DocsContext.Provider>
  );
}
