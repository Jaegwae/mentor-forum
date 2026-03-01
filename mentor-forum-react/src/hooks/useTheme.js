/**
 * 전역 테마 상태 훅.
 * - localStorage 영속화
 * - 탭 간 동기화(storage/custom event)
 * - 모바일/인증 화면의 excel 모드 제한 규칙
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'mentor_forum_theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const THEME_EXCEL = 'excel';
const THEME_CHANGE_EVENT = 'mentor_forum_theme_change';
const THEME_SEQUENCE = [THEME_LIGHT, THEME_DARK, THEME_EXCEL];

export function isMobileLike() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const viewportWide = window.matchMedia('(min-width: 901px)').matches;
  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ''));
  const desktopLike = viewportWide && hoverFine && pointerFine && !mobileUa;
  return !desktopLike;
}

const THEME_SEQUENCE_MOBILE = [THEME_LIGHT, THEME_DARK];

function normalizeTheme(value, guardMobile = false) {
  const theme = String(value || '').trim().toLowerCase();
  if (theme === THEME_DARK) return THEME_DARK;
  if (theme === THEME_EXCEL) {
    if (guardMobile && isMobileLike()) return THEME_LIGHT;
    return THEME_EXCEL;
  }
  return THEME_LIGHT;
}

function readStoredTheme() {
  if (typeof window === 'undefined') return THEME_LIGHT;
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch (_) {
    return THEME_LIGHT;
  }
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('theme-dark', normalized === THEME_DARK);
  root.classList.toggle('theme-excel', normalized === THEME_EXCEL);
  root.dataset.theme = normalized;

  if (typeof window !== 'undefined') {
    // 동일 탭/다른 탭 모두 수신 가능한 커스텀 이벤트로 즉시 동기화한다.
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { theme: normalized }
    }));
  }
}

function writeStoredTheme(theme) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch (_) {
    // Ignore storage write failure.
  }
}

export function initTheme() {
  // 앱 부팅 시 저장값을 읽고, 모바일에서 금지된 excel 값은 light로 강등한다.
  const initialTheme = readStoredTheme();
  const safe = isMobileLike() && initialTheme === THEME_EXCEL ? THEME_LIGHT : initialTheme;
  applyTheme(safe);
  if (safe !== initialTheme) writeStoredTheme(safe);
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') {
      const fromDom = String(document.documentElement.dataset.theme || '').trim();
      if (fromDom) return normalizeTheme(fromDom);
    }
    return readStoredTheme();
  });

  useEffect(() => {
    // 상태 변경은 DOM class + storage에 항상 반영한다.
    const next = normalizeTheme(theme);
    applyTheme(next);
    writeStoredTheme(next);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

    const syncTheme = (value) => {
      const nextTheme = normalizeTheme(value || document.documentElement.dataset.theme || readStoredTheme());
      setTheme((prev) => (normalizeTheme(prev) === nextTheme ? prev : nextTheme));
    };

    const onThemeChange = (event) => {
      syncTheme(event?.detail?.theme);
    };

    const onStorage = (event) => {
      if (event?.key && event.key !== THEME_STORAGE_KEY) return;
      syncTheme(event?.newValue);
    };

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const current = normalizeTheme(prev);
      const authPage = typeof document !== 'undefined' && document.body.classList.contains('auth-page');
      // 인증 페이지 또는 모바일에서는 2-state(light/dark)만 순환한다.
      const seq = (isMobileLike() || authPage) ? THEME_SEQUENCE_MOBILE : THEME_SEQUENCE;
      const index = seq.indexOf(current);
      const nextIndex = index >= 0 ? (index + 1) % seq.length : 0;
      return seq[nextIndex];
    });
  }, []);

  return useMemo(() => ({
    theme: normalizeTheme(theme),
    isDark: normalizeTheme(theme) === THEME_DARK,
    isExcel: normalizeTheme(theme) === THEME_EXCEL,
    setTheme: (nextTheme) => setTheme(normalizeTheme(nextTheme, true)),
    toggleTheme
  }), [theme, toggleTheme]);
}
