import { useTheme } from '../contexts/ThemeContext';
import { SunIcon, MoonIcon } from './Icons';

function ThemeToggleButton({ variant = 'icon', className = 'btn-icon' }) {
  const { theme, toggleTheme } = useTheme();
  
  if (variant === 'text') {
    return (
      <button
        className={className}
        onClick={toggleTheme}
      >
        {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
      </button>
    );
  }
  
  return (
    <button
      className={className}
      onClick={toggleTheme}
      aria-label="Toggle theme"
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

export default ThemeToggleButton;
