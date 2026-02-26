/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { DOCS_EVENTS } from '../constants/events';

const DocsContext = createContext();

export function useDocs() {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error('useDocs must be used within DocsProvider');
  return ctx;
}

export function DocsProvider({ children }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Load manifest on mount
  useEffect(() => {
    fetch('/content/manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Manifest load failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setManifest(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

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

  const value = {
    manifest,
    loading,
    error,
    sidebarOpen,
    setSidebarOpen,
    searchOpen,
    setSearchOpen,
    findDocBySlug,
  };

  return (
    <DocsContext.Provider value={value}>
      {children}
    </DocsContext.Provider>
  );
}
