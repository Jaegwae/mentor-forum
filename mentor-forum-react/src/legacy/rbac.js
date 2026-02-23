// Role metadata, permission resolution, and role badge helpers.
import { MENTOR_FORUM_CONFIG } from './config.js';

export const CORE_ROLES = ['Newbie', 'Mentor', 'Staff', 'Admin', 'Super_Admin'];

const CORE_ROLE_META = {
  Newbie: {
    level: 10,
    canReadPublic: true,
    canReadMentor: false,
    canWritePublic: false,
    canWriteMentor: false,
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false,
    badgeBgColor: '#ffffff',
    badgeTextColor: '#334155'
  },
  Mentor: {
    level: 40,
    canReadPublic: true,
    canReadMentor: true,
    canWritePublic: false,
    canWriteMentor: true,
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false,
    badgeBgColor: '#dcfce7',
    badgeTextColor: '#166534'
  },
  Staff: {
    level: 60,
    canReadPublic: true,
    canReadMentor: true,
    canWritePublic: true,
    canWriteMentor: true,
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false,
    badgeBgColor: '#fde68a',
    badgeTextColor: '#92400e'
  },
  Admin: {
    level: 80,
    canReadPublic: true,
    canReadMentor: true,
    canWritePublic: true,
    canWriteMentor: true,
    canModerate: true,
    canManageBoards: true,
    canManageRoles: true,
    canManageRoleDefinitions: false,
    canAccessAdminSite: true,
    badgeBgColor: '#dbeafe',
    badgeTextColor: '#1d4ed8'
  },
  Super_Admin: {
    level: 100,
    canReadPublic: true,
    canReadMentor: true,
    canWritePublic: true,
    canWriteMentor: true,
    canModerate: true,
    canManageBoards: true,
    canManageRoles: true,
    canManageRoleDefinitions: true,
    canAccessAdminSite: true,
    badgeBgColor: '#f3e8ff',
    badgeTextColor: '#7e22ce'
  }
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeBadgeColor(value, fallback = '#ffffff') {
  const input = String(value || '').trim();
  if (HEX_COLOR_RE.test(input)) return input.toLowerCase();
  const safeFallback = String(fallback || '').trim();
  if (HEX_COLOR_RE.test(safeFallback)) return safeFallback.toLowerCase();
  return '#ffffff';
}

export function getRoleBadgePalette(role, roleDefinition = null) {
  const base = CORE_ROLE_META[role] || CORE_ROLE_META.Newbie;
  const def = roleDefinition || {};
  const bgColor = normalizeBadgeColor(def.badgeBgColor, base.badgeBgColor);
  const textColor = normalizeBadgeColor(def.badgeTextColor, base.badgeTextColor);
  const borderColor = bgColor === '#ffffff' ? '#cbd5e1' : bgColor;
  return { bgColor, textColor, borderColor };
}

export function roleDisplay(role) {
  const labelMap = (MENTOR_FORUM_CONFIG.app && MENTOR_FORUM_CONFIG.app.roleLabels) || {};
  const suffix = labelMap[role] || '사용자';
  return `${role}(${suffix})`;
}

export function buildPermissions(role, userDoc, roleDefinition) {
  const base = CORE_ROLE_META[role] || CORE_ROLE_META.Newbie;
  const def = roleDefinition || {};
  const merged = {
    level: Number(def.level) || base.level,
    canReadPublic: def.canReadPublic !== undefined ? !!def.canReadPublic : !!base.canReadPublic,
    canReadMentor: def.canReadMentor !== undefined ? !!def.canReadMentor : !!base.canReadMentor,
    canWritePublic: def.canWritePublic !== undefined ? !!def.canWritePublic : !!base.canWritePublic,
    canWriteMentor: def.canWriteMentor !== undefined ? !!def.canWriteMentor : !!base.canWriteMentor,
    canModerate: def.canModerate !== undefined ? !!def.canModerate : !!base.canModerate,
    canManageBoards: def.canManageBoards !== undefined ? !!def.canManageBoards : !!base.canManageBoards,
    canManageRoles: def.canManageRoles !== undefined ? !!def.canManageRoles : !!base.canManageRoles,
    canManageRoleDefinitions: def.canManageRoleDefinitions !== undefined ? !!def.canManageRoleDefinitions : !!base.canManageRoleDefinitions,
    canAccessAdminSite: def.canAccessAdminSite !== undefined ? !!def.canAccessAdminSite : !!base.canAccessAdminSite
  };

  // Core authorities are fixed by policy.
  if (role === 'Admin' || role === 'Super_Admin') {
    merged.canModerate = true;
    merged.canManageBoards = true;
    merged.canManageRoles = true;
    merged.canAccessAdminSite = true;
  }
  if (role === 'Super_Admin') {
    merged.canManageRoleDefinitions = true;
  }

  merged.canWriteAny = merged.canWritePublic || merged.canWriteMentor;
  return merged;
}

export function canReadVisibility(permissions, visibility) {
  if (visibility === 'mentor') return !!permissions.canReadMentor;
  return !!permissions.canReadPublic;
}

export function canWriteVisibility(permissions, visibility) {
  if (visibility === 'mentor') return !!permissions.canWriteMentor;
  return !!permissions.canWritePublic;
}

export function sortRolesByLevel(roleDocs) {
  return [...roleDocs].sort((a, b) => {
    const la = Number(a.level) || 0;
    const lb = Number(b.level) || 0;
    if (la !== lb) return lb - la;
    return String(a.role).localeCompare(String(b.role));
  });
}
