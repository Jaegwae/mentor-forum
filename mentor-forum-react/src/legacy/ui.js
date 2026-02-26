// Small shared sanitization helper retained from legacy utilities.

export function sanitizeRoleKey(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}
