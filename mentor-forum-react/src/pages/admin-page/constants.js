// AdminPage constants.
// Role defaults and permission flags are treated as policy contracts across
// controller/view/data, so update with extra care.
import { deleteField } from '../../legacy/firebase-app.js';

export const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
export const DEFAULT_VENUE_LABELS = ['구로', '경기도서관'];

export const roleFlagDefs = [
  { key: 'canModerate', label: '글/댓글 강제 수정·삭제' },
  { key: 'canManageBoards', label: '게시판 관리' },
  { key: 'canManageRoles', label: '회원 등급 변경' },
  { key: 'canManageRoleDefinitions', label: 'Role 추가/삭제' },
  { key: 'canAccessAdminSite', label: '관리자 사이트 접근' }
];

export const ROLE_KEY_ALIASES = {
  '개발자': 'Super_Admin',
  '관리자': 'Admin',
  '멘토': 'Mentor',
  '새싹': 'Newbie',
  '토': 'Mentor',
  '운영진': 'Staff'
};

export const ROLE_COLOR_PRESETS = [
  '#ffffff', '#f8fafc', '#e2e8f0', '#334155',
  '#dbeafe', '#bfdbfe', '#1d4ed8', '#1e3a8a',
  '#dcfce7', '#86efac', '#166534', '#14532d',
  '#fef3c7', '#f59e0b', '#b45309', '#78350f',
  '#fee2e2', '#f87171', '#b91c1c', '#7f1d1d',
  '#f3e8ff', '#d8b4fe', '#7e22ce', '#581c87'
];

export const coreRoleDefaults = [
  {
    role: 'Newbie',
    labelKo: '새싹',
    level: 10,
    adminDeleteLocked: true,
    badgeBgColor: '#ffffff',
    badgeTextColor: '#334155',
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false
  },
  {
    role: 'Mentor',
    labelKo: '멘토',
    level: 40,
    adminDeleteLocked: true,
    badgeBgColor: '#dcfce7',
    badgeTextColor: '#166534',
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false
  },
  {
    role: 'Staff',
    labelKo: '운영진',
    level: 60,
    adminDeleteLocked: true,
    badgeBgColor: '#fde68a',
    badgeTextColor: '#92400e',
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false
  },
  {
    role: 'Admin',
    labelKo: '관리자',
    level: 80,
    adminDeleteLocked: true,
    badgeBgColor: '#dbeafe',
    badgeTextColor: '#1d4ed8',
    canModerate: true,
    canManageBoards: true,
    canManageRoles: true,
    canManageRoleDefinitions: false,
    canAccessAdminSite: true
  },
  {
    role: 'Super_Admin',
    labelKo: '개발자',
    level: 100,
    adminDeleteLocked: true,
    badgeBgColor: '#f3e8ff',
    badgeTextColor: '#7e22ce',
    canModerate: true,
    canManageBoards: true,
    canManageRoles: true,
    canManageRoleDefinitions: true,
    canAccessAdminSite: true
  }
];

export const CORE_ROLE_SET = new Set(coreRoleDefaults.map((item) => item.role));

export const legacyRoleVisibilityCleanup = {
  canReadPublic: deleteField(),
  canReadMentor: deleteField(),
  canWritePublic: deleteField(),
  canWriteMentor: deleteField()
};
