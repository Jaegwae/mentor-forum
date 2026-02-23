// Theme toggle control used across pages.
import React from 'react';
import { MoonStar, SunMedium } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useTheme } from '../../hooks/useTheme.js';

export function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className={cn('theme-toggle-btn', className)}
      onClick={toggleTheme}
      aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={isDark ? '라이트 모드' : '다크 모드'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? <MoonStar size={14} /> : <SunMedium size={14} />}
      </span>
      <span className="theme-toggle-text">{isDark ? '다크' : '라이트'}</span>
    </button>
  );
}
