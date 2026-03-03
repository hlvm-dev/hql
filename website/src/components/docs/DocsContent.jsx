'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDocs } from '../../contexts/useDocs';
import MarkdownRenderer from './MarkdownRenderer';
import DocsPrevNext from './DocsPrevNext';
import DocsTableOfContents from './DocsTableOfContents';
import { extractHeadings } from '../../utils/docs-utils';
import { DOCS_HOME } from '../../constants';

function DocsContent({ slug, content }) {
  const { findDocBySlug } = useDocs();
  const contentRef = useRef(null);

  const doc = findDocBySlug(slug);

  // Scroll to top on slug change, or to hash if present
  useEffect(() => {
    if (!content) return;

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
  }, [slug, content]);

  // Extract headings for TOC after render
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
        <a href={DOCS_HOME}>Go to Guide</a>
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
      {doc && (
        <DocsTableOfContents getHeadings={getHeadings} slug={slug} contentVersion={content} />
      )}
    </div>
  );
}

export default DocsContent;
