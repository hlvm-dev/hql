import { DocsProvider } from '../contexts/DocsContext';
import DocsLayout from '../components/docs/DocsLayout';
import NavBar from '../components/NavBar';
import Footer from '../components/Footer';

function DocsPage({ manifest, slug, content }) {
  return (
    <DocsProvider manifest={manifest}>
      <div className="app-container docs-app">
        <NavBar />
        <div className="scrollable-content">
          <DocsLayout slug={slug} content={content} />
        </div>
        <Footer />
      </div>
    </DocsProvider>
  );
}

export default DocsPage;
