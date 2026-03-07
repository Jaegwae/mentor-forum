// Shared mobile layout detection used by page-level responsive overrides.
// This stays separate from page-specific view logic so mobile fallbacks can
// be updated in one place.
import React from 'react';

export function detectMobileLayoutMode(fallbackCompact = false) {
  if (fallbackCompact) return true;
  if (typeof window === 'undefined') return false;

  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
  const viewportWidth = Math.max(
    Number(window.innerWidth || 0),
    Number(document?.documentElement?.clientWidth || 0)
  );
  const touchLikePointer = typeof window.matchMedia === 'function'
    && (
      window.matchMedia('(any-pointer: coarse)').matches
      || window.matchMedia('(hover: none)').matches
      || window.matchMedia('(any-hover: none)').matches
    );
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(userAgent);

  return viewportWidth <= 900 || mobileUa || maxTouchPoints > 0 || touchLikePointer;
}

export function useMobileLayoutMode(fallbackCompact = false) {
  const [mobileLayoutMode, setMobileLayoutMode] = React.useState(() => detectMobileLayoutMode(fallbackCompact));

  React.useEffect(() => {
    const syncMode = () => setMobileLayoutMode(detectMobileLayoutMode(fallbackCompact));

    syncMode();

    if (typeof window === 'undefined') return undefined;

    window.addEventListener('resize', syncMode);
    window.addEventListener('orientationchange', syncMode);

    const mediaQueries = typeof window.matchMedia === 'function'
      ? [
        window.matchMedia('(max-width: 900px)'),
        window.matchMedia('(any-pointer: coarse)'),
        window.matchMedia('(hover: none)'),
        window.matchMedia('(any-hover: none)')
      ]
      : [];

    mediaQueries.forEach((query) => {
      if (typeof query?.addEventListener === 'function') query.addEventListener('change', syncMode);
      else if (typeof query?.addListener === 'function') query.addListener(syncMode);
    });

    return () => {
      window.removeEventListener('resize', syncMode);
      window.removeEventListener('orientationchange', syncMode);
      mediaQueries.forEach((query) => {
        if (typeof query?.removeEventListener === 'function') query.removeEventListener('change', syncMode);
        else if (typeof query?.removeListener === 'function') query.removeListener(syncMode);
      });
    };
  }, [fallbackCompact]);

  return mobileLayoutMode;
}
