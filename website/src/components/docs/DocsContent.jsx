import { useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDocs } from '../../contexts/useDocs';
import { useDocsFetch } from '../../hooks/useDocsFetch';
import MarkdownRenderer from './MarkdownRenderer';
import DocsPrevNext from './DocsPrevNext';
import DocsTableOfContents from './DocsTableOfContents';
import { extractHeadings } from '../../utils/docs-utils';
import { DEFAULT_DOC_SLUG, DOCS_HOME } from '../../constants';

function DocsContent() {
  const slug = useParams()['*'] || DEFAULT_DOC_SLUG;
  const navigate = useNavigate();
  const { findDocBySlug } = useDocs();
  const contentRef = useRef(null);

  // Redirect bare /docs to /docs/guide
  useEffect(() => {
    if (!slug || slug === '') {
      navigate(DOCS_HOME, { replace: true });
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
      const scroller = contentRef.current?.closest('.scrollable-content');
      (scroller || window).scrollTo({ top: 0 });
    }
  }, [slug, loading, content]);

  // Extract headings for TOC after render — depends on content so TOC
  // re-extracts when async fetch completes (not just on slug change)
  const getHeadings = useCallback(
    () => extractHeadings(contentRef.current),
    []
  );

  let body = null;
  if (!doc) {
    body = (
      <div className="docs-not-found">
        <h1>Page Not Found</h1>
        <p>The documentation page <code>{slug}</code> doesn&apos;t exist.</p>
        <a href={DOCS_HOME} onClick={(e) => { e.preventDefault(); navigate(DOCS_HOME); }}>
          Go to Guide
        </a>
      </div>
    );
  } else if (loading) {
    body = (
      <div className="docs-loading">
        <div className="docs-loading-skeleton" />
        <div className="docs-loading-skeleton" style={{ width: '80%' }} />
        <div className="docs-loading-skeleton" style={{ width: '60%' }} />
      </div>
    );
  } else if (error) {
    body = (
      <div className="docs-error">
        <h1>Error Loading Page</h1>
        <p>{error}</p>
      </div>
    );
  } else {
    body = (
      <>
        <MarkdownRenderer content={content} />
        <DocsPrevNext doc={doc} />
      </>
    );
  }

  return (
    <div className="docs-content-area">
      <div className="docs-content" ref={contentRef}>
        {body}
      </div>
      {doc && !loading && !error && (
        <DocsTableOfContents getHeadings={getHeadings} slug={slug} contentVersion={content} />
      )}
    </div>
  );
}

export default DocsContent;
