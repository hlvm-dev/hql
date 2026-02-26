import { useState, useEffect, useRef } from 'react';

const cache = new Map();

/**
 * Fetch and cache markdown content by path.
 */
export function useDocsFetch(path) {
  const [content, setContent] = useState(() => cache.get(path) || null);
  const [loading, setLoading] = useState(!cache.has(path));
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!path) {
      setContent(null);
      setLoading(false);
      return;
    }

    // Return cached immediately
    if (cache.has(path)) {
      setContent(cache.get(path));
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Abort any previous fetch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/content/${path}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        cache.set(path, text);
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [path]);

  return { content, loading, error };
}
