import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';

/**
 * Renders markdown content with GFM, syntax highlighting, heading IDs,
 * and internal docs navigation links.
 */
function MarkdownRenderer({ content }) {
  const components = {
    a({ href, children, node, ...props }) {
      void node;
      // Internal /docs/ links
      if (href && href.startsWith('/docs/')) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
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

    table({ children, ...props }) {
      return (
        <div className="docs-table-wrapper">
          <table {...props}>{children}</table>
        </div>
      );
    },

    pre({ children, ...props }) {
      return (
        <div className="docs-code-block">
          <pre {...props}>{children}</pre>
        </div>
      );
    },
  };

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
