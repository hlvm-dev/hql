'use client';

import DocsSidebar from './DocsSidebar';
import DocsContent from './DocsContent';
import DocsSearch from './DocsSearch';

function DocsLayout({ slug, content }) {
  return (
    <div className="docs-layout">
      <DocsSidebar />
      <DocsContent slug={slug} content={content} />
      <DocsSearch />
    </div>
  );
}

export default DocsLayout;
