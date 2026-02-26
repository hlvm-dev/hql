import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
// Base highlight.js styles (theme colors overridden in index.css per data-theme)
import 'highlight.js/styles/github.css';

/**
 * Renders markdown content with GFM, syntax highlighting, heading IDs,
 * and SPA-aware link handling.
 */
function MarkdownRenderer({ content }) {
  const navigate = useNavigate();

  const components = useMemo(() => ({
    // Intercept links for SPA navigation
    a({ href, children, ...props }) {
      // Internal /docs/ links → SPA navigate
      if (href && href.startsWith('/docs/')) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              navigate(href);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }

      // Anchor links on the same page
      if (href && href.startsWith('#')) {
        return <a href={href} {...props}>{children}</a>;
      }

      // External links open in new tab
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      );
    },

    // Better table rendering
    table({ children, ...props }) {
      return (
        <div className="docs-table-wrapper">
          <table {...props}>{children}</table>
        </div>
      );
    },

    // Code blocks with copy button
    pre({ children, ...props }) {
      return (
        <div className="docs-code-block">
          <pre {...props}>{children}</pre>
        </div>
      );
    },
  }), [navigate]);

  if (!content) return null;

  return (
    <div className="docs-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
