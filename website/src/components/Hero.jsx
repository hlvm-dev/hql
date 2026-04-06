'use client';

import { useRef, useState, lazy, Suspense } from 'react';
import HLVMLogo from './HLVMLogo';
const FeatureDemoOverlay = lazy(() => import('./FeatureDemoOverlay'));

const INSTALL_COMMANDS = {
  standard: 'curl -fsSL https://hlvm.dev/install.sh | sh',
};

function Hero() {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState('');
  const watchBtnRef = useRef(null);

  const handleWatchClick = () => { setIsOverlayOpen(true); };
  const handleCopyCommand = async (mode) => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMANDS[mode]);
      setCopiedCommand(mode);
      globalThis.setTimeout(() => setCopiedCommand((current) => current === mode ? '' : current), 1600);
    } catch {
      setCopiedCommand('');
    }
  };

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
            One command. Ready on completion.
          </p>

          <div className="hero-download">
            <div className="hero-action-row">
              <button
                ref={watchBtnRef}
                className="btn btn-primary hero-cta"
                onClick={handleWatchClick}
                aria-haspopup="dialog"
                aria-controls="feature-demo-overlay"
              >
                Watch Demo
              </button>
            </div>
            <p className="hero-availability">
              Standard install downloads HLVM, boots the embedded local AI runtime, and prepares Gemma during install.
            </p>
          </div>

          <div className="hero-install-grid">
            <div className="hero-install-card">
              <div className="hero-install-header">
                <div>
                  <p className="hero-install-title">Standard</p>
                  <p className="hero-install-note">Recommended. One command installs HLVM and prepares the default local Gemma fallback before returning.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact hero-install-copy"
                  onClick={() => handleCopyCommand('standard')}
                >
                  {copiedCommand === 'standard' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <code className="hero-install-command">{INSTALL_COMMANDS.standard}</code>
            </div>
          </div>
        </div>
      </div>
      {isOverlayOpen && (
        <Suspense fallback={null}>
          <FeatureDemoOverlay
            isOpen={isOverlayOpen}
            onClose={() => {
              setIsOverlayOpen(false);
              try { watchBtnRef.current?.focus(); } catch { /* noop */ }
            }}
            overlayId="feature-demo-overlay"
          />
        </Suspense>
      )}
    </section>
  );
}

export default Hero;
