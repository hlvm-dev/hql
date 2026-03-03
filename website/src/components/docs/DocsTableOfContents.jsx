'use client';

import { useState, useEffect, useRef } from 'react';

function DocsTableOfContents({ getHeadings, slug, contentVersion }) {
  const [headings, setHeadings] = useState([]);
  const [activeId, setActiveId] = useState('');
  const observerRef = useRef(null);

  // Re-extract headings when slug or content changes
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setHeadings(getHeadings());
    });
    return () => cancelAnimationFrame(id);
  }, [slug, getHeadings, contentVersion]);

  // IntersectionObserver for scroll-spy
  useEffect(() => {
    if (headings.length === 0) return;

    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );

    observerRef.current = observer;

    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside className="docs-toc subtle-scroll">
      <div className="docs-toc-header">On this page</div>
      <nav className="docs-toc-nav">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className={`docs-toc-link docs-toc-level-${h.level} ${activeId === h.id ? 'active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(h.id);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                history.replaceState(null, '', `#${h.id}`);
                setActiveId(h.id);
              }
            }}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

export default DocsTableOfContents;
