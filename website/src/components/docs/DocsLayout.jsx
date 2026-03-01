import DocsSidebar from './DocsSidebar';
import DocsContent from './DocsContent';
import DocsSearch from './DocsSearch';
import { useDocs } from '../../contexts/useDocs';

function DocsLayout() {
  const { manifest, loading, error } = useDocs();

  if (loading && !manifest) {
    return (
      <div className="docs-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="docs-content">
          <div className="docs-loading">
            <div className="docs-loading-skeleton" />
            <div className="docs-loading-skeleton" style={{ width: '80%' }} />
            <div className="docs-loading-skeleton" style={{ width: '60%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error && !manifest) {
    return (
      <div className="docs-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="docs-content">
          <div className="docs-error">
            <h1>Failed to Load Documentation</h1>
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="docs-layout">
      <DocsSidebar />
      <DocsContent />
      <DocsSearch />
    </div>
  );
}

export default DocsLayout;
