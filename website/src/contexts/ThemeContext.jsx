/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import hlvmLight from '../assets/hlvm_dragon.png';
import hlvmDark from '../assets/hlvm_dragon_dark.png';

const ThemeContext = createContext();
const THEME_KEY = 'hlvm-theme';
const THEME_PREFERENCE_KEY = 'hlvm-theme-preference';

function getStoredThemePreference() {
  const storedTheme = localStorage.getItem(THEME_KEY);
  const hasStoredTheme = storedTheme === 'light' || storedTheme === 'dark';
  const storedPreference = localStorage.getItem(THEME_PREFERENCE_KEY);

  // Explicit preference is canonical.
  if (storedPreference === 'explicit' && hasStoredTheme) {
    return { theme: storedTheme, isExplicit: true };
  }

  // Backward compatibility: older versions only stored `hlvm-theme`.
  if (!storedPreference && hasStoredTheme) {
    return { theme: storedTheme, isExplicit: true };
  }

  return {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    isExplicit: false,
  };
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const initialPreference = useMemo(() => getStoredThemePreference(), []);
  const [theme, setTheme] = useState(initialPreference.theme);
  const [isExplicitTheme, setIsExplicitTheme] = useState(initialPreference.isExplicit);

  // Listen for OS theme changes and automatically update
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleThemeChange = (e) => {
      if (!isExplicitTheme) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    
    // Add listener for OS theme changes
    mediaQuery.addEventListener('change', handleThemeChange);
    
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, [isExplicitTheme]);

  // Apply theme changes
  useEffect(() => {
    // Add transitioning class
    document.documentElement.classList.add('theme-transitioning');
    
    // Set the theme
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update favicon based on theme
    const favicon = document.getElementById('favicon-light');
    if (favicon) {
      favicon.href = theme === 'dark' ? hlvmDark : hlvmLight;
    }
    
    // Persist only explicit user preference. System mode stays dynamic.
    if (isExplicitTheme) {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(THEME_PREFERENCE_KEY, 'explicit');
    } else {
      localStorage.removeItem(THEME_KEY);
      localStorage.setItem(THEME_PREFERENCE_KEY, 'system');
    }
    
    // Remove transitioning class after animation
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 300);
    
    return () => clearTimeout(timer);
  }, [theme, isExplicitTheme]);

  const toggleTheme = () => {
    setIsExplicitTheme(true);
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
