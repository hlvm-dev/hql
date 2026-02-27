import { useState, useEffect, useCallback, useMemo } from 'react';
import { DOCS_EVENTS } from '../constants/events';
import { DocsContext } from './docs-context';

export function DocsProvider({ children }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Load manifest on mount
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadManifest() {
      try {
        const res = await fetch('/content/manifest.json', { signal: controller.signal });
        if (!res.ok) throw new Error(`Manifest load failed: ${res.status}`);
        const data = await res.json();
        if (!mounted) return;
        setManifest(data);
      } catch (err) {
        if (!mounted || err.name === 'AbortError') return;
        setError(err.message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadManifest();
    return () => {
      mounted = false;
      controller.abort();
    };
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

  const value = useMemo(() => ({
    manifest,
    loading,
    error,
    sidebarOpen,
    setSidebarOpen,
    searchOpen,
    setSearchOpen,
    findDocBySlug,
  }), [
    manifest,
    loading,
    error,
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
