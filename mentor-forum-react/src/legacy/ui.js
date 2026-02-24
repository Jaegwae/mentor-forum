// Small shared sanitization helper retained from legacy utilities.
export function showMessage(el, text, type) {
  if (!el) return;
  const cls = type === 'error' ? 'error' : 'notice';
  el.className = cls;
  el.textContent = text;
}

export function hideMessage(el) {
  if (!el) return;
  el.className = 'hidden';
  el.textContent = '';
}

export function sanitizeRoleKey(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}
