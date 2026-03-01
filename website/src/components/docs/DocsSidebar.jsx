import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useDocs } from '../../contexts/useDocs';
import { ChevronRightIcon } from '../Icons';
import { getActiveTab, getDocSlugFromPathname } from '../../utils/docs-utils';

function DocsSidebar() {
  const { manifest, sidebarOpen, setSidebarOpen } = useDocs();
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const currentSlug = getDocSlugFromPathname(location.pathname);
  const activeTab = getActiveTab(currentSlug);

  // Auto-expand the group containing the active page
  useEffect(() => {
    if (!manifest) return;
    const items = manifest.sidebar[activeTab] || [];
    for (const item of items) {
      if (item.children) {
        const hasActive = item.children.some((c) => c.slug === currentSlug);
        if (hasActive) {
          setExpandedGroups((prev) => new Set([...prev, item.slug]));
        }
      }
    }
  }, [currentSlug, activeTab, manifest]);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  const items = manifest.sidebar[activeTab] || [];

  const toggleGroup = (slug) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const renderItem = (item) => {
    const isActive = item.slug === currentSlug;

    if (item.children) {
      const isExpanded = expandedGroups.has(item.slug);
      const hasActiveChild = item.children.some((c) => c.slug === currentSlug);

      return (
        <div key={item.slug} className="docs-sidebar-group">
          <button
            className={`docs-sidebar-group-toggle ${hasActiveChild ? 'has-active' : ''}`}
            onClick={() => toggleGroup(item.slug)}
            aria-expanded={isExpanded}
          >
            <span className={`docs-sidebar-chevron ${isExpanded ? 'expanded' : ''}`}>
              <ChevronRightIcon size={14} />
            </span>
            {item.label}
          </button>
          {isExpanded && (
            <div className="docs-sidebar-group-children">
              {item.children.map((child) => (
                <Link
                  key={child.slug}
                  to={`/docs/${child.slug}`}
                  className={`docs-sidebar-link docs-sidebar-child ${child.slug === currentSlug ? 'active' : ''}`}
                  viewTransition
                >
                  {child.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.slug}
        to={`/docs/${item.slug}`}
        className={`docs-sidebar-link ${isActive ? 'active' : ''}`}
        viewTransition
      >
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {sidebarOpen && (
        <button
          type="button"
          className="docs-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close documentation sidebar"
        />
      )}
      <aside className={`docs-sidebar subtle-scroll ${sidebarOpen ? 'open' : ''}`}>
        <nav className="docs-sidebar-nav">
          {items.map(renderItem)}
        </nav>
      </aside>
    </>
  );
}

export default DocsSidebar;
