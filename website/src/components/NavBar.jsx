import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import HLVMLogo from './HLVMLogo';
import { MenuIcon, CloseIcon, SearchIcon } from './Icons';
import ThemeToggleButton from './ThemeToggleButton';
import { downloadHLVM } from '../utils/download';
import { NAV_LINKS, DOCS_NAV_TABS, BREAKPOINTS } from '../constants';
import { getActiveTab } from '../utils/docs-utils';

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const isDocsMode = location.pathname.startsWith('/docs');

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

  const activeTab = getActiveTab(location.pathname.replace('/docs/', ''));

  return (
    <>
      <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
        <div className="nav-inner">
          <div className="nav-content">
            <Link to="/" className="nav-logo" aria-label="Home">
              <HLVMLogo size={40} showText={true} textSize="1.125rem" />
            </Link>

            <div className="nav-actions">
              {!isMobile && (
                <>
                  {isDocsMode ? (
                    /* Docs mode: tabs + search + home */
                    <>
                      {DOCS_NAV_TABS.map(tab => (
                        <Link
                          key={tab.label}
                          to={tab.to}
                          className={`nav-link ${activeTab === tab.id ? 'nav-link--active' : ''}`}
                          viewTransition
                        >
                          {tab.label}
                        </Link>
                      ))}
                      <button
                        className="btn-icon docs-search-trigger"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('open-docs-search'));
                        }}
                        aria-label="Search docs (Cmd+K)"
                        title="Search (Cmd+K)"
                      >
                        <SearchIcon size={18} />
                      </button>
                      <ThemeToggleButton />
                      <Link to="/" className="nav-link">Home</Link>
                    </>
                  ) : (
                    /* Landing mode: GitHub, Docs, theme, download */
                    <>
                      {NAV_LINKS.map(link => (
                        link.external ? (
                          <a
                            key={link.label}
                            href={link.href}
                            className="nav-link"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.label}
                          </a>
                        ) : (
                          <Link
                            key={link.label}
                            to={link.to}
                            className="nav-link"
                            viewTransition
                          >
                            {link.label}
                          </Link>
                        )
                      ))}
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
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('toggle-docs-sidebar'));
                      }}
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

      {/* Mobile Menu Overlay */}
      {isMobile && (
        <div className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`}>
          <div className="nav-mobile-header">
            <Link to="/" className="nav-mobile-logo" aria-label="Home" onClick={() => setMenuOpen(false)}>
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
            {isDocsMode && DOCS_NAV_TABS.map(tab => (
              <Link
                key={tab.label}
                to={tab.to}
                className={`nav-mobile-link ${activeTab === tab.id ? 'nav-link--active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {tab.label}
              </Link>
            ))}
            {NAV_LINKS.map(link => (
              link.external ? (
                <a
                  key={link.label}
                  href={link.href}
                  className="nav-mobile-link"
                  onClick={() => setMenuOpen(false)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.label}
                  to={link.to}
                  className="nav-mobile-link"
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              )
            ))}
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
