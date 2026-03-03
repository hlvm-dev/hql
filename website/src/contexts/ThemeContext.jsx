'use client';

import { useEffect, useState } from 'react';
import { ThemeContext } from './theme-context';

const THEME_KEY = 'hlvm-theme';
const THEME_PREFERENCE_KEY = 'hlvm-theme-preference';
const LIGHT_FAVICON = '/hlvm_dragon.png';
const DARK_FAVICON = '/hlvm_dragon_dark.png';

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

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('light');
  const [isExplicitTheme, setIsExplicitTheme] = useState(false);

  // Resolve persisted/system preference after mount (browser-only APIs).
  useEffect(() => {
    const initialPreference = getStoredThemePreference();
    setTheme(initialPreference.theme);
    setIsExplicitTheme(initialPreference.isExplicit);
  }, []);

  // Listen for OS theme changes and automatically update
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleThemeChange = (e) => {
      if (!isExplicitTheme) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleThemeChange);

    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, [isExplicitTheme]);

  // Apply theme changes
  useEffect(() => {
    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', theme);

    // Update favicon based on theme
    const favicon = document.getElementById('favicon-light');
    if (favicon) {
      favicon.href = theme === 'dark' ? DARK_FAVICON : LIGHT_FAVICON;
    }

    // Persist only explicit user preference. System mode stays dynamic.
    if (isExplicitTheme) {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(THEME_PREFERENCE_KEY, 'explicit');
    } else {
      localStorage.removeItem(THEME_KEY);
      localStorage.setItem(THEME_PREFERENCE_KEY, 'system');
    }

    const timer = setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 300);

    return () => clearTimeout(timer);
  }, [theme, isExplicitTheme]);

  const toggleTheme = () => {
    setIsExplicitTheme(true);
    setTheme((prevTheme) => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
