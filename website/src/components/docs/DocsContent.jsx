import { useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDocs } from '../../contexts/DocsContext';
import { useDocsFetch } from '../../hooks/useDocsFetch';
import MarkdownRenderer from './MarkdownRenderer';
import DocsPrevNext from './DocsPrevNext';
import DocsTableOfContents from './DocsTableOfContents';
import { extractHeadings } from '../../utils/docs-utils';

function DocsContent() {
  const slug = useParams()['*'] || 'guide';
  const navigate = useNavigate();
  const { manifest, findDocBySlug } = useDocs();
  const contentRef = useRef(null);

  // Redirect bare /docs to /docs/guide
  useEffect(() => {
    if (!slug || slug === '') {
      navigate('/docs/guide', { replace: true });
    }
  }, [slug, navigate]);

  const doc = findDocBySlug(slug);
  const { content, loading, error } = useDocsFetch(doc?.path);

  // Scroll to top on slug change, or to hash if present
  useEffect(() => {
    if (!loading && content) {
      const hash = window.location.hash;
      if (hash) {
        const el = document.getElementById(hash.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
          return;
        }
      }
      window.scrollTo({ top: 0 });
    }
  }, [slug, loading, content]);

  // Extract headings for TOC after render — depends on content so TOC
  // re-extracts when async fetch completes (not just on slug change)
  const getHeadings = useCallback(() => {
    return extractHeadings(contentRef.current);
  }, [content]);

  if (!manifest) return null;

  if (!doc) {
    return (
      <div className="docs-content-area">
        <div className="docs-content" ref={contentRef}>
          <div className="docs-not-found">
            <h1>Page Not Found</h1>
            <p>The documentation page <code>{slug}</code> doesn&apos;t exist.</p>
            <a href="/docs/guide" onClick={(e) => { e.preventDefault(); navigate('/docs/guide'); }}>
              Go to Guide
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="docs-content-area">
        <div className="docs-content" ref={contentRef}>
          <div className="docs-loading">
            <div className="docs-loading-skeleton" />
            <div className="docs-loading-skeleton" style={{ width: '80%' }} />
            <div className="docs-loading-skeleton" style={{ width: '60%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="docs-content-area">
        <div className="docs-content" ref={contentRef}>
          <div className="docs-error">
            <h1>Error Loading Page</h1>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="docs-content-area">
      <div className="docs-content" ref={contentRef}>
        <MarkdownRenderer content={content} />
        <DocsPrevNext doc={doc} />
      </div>
      <DocsTableOfContents getHeadings={getHeadings} slug={slug} />
    </div>
  );
}

export default DocsContent;
