import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { useDocs } from '../../contexts/DocsContext';
import { SearchIcon } from '../Icons';

function DocsSearch() {
  const { manifest, searchOpen, setSearchOpen } = useDocs();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Build fuse.js index
  const fuse = useMemo(() => {
    if (!manifest?.search) return null;
    return new Fuse(manifest.search, {
      keys: [
        { name: 'title', weight: 3 },
        { name: 'label', weight: 2 },
        { name: 'headings.text', weight: 1.5 },
        { name: 'excerpt', weight: 1 },
      ],
      threshold: 0.4,
      includeMatches: true,
      minMatchCharLength: 2,
    });
  }, [manifest]);

  const results = useMemo(() => {
    if (!fuse || !query.trim()) return [];
    return fuse.search(query).slice(0, 12);
  }, [fuse, query]);

  // Focus input on open
  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay for DOM render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [searchOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!searchOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        navigateToResult(results[selectedIndex].item);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, results, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.children;
    if (items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const navigateToResult = (item) => {
    setSearchOpen(false);
    navigate(`/docs/${item.slug}`);
  };

  if (!searchOpen) return null;

  return (
    <div className="docs-search-overlay" onClick={() => setSearchOpen(false)}>
      <div className="docs-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="docs-search-input-wrapper">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="text"
            className="docs-search-input"
            placeholder="Search documentation..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            aria-label="Search documentation"
          />
          <kbd className="docs-search-kbd">Esc</kbd>
        </div>

        {query.trim() && (
          <div className="docs-search-results" ref={listRef}>
            {results.length === 0 ? (
              <div className="docs-search-empty">No results for &quot;{query}&quot;</div>
            ) : (
              results.map((result, i) => (
                <button
                  key={result.item.slug}
                  className={`docs-search-result ${i === selectedIndex ? 'selected' : ''}`}
                  onClick={() => navigateToResult(result.item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="docs-search-result-title">{result.item.title}</div>
                  {result.item.excerpt && (
                    <div className="docs-search-result-excerpt">{result.item.excerpt}</div>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {!query.trim() && manifest?.search && (
          <div className="docs-search-results" ref={listRef}>
            <div className="docs-search-hint">
              Type to search {manifest.search.length} docs
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DocsSearch;
