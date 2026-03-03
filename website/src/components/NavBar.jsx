'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import HLVMLogo from './HLVMLogo';
import { MenuIcon, CloseIcon, SearchIcon } from './Icons';
import ThemeToggleButton from './ThemeToggleButton';
import { downloadHLVM } from '../utils/download';
import { NAV_LINKS, DOCS_NAV_TABS, BREAKPOINTS } from '../constants';
import { DOCS_EVENTS } from '../constants/events';
import { getActiveTab, getDocSlugFromPathname } from '../utils/docs-utils';

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname() || '';
  const isDocsMode = pathname.startsWith('/docs');

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < BREAKPOINTS.MOBILE);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleDownloadClick = () => {
    downloadHLVM();
    setMenuOpen(false);
  };

  const currentSlug = getDocSlugFromPathname(pathname);
  const activeTab = getActiveTab(currentSlug);

  const renderNavLink = (link, className, onClick) => {
    if (link.external) {
      return (
        <a
          key={link.label}
          href={link.href}
          className={className}
          onClick={onClick}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      );
    }

    return (
      <Link
        key={link.label}
        href={link.to}
        className={className}
        onClick={onClick}
      >
        {link.label}
      </Link>
    );
  };

  const renderDocsTab = (tab, className, onClick) => (
    <Link
      key={tab.label}
      href={tab.to}
      className={`${className} ${activeTab === tab.id ? 'nav-link--active' : ''}`}
      onClick={onClick}
    >
      {tab.label}
    </Link>
  );

  return (
    <>
      <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
        <div className="nav-inner">
          <div className="nav-content">
            <Link href="/" className="nav-logo" aria-label="Home">
              <HLVMLogo size={40} showText={true} textSize="1.125rem" />
            </Link>

            <div className="nav-actions">
              {!isMobile && (
                <>
                  {isDocsMode ? (
                    <>
                      {DOCS_NAV_TABS.map((tab) => renderDocsTab(tab, 'nav-link'))}
                      <button
                        className="btn-icon docs-search-trigger"
                        onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENTS.OPEN_SEARCH))}
                        aria-label="Search docs (Cmd+K)"
                        title="Search (Cmd+K)"
                      >
                        <SearchIcon size={18} />
                      </button>
                      <ThemeToggleButton />
                      <Link href="/" className="nav-link">Home</Link>
                    </>
                  ) : (
                    <>
                      {NAV_LINKS.map((link) => renderNavLink(link, 'nav-link'))}
                      <ThemeToggleButton />
                      <button
                        className="btn btn-primary btn-compact"
                        onClick={handleDownloadClick}
                      >
                        Download
                      </button>
                    </>
                  )}
                </>
              )}

              {isMobile && (
                <>
                  {isDocsMode && (
                    <button
                      className="btn-icon"
                      onClick={() => window.dispatchEvent(new CustomEvent(DOCS_EVENTS.TOGGLE_SIDEBAR))}
                      aria-label="Toggle sidebar"
                    >
                      <MenuIcon size={20} />
                    </button>
                  )}
                  <ThemeToggleButton />
                  <button
                    className="btn-icon"
                    onClick={() => setMenuOpen(!menuOpen)}
                    aria-label="Menu"
                  >
                    <MenuIcon />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {isMobile && (
        <div className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`}>
          <div className="nav-mobile-header">
            <Link href="/" className="nav-mobile-logo" aria-label="Home" onClick={() => setMenuOpen(false)}>
              <HLVMLogo size={40} showText={true} textSize="1.125rem" />
            </Link>
            <button
              className="btn-icon"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="nav-mobile-menu">
            {isDocsMode && DOCS_NAV_TABS.map((tab) => renderDocsTab(tab, 'nav-mobile-link', () => setMenuOpen(false)))}
            {NAV_LINKS.map((link) => renderNavLink(link, 'nav-mobile-link', () => setMenuOpen(false)))}
            <ThemeToggleButton
              variant="text"
              className="btn btn-secondary btn-block mt-1"
            />
            <button
              className="btn btn-primary btn-block mt-1"
              onClick={handleDownloadClick}
            >
              Download
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default NavBar;
