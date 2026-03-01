/**
 * 레거시 UI 유틸.
 * - 과거 코드와의 호환을 위해 최소 헬퍼만 유지한다.
 */

export function sanitizeRoleKey(value) {
  // Firestore 문서 키로 안전한 문자만 남긴다.
  return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}
