// Theme toggle control used across pages.
import React from 'react';
import { MoonStar, SunMedium, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useTheme, isMobileLike } from '../../hooks/useTheme.js';

const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const THEME_EXCEL = 'excel';
const NEXT_THEME_DESKTOP = {
  [THEME_LIGHT]: THEME_DARK,
  [THEME_DARK]: THEME_EXCEL,
  [THEME_EXCEL]: THEME_LIGHT
};
const NEXT_THEME_MOBILE = {
  [THEME_LIGHT]: THEME_DARK,
  [THEME_DARK]: THEME_LIGHT
};
const THEME_LABEL = {
  [THEME_LIGHT]: '라이트',
  [THEME_DARK]: '다크',
  [THEME_EXCEL]: '엑셀'
};

export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const currentTheme = THEME_LABEL[theme] ? theme : THEME_LIGHT;
  const mobile = isMobileLike();
  const authPage = typeof document !== 'undefined' && document.body.classList.contains('auth-page');
  const restrictToLightDark = mobile || authPage;
  const nextTheme = (restrictToLightDark ? NEXT_THEME_MOBILE : NEXT_THEME_DESKTOP)[currentTheme] || THEME_LIGHT;
  const currentLabel = THEME_LABEL[currentTheme] || '라이트';
  const nextLabel = THEME_LABEL[nextTheme] || '라이트';

  const icon = currentTheme === THEME_DARK
    ? <MoonStar size={14} />
    : currentTheme === THEME_EXCEL
      ? <FileSpreadsheet size={14} />
      : <SunMedium size={14} />;

  return (
    <button
      type="button"
      className={cn('theme-toggle-btn', className)}
      onClick={toggleTheme}
      aria-label={`현재 ${currentLabel} 모드, 다음 모드로 전환 (${nextLabel})`}
      title={`다음 모드로 전환: ${nextLabel}`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="theme-toggle-text">{currentLabel}</span>
    </button>
  );
}
