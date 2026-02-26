import { useRef, useState, lazy, Suspense } from 'react'
import HLVMLogo from './HLVMLogo'
const FeatureDemoOverlay = lazy(() => import('./FeatureDemoOverlay'))

function Hero() {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false)
  const watchBtnRef = useRef(null)

  const handleWatchClick = () => { setIsOverlayOpen(true) }

  return (
    <section className="hero">
      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-icon">
            <HLVMLogo size={280} />
          </div>
          
          <h1 className="hero-title">
            AI Spotlight
          </h1>
          
          <p className="hero-tagline">
            One search bar. unlimited power.
          </p>
          
          <div className="hero-download">
            <button
              ref={watchBtnRef}
              className="btn btn-primary hero-cta"
              onClick={handleWatchClick}
              aria-haspopup="dialog"
              aria-controls="feature-demo-overlay"
            >
              Watch Demo
            </button>
            
            <p className="hero-availability">
              on YouTube
            </p>
          </div>
        </div>
      </div>
      {isOverlayOpen && (
        <Suspense fallback={null}>
          <FeatureDemoOverlay
            isOpen={isOverlayOpen}
            onClose={() => {
              setIsOverlayOpen(false)
              // Restore focus to the trigger for accessibility
              try { watchBtnRef.current?.focus() } catch { /* noop */ }
            }}
            overlayId="feature-demo-overlay"
          />
        </Suspense>
      )}
    </section>
  )
}



export default Hero
