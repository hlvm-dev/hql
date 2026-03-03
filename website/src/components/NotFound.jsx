import Link from 'next/link';
import NavBar from './NavBar';
import Footer from './Footer';

function NotFound() {
  return (
    <div className="app-container">
      <NavBar />
      <div className="scrollable-content">
        <section className="hero">
          <div className="hero-container">
            <div className="hero-content">
              <h1 className="hero-title">404</h1>
              <p className="hero-tagline">Page not found</p>
              <Link href="/" className="btn btn-primary hero-cta">
                Back to Home
              </Link>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  );
}

export default NotFound;
