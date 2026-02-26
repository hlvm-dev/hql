import { FOOTER_LINKS } from '../constants';

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          <div className="footer-copy">© {new Date().getFullYear()} HLVM</div>
          <div className="footer-links">
            {FOOTER_LINKS.map(link => (
              <a
                key={link.label}
                href={link.href}
                className="footer-link"
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
