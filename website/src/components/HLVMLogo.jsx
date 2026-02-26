import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import hlvmLight from '../assets/hlvm_dragon.png';
import hlvmDark from '../assets/hlvm_dragon_dark.png';

function HLVMLogo({ size = 40, showText = false, textSize = '1.5rem' }) {
  const { theme } = useTheme();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(theme);
  
  useEffect(() => {
    if (theme !== currentTheme) {
      setIsTransitioning(true);
      
      const timer = setTimeout(() => {
        setCurrentTheme(theme);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 150);
      }, 150);
      
      return () => clearTimeout(timer);
    }
  }, [theme, currentTheme]);
  
  const logoSrc = currentTheme === 'dark' ? hlvmDark : hlvmLight;
  
  return (
    <div className={`hlvm-logo${showText ? ' hlvm-logo--with-text' : ''}`}>
      <div className="hlvm-logo__icon" style={{ '--logo-size': `${size}px` }}>
        <img
          src={logoSrc}
          alt="HLVM Logo"
          className={`hlvm-logo__img${isTransitioning ? ' is-transitioning' : ''}`}
        />
      </div>

      {showText && (
        <span className="hlvm-logo__text" style={{ '--logo-text-size': textSize }}>
          HLVM
        </span>
      )}
    </div>
  );
}

export default HLVMLogo;
