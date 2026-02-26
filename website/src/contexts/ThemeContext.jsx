/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import hlvmLight from '../assets/hlvm_dragon.png';
import hlvmDark from '../assets/hlvm_dragon_dark.png';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('hlvm-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    // Fall back to system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Listen for OS theme changes and automatically update
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleThemeChange = (e) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    
    // Add listener for OS theme changes
    mediaQuery.addEventListener('change', handleThemeChange);
    
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, []);

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
    
    // Save theme preference to localStorage
    localStorage.setItem('hlvm-theme', theme);
    
    // Remove transitioning class after animation
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 300);
    
    return () => clearTimeout(timer);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
