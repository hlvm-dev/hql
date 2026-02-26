import DocsSidebar from './DocsSidebar';
import DocsContent from './DocsContent';
import DocsSearch from './DocsSearch';

function DocsLayout() {
  return (
    <div className="docs-layout">
      <DocsSidebar />
      <DocsContent />
      <DocsSearch />
    </div>
  );
}

export default DocsLayout;
