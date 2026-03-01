// AdminPage pure helpers.
// Includes role normalization, manage-state derivation, and board/user sorting
// rules to keep controller code focused on workflows.
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import {
  CORE_ROLE_SET,
  ROLE_KEY_ALIASES,
  coreRoleDefaults,
  roleFlagDefs
} from './constants.js';

export function normalizeText(value) {
  return String(value || '').trim();
}

export function sanitizeRoleKey(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}

export function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(userAgent);
  const desktopIpadUa = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  const viewportNarrow = window.matchMedia('(max-width: 900px)').matches || window.innerWidth <= 900;
  const shortestScreen = Math.min(
    Number(window.screen?.width || 0),
    Number(window.screen?.height || 0)
  );
  const screenLooksMobile = shortestScreen > 0 && shortestScreen <= 1024;

  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const hoverNone = window.matchMedia('(hover: none)').matches || window.matchMedia('(any-hover: none)').matches;
  const touchLikeInput = maxTouchPoints > 0 || anyCoarse || hoverNone;

  if (mobileUa || desktopIpadUa || viewportNarrow) return true;
  if (touchLikeInput && screenLooksMobile) return true;

  const desktopLike = hoverFine && pointerFine && !touchLikeInput;
  return !desktopLike;
}

export function shouldLogDebugPayload() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return window.__MENTOR_DEBUG__ === true;
}

export function isPermissionDeniedError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.includes('permission-denied');
}

export function joinDebugParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' | ');
}

export function debugCodePoints(value) {
  const raw = String(value ?? '');
  if (!raw) return '-';
  return Array.from(raw)
    .map((char) => `U+${(char.codePointAt(0) || 0).toString(16).toUpperCase()}`)
    .join(',');
}

export function debugValueList(values) {
  if (!Array.isArray(values)) return '-';
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length ? normalized.join(',') : '-';
}

export function normalizeNickname(value) {
  return normalizeText(value);
}

export function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

export function normalizeVenueLabel(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

export function sortVenueOptions(items) {
  const source = Array.isArray(items) ? items : [];
  return [...source].sort((a, b) => {
    const sa = Number(a?.sortOrder);
    const sb = Number(b?.sortOrder);
    const va = Number.isFinite(sa) ? sa : Number.MAX_SAFE_INTEGER;
    const vb = Number.isFinite(sb) ? sb : Number.MAX_SAFE_INTEGER;
    if (va !== vb) return va - vb;
    return String(a?.label || a?.id || '').localeCompare(String(b?.label || b?.id || ''), 'ko');
  });
}

export function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const d = value && typeof value.toDate === 'function'
    ? value.toDate()
    : new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.map((role) => normalizeText(role)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function isCoreRole(roleKey) {
  return CORE_ROLE_SET.has(normalizeText(roleKey));
}

export function roleDeleteLockedForAdmin(roleDoc) {
  return !!(roleDoc && roleDoc.adminDeleteLocked === true);
}

export function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

export function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  roleDefinitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

export function normalizeRoleKey(roleKey, roleDefMap) {
  const raw = normalizeText(roleKey);
  const alias = ROLE_KEY_ALIASES[raw] || '';
  const lower = raw.toLowerCase();
  const englishAlias = lower === 'super_admin'
    ? 'Super_Admin'
    : lower === 'admin'
      ? 'Admin'
      : lower === 'staff'
        ? 'Staff'
      : lower === 'mentor'
        ? 'Mentor'
        : lower === 'newbie'
          ? 'Newbie'
          : '';
  const key = alias || englishAlias || raw;
  if (!key) return MENTOR_FORUM_CONFIG.app.defaultRole;
  if (CORE_ROLE_SET.has(key)) return key;
  if (roleDefMap.has(key)) return key;
  return MENTOR_FORUM_CONFIG.app.defaultRole;
}

export function roleLevelWithDefinitions(roleKey, roleDefinitions) {
  const key = normalizeText(roleKey);
  if (!key) return 0;

  const core = coreRoleDefaults.find((item) => item.role === key);
  if (core) return Number(core.level) || 0;

  const roleDoc = roleDefinitions.find((item) => normalizeText(item.role) === key);
  if (roleDoc && Number.isFinite(Number(roleDoc.level))) return Number(roleDoc.level);
  return 0;
}

export function sortRolesForManage(roleDocs, roleDefinitions) {
  return [...roleDocs].sort((a, b) => {
    const la = roleLevelWithDefinitions(a.role, roleDefinitions);
    const lb = roleLevelWithDefinitions(b.role, roleDefinitions);
    if (la !== lb) return lb - la;
    return String(a.role).localeCompare(String(b.role), 'ko');
  });
}

export function sortUsersForManage(users, roleDefinitions) {
  return [...users].sort((a, b) => {
    const la = roleLevelWithDefinitions(a.role || 'Newbie', roleDefinitions);
    const lb = roleLevelWithDefinitions(b.role || 'Newbie', roleDefinitions);
    if (la !== lb) return lb - la;

    const na = normalizeText(a.realName || a.nickname || a.email).toLowerCase();
    const nb = normalizeText(b.realName || b.nickname || b.email).toLowerCase();
    if (na !== nb) return na.localeCompare(nb, 'ko');

    return String(a.uid || '').localeCompare(String(b.uid || ''));
  });
}

export function isDividerItem(item) {
  return !!(item && item.isDivider === true);
}

export function dividerLabel(item) {
  return normalizeText(item?.dividerLabel) || '구분선';
}

export function boardSortValue(item) {
  const n = Number(item?.sortOrder);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function sortBoardItems(items) {
  return [...items].sort((a, b) => {
    const sa = boardSortValue(a);
    const sb = boardSortValue(b);
    if (sa !== sb) return sa - sb;

    const na = normalizeText(a.name || a.dividerLabel || a.id);
    const nb = normalizeText(b.name || b.dividerLabel || b.id);
    return na.localeCompare(nb, 'ko');
  });
}

export function initRoleFlags() {
  return {
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false
  };
}

export function buildRoleFlagsFromDoc(roleDoc) {
  const next = initRoleFlags();
  roleFlagDefs.forEach((flag) => {
    next[flag.key] = !!roleDoc?.[flag.key];
  });
  return next;
}

export function buildManageState(type, label) {
  return {
    type,
    label,
    className: type === 'ok'
      ? 'user-state-ok'
      : type === 'warn'
        ? 'user-state-warn'
        : 'user-state-lock'
  };
}

export function roleSummaryText(roleDoc) {
  return roleFlagDefs
    .filter((flag) => roleDoc?.[flag.key])
    .map((flag) => flag.label)
    .join(', ');
}
