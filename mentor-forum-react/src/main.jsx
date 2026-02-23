// React bootstrap: global styles, theme initialization, and root render.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'react-quill/dist/quill.snow.css';
import 'react-day-picker/style.css';
import './styles/common.css';
import './styles/design-system.css';
import { initTheme } from './hooks/useTheme.js';

async function clearLegacyCaches() {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch (_) {
      // Ignore cache cleanup errors in client bootstrap.
    }
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (_) {
      // Ignore cache cleanup errors in client bootstrap.
    }
  }
}

clearLegacyCaches().catch(() => {});
initTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
