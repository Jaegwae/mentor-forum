// Admin page for board, role, and user management.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutPanelTop, LogOut, MapPin, MessageSquare, ShieldCheck, ShieldPlus, UsersRound } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select.jsx';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildAdminExcelSheetModel
} from '../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../hooks/useTheme.js';
import {
  auth,
  db,
  ensureFirebaseConfigured,
  onAuthStateChanged,
  getTemporaryLoginRemainingMs,
  setTemporaryLoginExpiry,
  TEMP_LOGIN_TTL_MS,
  clearTemporaryLoginExpiry,
  enforceTemporaryLoginExpiry,
  signOut,
  serverTimestamp,
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  writeBatch
} from '../legacy/firebase-app.js';
import {
  buildPermissions,
  roleDisplay,
  getRoleBadgePalette,
  normalizeBadgeColor
} from '../legacy/rbac.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { sanitizeRoleKey } from '../legacy/ui.js';

const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
const DEFAULT_VENUE_LABELS = ['구로', '경기도서관'];

const roleFlagDefs = [
  { key: 'canModerate', label: '글/댓글 강제 수정·삭제' },
  { key: 'canManageBoards', label: '게시판 관리' },
  { key: 'canManageRoles', label: '회원 등급 변경' },
  { key: 'canManageRoleDefinitions', label: 'Role 추가/삭제' },
  { key: 'canAccessAdminSite', label: '관리자 사이트 접근' }
];

const ROLE_KEY_ALIASES = {
  '개발자': 'Super_Admin',
  '관리자': 'Admin',
  '멘토': 'Mentor',
  '새싹': 'Newbie',
  '토': 'Mentor',
  '운영진': 'Staff'
};

const ROLE_COLOR_PRESETS = [
  '#ffffff', '#f8fafc', '#e2e8f0', '#334155',
  '#dbeafe', '#bfdbfe', '#1d4ed8', '#1e3a8a',
  '#dcfce7', '#86efac', '#166534', '#14532d',
  '#fef3c7', '#f59e0b', '#b45309', '#78350f',
  '#fee2e2', '#f87171', '#b91c1c', '#7f1d1d',
  '#f3e8ff', '#d8b4fe', '#7e22ce', '#581c87'
];

const coreRoleDefaults = [
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

const CORE_ROLE_SET = new Set(coreRoleDefaults.map((item) => item.role));

const legacyRoleVisibilityCleanup = {
  canReadPublic: deleteField(),
  canReadMentor: deleteField(),
  canWritePublic: deleteField(),
  canWriteMentor: deleteField()
};

function normalizeText(value) {
  return String(value || '').trim();
}

function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const viewportWide = window.matchMedia('(min-width: 901px)').matches;
  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ''));

  const desktopLike = viewportWide && hoverFine && pointerFine && !mobileUa;
  return !desktopLike;
}

function shouldLogDebugPayload() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return window.__MENTOR_DEBUG__ === true;
}

function isPermissionDeniedError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.includes('permission-denied');
}

function joinDebugParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' | ');
}

function debugCodePoints(value) {
  const raw = String(value ?? '');
  if (!raw) return '-';
  return Array.from(raw)
    .map((char) => `U+${(char.codePointAt(0) || 0).toString(16).toUpperCase()}`)
    .join(',');
}

function debugValueList(values) {
  if (!Array.isArray(values)) return '-';
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length ? normalized.join(',') : '-';
}

function normalizeNickname(value) {
  return normalizeText(value);
}

function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

function normalizeVenueLabel(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

function sortVenueOptions(items) {
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

function timestampToMs(value) {
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

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.map((role) => normalizeText(role)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function isCoreRole(roleKey) {
  return CORE_ROLE_SET.has(normalizeText(roleKey));
}

function roleDeleteLockedForAdmin(roleDoc) {
  return !!(roleDoc && roleDoc.adminDeleteLocked === true);
}

function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  roleDefinitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

function normalizeRoleKey(roleKey, roleDefMap) {
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

function roleLevelWithDefinitions(roleKey, roleDefinitions) {
  const key = normalizeText(roleKey);
  if (!key) return 0;

  const core = coreRoleDefaults.find((item) => item.role === key);
  if (core) return Number(core.level) || 0;

  const roleDoc = roleDefinitions.find((item) => normalizeText(item.role) === key);
  if (roleDoc && Number.isFinite(Number(roleDoc.level))) return Number(roleDoc.level);
  return 0;
}

function sortRolesForManage(roleDocs, roleDefinitions) {
  return [...roleDocs].sort((a, b) => {
    const la = roleLevelWithDefinitions(a.role, roleDefinitions);
    const lb = roleLevelWithDefinitions(b.role, roleDefinitions);
    if (la !== lb) return lb - la;
    return String(a.role).localeCompare(String(b.role), 'ko');
  });
}

function sortUsersForManage(users, roleDefinitions) {
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

function isDividerItem(item) {
  return !!(item && item.isDivider === true);
}

function dividerLabel(item) {
  return normalizeText(item?.dividerLabel) || '구분선';
}

function boardSortValue(item) {
  const n = Number(item?.sortOrder);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function sortBoardItems(items) {
  return [...items].sort((a, b) => {
    const sa = boardSortValue(a);
    const sb = boardSortValue(b);
    if (sa !== sb) return sa - sb;

    const na = normalizeText(a.name || a.dividerLabel || a.id);
    const nb = normalizeText(b.name || b.dividerLabel || b.id);
    return na.localeCompare(nb, 'ko');
  });
}

function initRoleFlags() {
  return {
    canModerate: false,
    canManageBoards: false,
    canManageRoles: false,
    canManageRoleDefinitions: false,
    canAccessAdminSite: false
  };
}

function buildRoleFlagsFromDoc(roleDoc) {
  const next = initRoleFlags();
  roleFlagDefs.forEach((flag) => {
    next[flag.key] = !!roleDoc?.[flag.key];
  });
  return next;
}

function buildManageState(type, label) {
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

function roleSummaryText(roleDoc) {
  return roleFlagDefs
    .filter((flag) => roleDoc?.[flag.key])
    .map((flag) => flag.label)
    .join(', ');
}

function RoleBadge({ role, roleDefinition = null }) {
  const roleKey = normalizeText(role) || 'Newbie';
  const def = roleDefinition || null;
  const palette = getRoleBadgePalette(roleKey, def);
  const label = def?.labelKo || roleKey;

  return (
    <span
      className="role-badge"
      style={{
        background: palette.bgColor,
        color: palette.textColor,
        borderColor: palette.borderColor
      }}
    >
      {label}
    </span>
  );
}

function RoleColorField({ id, label, value, disabled = false, onChange }) {
  const safeValue = normalizeBadgeColor(value, '#ffffff');
  return (
    <label>
      {label}
      <div className="role-color-field">
        <input
          id={id}
          type="text"
          value={safeValue}
          placeholder="#ffffff"
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <span className="role-color-preview" style={{ backgroundColor: safeValue }} aria-hidden="true" />
      </div>
      <div className="role-color-palette">
        {ROLE_COLOR_PRESETS.map((color) => (
          <button
            key={`${id}-preset-${color}`}
            type="button"
            className={safeValue === color ? 'role-color-chip is-active' : 'role-color-chip'}
            style={{ backgroundColor: color }}
            disabled={disabled}
            aria-label={`${label} ${color}`}
            title={color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </label>
  );
}

async function loadRoleDefinitionsFromDb() {
  const snap = await getDocs(collection(db, 'role_definitions'));
  const docs = snap.docs.map((d) => ({ role: d.id, ...d.data() }));
  const mergedByRole = new Map();

  coreRoleDefaults.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  docs.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...(mergedByRole.get(key) || {}), ...item, role: key });
  });

  return [...mergedByRole.values()];
}

async function ensureUserProfile(user, roleDefMap) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const profile = snap.data();
    const normalizedRole = normalizeRoleKey(profile.role, roleDefMap);

    if (!!user.emailVerified && !profile.emailVerified) {
      await updateDoc(ref, {
        emailVerified: true,
        updatedAt: serverTimestamp()
      });
      return { ...profile, role: normalizedRole, emailVerified: true };
    }

    return { ...profile, role: normalizedRole };
  }

  const profile = {
    uid: user.uid,
    email: user.email || '',
    realName: user.displayName || '',
    nickname: user.email ? user.email.split('@')[0] : 'new-user',
    role: MENTOR_FORUM_CONFIG.app.defaultRole,
    emailVerified: !!user.emailVerified,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(ref, profile);
  return { ...profile, role: normalizeRoleKey(profile.role, roleDefMap) };
}

function AdminModal({ modalId, open, onClose, panelClassName = 'admin-modal-panel', children }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          id={modalId}
          className="admin-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <motion.div
            className="admin-modal-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          />
          <motion.section
            className={`card ${panelClassName}`}
            initial={{ opacity: 0, y: 36, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 26, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.72 }}
          >
            {children}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function AdminPage() {
  usePageMeta('멘토포럼 관리자 사이트', 'admin-page');

  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isExcel = theme === 'excel';
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

  const expiryTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const lastActivityRefreshAtRef = useRef(0);
  const appliedPopupTimerRef = useRef(null);
  const draggingBoardItemIdRef = useRef('');

  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [appliedPopup, setAppliedPopup] = useState({ open: false, text: '반영되었습니다.', tone: 'ok' });

  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);

  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);

  const [roleDefinitions, setRoleDefinitions] = useState([]);
  const [activeEditRoleKey, setActiveEditRoleKey] = useState('');

  const [createRoleForm, setCreateRoleForm] = useState({
    role: '',
    labelKo: '',
    level: 15,
    badgeBgColor: '#ffffff',
    badgeTextColor: '#334155',
    adminDeleteLocked: false,
    flags: initRoleFlags()
  });

  const [editRoleForm, setEditRoleForm] = useState({
    role: '',
    labelKo: '',
    level: '',
    badgeBgColor: '#ffffff',
    badgeTextColor: '#334155',
    adminDeleteLocked: false,
    flags: initRoleFlags()
  });

  const [boardItems, setBoardItems] = useState([]);
  const [activeEditBoardId, setActiveEditBoardId] = useState('');

  const [createBoardForm, setCreateBoardForm] = useState({
    id: '',
    name: '',
    description: '',
    allowedRoles: []
  });

  const [editBoardForm, setEditBoardForm] = useState({
    id: '',
    name: '',
    description: '',
    allowedRoles: []
  });

  const [allUserRows, setAllUserRows] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userDrafts, setUserDrafts] = useState({});
  const [syncingNicknameIndex, setSyncingNicknameIndex] = useState(false);
  const [venueOptions, setVenueOptions] = useState([]);
  const [venueDrafts, setVenueDrafts] = useState({});
  const [newVenueLabel, setNewVenueLabel] = useState('');
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [savingVenueId, setSavingVenueId] = useState('');
  const [deletingVenueId, setDeletingVenueId] = useState('');

  const [boardEditOpen, setBoardEditOpen] = useState(false);
  const [boardCreateOpen, setBoardCreateOpen] = useState(false);
  const [roleEditOpen, setRoleEditOpen] = useState(false);
  const [roleCreateOpen, setRoleCreateOpen] = useState(false);

  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const sortedRoles = useMemo(
    () => sortRolesForManage(roleDefinitions, roleDefinitions),
    [roleDefinitions]
  );
  const editableRoles = useMemo(
    () => sortRolesForManage(roleDefinitions.filter((role) => !isCoreRole(role.role)), roleDefinitions),
    [roleDefinitions]
  );

  const boardRows = useMemo(
    () => boardItems.filter((item) => !isDividerItem(item)),
    [boardItems]
  );

  const anyModalOpen = boardEditOpen || boardCreateOpen || roleEditOpen || roleCreateOpen;

  const isSuperAdminUser = currentUserProfile?.role === 'Super_Admin';
  const myRoleLevel = useMemo(
    () => roleLevelWithDefinitions(currentUserProfile?.role, roleDefinitions),
    [currentUserProfile, roleDefinitions]
  );

  const clearMessage = useCallback(() => {
    setMessage({ type: '', text: '' });
  }, []);

  const pushMessage = useCallback((text, type = 'notice') => {
    setMessage({ type, text: String(text || '') });
  }, []);

  const showAppliedPopup = useCallback((text = '반영되었습니다.', tone = 'ok') => {
    if (appliedPopupTimerRef.current) {
      window.clearTimeout(appliedPopupTimerRef.current);
      appliedPopupTimerRef.current = null;
    }

    setAppliedPopup({ open: true, text, tone });

    appliedPopupTimerRef.current = window.setTimeout(() => {
      setAppliedPopup((prev) => ({ ...prev, open: false }));
      appliedPopupTimerRef.current = null;
    }, 1200);
  }, []);

  const roleLevelOf = useCallback((roleKey) => {
    return roleLevelWithDefinitions(roleKey, roleDefinitions);
  }, [roleDefinitions]);

  const evaluateUserManageState = useCallback((targetUid, targetRole, nextRole = targetRole) => {
    if (!permissions?.canManageRoles) return buildManageState('lock', '권한 없음');
    if (!currentUser || !currentUserProfile) return buildManageState('lock', '권한 없음');
    if (String(targetUid) === String(currentUser.uid)) return buildManageState('lock', '본인 계정');

    const currentLevel = roleLevelOf(targetRole);
    if (!(currentLevel < myRoleLevel)) return buildManageState('lock', '동급/상위');

    const nextLevel = roleLevelOf(nextRole);
    if (!(nextLevel < myRoleLevel)) return buildManageState('warn', '등급 선택 확인');

    return buildManageState('ok', '저장 가능');
  }, [permissions, currentUser, currentUserProfile, roleLevelOf, myRoleLevel]);

  const getBoardRoleChoices = useCallback((selectedRoles) => {
    const selected = normalizeRoles(selectedRoles);
    const selectedSet = new Set(selected);
    const knownRoles = new Set(sortedRoles.map((roleDoc) => roleDoc.role));

    const extras = selected
      .filter((role) => !knownRoles.has(role))
      .map((role) => ({ role, labelKo: '미정의 Role', extra: true }));

    return [...sortedRoles, ...extras].map((item) => ({
      role: item.role,
      labelKo: item.labelKo || '사용자',
      extra: !!item.extra,
      checked: selectedSet.has(item.role)
    }));
  }, [sortedRoles]);

  const defaultBoardRoles = useMemo(() => {
    if (!roleDefinitions.length) return [];
    if (roleDefinitions.some((roleDoc) => roleDoc.role === 'Newbie')) return ['Newbie'];
    if (!sortedRoles.length) return [];
    return [sortedRoles[0].role];
  }, [roleDefinitions, sortedRoles]);

  const filteredUsers = useMemo(() => {
    const keyword = normalizeText(userSearch).toLowerCase();

    if (!keyword) {
      return sortUsersForManage(allUserRows, roleDefinitions);
    }

    const matched = allUserRows.filter((userRow) => {
      const email = normalizeText(userRow.email).toLowerCase();
      const realName = normalizeText(userRow.realName).toLowerCase();
      const nickname = normalizeText(userRow.nickname).toLowerCase();
      return email.includes(keyword) || realName.includes(keyword) || nickname.includes(keyword);
    });

    return sortUsersForManage(matched, roleDefinitions);
  }, [allUserRows, userSearch, roleDefinitions]);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current == null) return;
    window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, []);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current == null) return;
    window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
  }, []);

  const handleTemporaryLoginExpiry = useCallback(async () => {
    clearExpiryTimer();
    clearCountdownTimer();
    setSessionRemainingMs(null);
    clearTemporaryLoginExpiry();

    try {
      await signOut(auth);
    } catch (_) {
      // Ignore sign-out failure during forced expiry.
    }

    alert(AUTO_LOGOUT_MESSAGE);
    navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
  }, [clearCountdownTimer, clearExpiryTimer, navigate]);

  const scheduleTemporaryLoginExpiry = useCallback((remainingMs) => {
    clearExpiryTimer();
    const remain = Number(remainingMs);
    if (!Number.isFinite(remain) || remain <= 0) return;

    expiryTimerRef.current = window.setTimeout(() => {
      handleTemporaryLoginExpiry().catch(() => {});
    }, remain);
  }, [clearExpiryTimer, handleTemporaryLoginExpiry]);

  const hasTemporarySession = sessionRemainingMs != null;

  useEffect(() => {
    if (!hasTemporarySession) {
      clearCountdownTimer();
      return () => {};
    }

    clearCountdownTimer();

    countdownTimerRef.current = window.setInterval(() => {
      const remaining = getTemporaryLoginRemainingMs();
      if (remaining == null) {
        setSessionRemainingMs(null);
        clearCountdownTimer();
        return;
      }

      if (remaining <= 0) {
        handleTemporaryLoginExpiry().catch(() => {});
        return;
      }

      setSessionRemainingMs(remaining);
    }, 1000);

    return () => {
      clearCountdownTimer();
    };
  }, [hasTemporarySession, clearCountdownTimer, handleTemporaryLoginExpiry]);

  useEffect(() => {
    if (!hasTemporarySession) {
      lastActivityRefreshAtRef.current = 0;
      return () => {};
    }

    const refreshSessionByActivity = () => {
      const remainingMs = getTemporaryLoginRemainingMs();
      if (remainingMs == null || remainingMs <= 0) return;

      const now = Date.now();
      if (now - lastActivityRefreshAtRef.current < 1000) return;
      lastActivityRefreshAtRef.current = now;

      setTemporaryLoginExpiry(now + TEMP_LOGIN_TTL_MS);
      setSessionRemainingMs(TEMP_LOGIN_TTL_MS);
      scheduleTemporaryLoginExpiry(TEMP_LOGIN_TTL_MS);
    };

    const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, refreshSessionByActivity);
    });

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, refreshSessionByActivity);
      });
    };
  }, [hasTemporarySession, scheduleTemporaryLoginExpiry]);

  useEffect(() => {
    document.body.classList.toggle('modal-open', anyModalOpen);
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [anyModalOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setBoardEditOpen(false);
      setBoardCreateOpen(false);
      setRoleEditOpen(false);
      setRoleCreateOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (appliedPopupTimerRef.current) {
        window.clearTimeout(appliedPopupTimerRef.current);
      }
    };
  }, []);

  const refreshRoles = useCallback(async (preferredRoleKey = '') => {
    const loadedDefinitions = await loadRoleDefinitionsFromDb();
    setRoleDefinitions(loadedDefinitions);

    const nextEditable = sortRolesForManage(
      loadedDefinitions.filter((roleDoc) => !isCoreRole(roleDoc.role)),
      loadedDefinitions
    );

    if (!nextEditable.length) {
      setActiveEditRoleKey('');
      setEditRoleForm({
        role: '',
        labelKo: '',
        level: '',
        badgeBgColor: '#ffffff',
        badgeTextColor: '#334155',
        adminDeleteLocked: false,
        flags: initRoleFlags()
      });
      return loadedDefinitions;
    }

    const selectedRoleKey = nextEditable.some((item) => item.role === preferredRoleKey)
      ? preferredRoleKey
      : nextEditable.some((item) => item.role === activeEditRoleKey)
        ? activeEditRoleKey
        : nextEditable[0].role;

    const selectedRole = loadedDefinitions.find((item) => item.role === selectedRoleKey);
    const selectedLevel = roleLevelWithDefinitions(selectedRoleKey, loadedDefinitions);

    setActiveEditRoleKey(selectedRoleKey);
    setEditRoleForm({
      role: selectedRoleKey,
      labelKo: selectedRole?.labelKo || selectedRoleKey,
      level: selectedLevel || '',
      badgeBgColor: normalizeBadgeColor(selectedRole?.badgeBgColor, '#ffffff'),
      badgeTextColor: normalizeBadgeColor(selectedRole?.badgeTextColor, '#334155'),
      adminDeleteLocked: !!selectedRole?.adminDeleteLocked,
      flags: buildRoleFlagsFromDoc(selectedRole)
    });

    return loadedDefinitions;
  }, [activeEditRoleKey]);

  const refreshBoards = useCallback(async (preferredBoardId = '') => {
    const snap = await getDocs(collection(db, 'boards'));
    const nextItems = sortBoardItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setBoardItems(nextItems);

    const rows = nextItems.filter((item) => !isDividerItem(item));
    if (!rows.length) {
      setActiveEditBoardId('');
      setEditBoardForm({ id: '', name: '', description: '', allowedRoles: [] });
      return nextItems;
    }

    const selectedBoardId = rows.some((item) => item.id === preferredBoardId)
      ? preferredBoardId
      : rows.some((item) => item.id === activeEditBoardId)
        ? activeEditBoardId
        : rows[0].id;

    const selectedBoard = rows.find((item) => item.id === selectedBoardId) || rows[0];

    setActiveEditBoardId(selectedBoard.id);
    setEditBoardForm({
      id: selectedBoard.id,
      name: selectedBoard.name || '',
      description: selectedBoard.description || '',
      allowedRoles: normalizeRoles(selectedBoard.allowedRoles)
    });

    return nextItems;
  }, [activeEditBoardId]);

  const refreshUsers = useCallback(async () => {
    const usersSnap = await getDocs(collection(db, 'users'));
    const rows = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    setAllUserRows(rows);
    setUserDrafts(() => {
      const next = {};
      rows.forEach((row) => {
        next[row.uid] = {
          role: normalizeText(row.role) || 'Newbie'
        };
      });
      return next;
    });
  }, []);

  const refreshVenueOptions = useCallback(async () => {
    const snap = await getDocs(collection(db, 'venue_options'));
    const rows = sortVenueOptions(
      snap.docs.map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          id: docSnap.id,
          label: normalizeVenueLabel(data.label || data.name || docSnap.id),
          sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : null
        };
      })
    );
    setVenueOptions(rows);
    setVenueDrafts(() => {
      const next = {};
      rows.forEach((row) => {
        next[row.id] = {
          label: normalizeVenueLabel(row.label)
        };
      });
      return next;
    });
    return rows;
  }, []);

  const ensureDefaultVenueOptions = useCallback(async (rows = []) => {
    if (!permissions?.canManageBoards) return rows;
    const existingRows = Array.isArray(rows) ? rows : [];
    const existingLabelSet = new Set(
      existingRows
        .map((item) => normalizeVenueLabel(item?.label).toLowerCase())
        .filter(Boolean)
    );
    const missingLabels = DEFAULT_VENUE_LABELS
      .map((label) => normalizeVenueLabel(label))
      .filter((label) => !!label && !existingLabelSet.has(label.toLowerCase()));

    if (!missingLabels.length) return existingRows;

    const maxSort = existingRows.reduce((acc, item) => {
      const value = Number(item?.sortOrder);
      return Number.isFinite(value) ? Math.max(acc, value) : acc;
    }, 0);

    await Promise.all(
      missingLabels.map((label, index) => addDoc(collection(db, 'venue_options'), {
        label,
        sortOrder: maxSort + ((index + 1) * 10),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || ''
      }))
    );
    return refreshVenueOptions();
  }, [currentUser?.uid, permissions?.canManageBoards, refreshVenueOptions]);

  const backfillNicknameIndex = useCallback(async () => {
    clearMessage();
    if (!permissions?.canManageRoles) {
      pushMessage('닉네임 인덱스 동기화 권한이 없습니다.', 'error');
      return;
    }
    setSyncingNicknameIndex(true);
    try {
      const rows = [...allUserRows];
      if (!rows.length) {
        pushMessage('동기화할 회원 데이터가 없습니다. 회원 목록을 먼저 새로고침해주세요.', 'notice');
        return;
      }

      const orderedRows = rows.sort((a, b) => {
        const ta = timestampToMs(a.createdAt);
        const tb = timestampToMs(b.createdAt);
        if (ta !== tb) return ta - tb;
        return String(a.uid || '').localeCompare(String(b.uid || ''));
      });

      let createdCount = 0;
      let existsCount = 0;
      let skippedCount = 0;
      let conflictCount = 0;

      for (const row of orderedRows) {
        const uid = normalizeText(row.uid);
        const nickname = normalizeNickname(row.nickname);
        const nicknameKey = buildNicknameKey(nickname);

        if (!uid || !nickname || !nicknameKey) {
          skippedCount += 1;
          continue;
        }

        const indexRef = doc(db, 'nickname_index', nicknameKey);
        const indexSnap = await getDoc(indexRef);
        if (indexSnap.exists()) {
          const existingUid = normalizeText(indexSnap.data()?.uid);
          if (existingUid && existingUid !== uid) {
            conflictCount += 1;
          } else {
            existsCount += 1;
          }
          continue;
        }

        await setDoc(indexRef, {
          uid,
          nickname,
          nicknameKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        createdCount += 1;
      }

      const tone = conflictCount > 0 ? 'error' : 'notice';
      pushMessage(
        `닉네임 인덱스 동기화 완료 · 신규 ${createdCount} / 기존 ${existsCount} / 스킵 ${skippedCount} / 충돌 ${conflictCount}`,
        tone
      );
    } catch (err) {
      pushMessage(err?.message || '닉네임 인덱스 동기화 실패', 'error');
    } finally {
      setSyncingNicknameIndex(false);
    }
  }, [allUserRows, clearMessage, permissions, pushMessage]);

  const handleExtendSession = useCallback(() => {
    const remainingMs = getTemporaryLoginRemainingMs();
    if (remainingMs == null) return;

    setTemporaryLoginExpiry(Date.now() + TEMP_LOGIN_TTL_MS);
    setSessionRemainingMs(TEMP_LOGIN_TTL_MS);
    scheduleTemporaryLoginExpiry(TEMP_LOGIN_TTL_MS);
  }, [scheduleTemporaryLoginExpiry]);

  const handleLogout = useCallback(async () => {
    clearExpiryTimer();
    clearCountdownTimer();
    setSessionRemainingMs(null);
    clearTemporaryLoginExpiry();

    await signOut(auth);
    navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
  }, [clearCountdownTimer, clearExpiryTimer, navigate]);

  useEffect(() => {
    let active = true;
    clearMessage();
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        pushMessage(err?.message || 'Firebase 설정 오류', 'error');
        setReady(true);
      }
      return () => {
        active = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (!user) {
        clearExpiryTimer();
        clearCountdownTimer();
        setSessionRemainingMs(null);
        navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
        return;
      }

      const sessionState = await enforceTemporaryLoginExpiry();
      if (!active) return;

      if (sessionState.expired) {
        clearExpiryTimer();
        clearCountdownTimer();
        setSessionRemainingMs(null);
        alert(AUTO_LOGOUT_MESSAGE);
        navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
        return;
      }

      if (sessionState.remainingMs == null) {
        clearExpiryTimer();
        clearCountdownTimer();
        setSessionRemainingMs(null);
      } else {
        scheduleTemporaryLoginExpiry(sessionState.remainingMs);
        setSessionRemainingMs(sessionState.remainingMs);
      }

      setCurrentUser(user);

      try {
        const loadedDefinitions = await loadRoleDefinitionsFromDb();
        if (!active) return;

        const loadedRoleDefMap = createRoleDefMap(loadedDefinitions);
        const profile = await ensureUserProfile(user, loadedRoleDefMap);
        if (!active) return;

        const roleKey = normalizeRoleKey(profile.role, loadedRoleDefMap);
        const normalizedProfile = { ...profile, role: roleKey };
        const roleDef = loadedRoleDefMap.get(roleKey) || null;
        const nextPermissions = buildPermissions(roleKey, normalizedProfile, roleDef);

        setCurrentUserProfile(normalizedProfile);
        setPermissions(nextPermissions);

        if (!nextPermissions.canAccessAdminSite) {
          pushMessage('관리자 사이트 접근 권한이 없습니다.', 'error');
          window.setTimeout(() => {
            navigate(MENTOR_FORUM_CONFIG.app.appPage, { replace: true });
          }, 1000);
          return;
        }

        setRoleDefinitions(loadedDefinitions);

        const [, , , venueRows] = await Promise.all([
          refreshRoles(),
          refreshBoards(),
          refreshUsers(),
          refreshVenueOptions()
        ]);
        await ensureDefaultVenueOptions(venueRows);

        setCreateBoardForm((prev) => {
          if (prev.allowedRoles.length) return prev;
          if (loadedDefinitions.some((item) => item.role === 'Newbie')) {
            return { ...prev, allowedRoles: ['Newbie'] };
          }

          const sorted = sortRolesForManage(loadedDefinitions, loadedDefinitions);
          return sorted.length
            ? { ...prev, allowedRoles: [sorted[0].role] }
            : prev;
        });

        clearMessage();
      } catch (err) {
        if (!active) return;
        pushMessage(err?.message || '초기화 실패', 'error');
      } finally {
        if (active) setReady(true);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      clearExpiryTimer();
      clearCountdownTimer();
    };
  }, [
    clearCountdownTimer,
    clearExpiryTimer,
    clearMessage,
    ensureDefaultVenueOptions,
    navigate,
    pushMessage,
    refreshBoards,
    refreshRoles,
    refreshUsers,
    refreshVenueOptions,
    scheduleTemporaryLoginExpiry
  ]);

  const ensurePermission = useCallback((flag, errorMessage) => {
    if (permissions?.[flag]) return true;
    pushMessage(errorMessage, 'error');
    return false;
  }, [permissions, pushMessage]);

  const nextBoardSortOrder = useMemo(() => {
    if (!boardItems.length) return 10;
    const max = boardItems.reduce((acc, item) => Math.max(acc, boardSortValue(item)), 0);
    const safeMax = Number.isFinite(max) && max < Number.MAX_SAFE_INTEGER ? max : boardItems.length * 10;
    return safeMax + 10;
  }, [boardItems]);

  const persistBoardOrder = useCallback(async (items) => {
    if (!currentUser) return;
    const MAX_BATCH_OPS = 450;
    let batch = writeBatch(db);
    let opCount = 0;
    const commits = [];

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      batch.set(doc(db, 'boards', item.id), {
        sortOrder: (idx + 1) * 10,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });
      opCount += 1;

      if (opCount >= MAX_BATCH_OPS) {
        commits.push(batch.commit());
        batch = writeBatch(db);
        opCount = 0;
      }
    }

    if (opCount > 0) {
      commits.push(batch.commit());
    }

    for (const commitTask of commits) {
      await commitTask;
    }
  }, [currentUser]);

  const reorderBoardItems = useCallback(async (dragId, targetId) => {
    const fromIdx = boardItems.findIndex((item) => item.id === dragId);
    const toIdx = boardItems.findIndex((item) => item.id === targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const nextItems = [...boardItems];
    const [moved] = nextItems.splice(fromIdx, 1);
    nextItems.splice(toIdx, 0, moved);

    await persistBoardOrder(nextItems);
    await refreshBoards(activeEditBoardId);
    pushMessage('게시판/구분선 순서를 반영했습니다.', 'notice');
    showAppliedPopup();
  }, [boardItems, persistBoardOrder, refreshBoards, activeEditBoardId, pushMessage, showAppliedPopup]);

  const openBoardEditModal = useCallback(() => {
    clearMessage();
    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    if (boardRows.length) {
      const selectedId = boardRows.some((item) => item.id === activeEditBoardId)
        ? activeEditBoardId
        : boardRows[0].id;
      const selectedBoard = boardRows.find((item) => item.id === selectedId);
      if (selectedBoard) {
        setActiveEditBoardId(selectedBoard.id);
        setEditBoardForm({
          id: selectedBoard.id,
          name: selectedBoard.name || '',
          description: selectedBoard.description || '',
          allowedRoles: normalizeRoles(selectedBoard.allowedRoles)
        });
      }
    }

    setBoardEditOpen(true);
  }, [ensurePermission, boardRows, activeEditBoardId, clearMessage]);

  const openBoardCreateModal = useCallback(() => {
    clearMessage();
    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    setCreateBoardForm({
      id: '',
      name: '',
      description: '',
      allowedRoles: defaultBoardRoles
    });
    setBoardCreateOpen(true);
  }, [clearMessage, ensurePermission, defaultBoardRoles]);

  const openRoleEditModal = useCallback(() => {
    clearMessage();
    if (!ensurePermission('canManageRoleDefinitions', 'Role 관리 권한이 없습니다.')) return;

    if (!editableRoles.length) {
      showAppliedPopup('수정 가능한 커스텀 등급이 없습니다.', 'notice');
      return;
    }

    const selectedKey = editableRoles.some((item) => item.role === activeEditRoleKey)
      ? activeEditRoleKey
      : editableRoles[0].role;

    const selectedRole = roleDefinitions.find((item) => item.role === selectedKey);
    setActiveEditRoleKey(selectedKey);
    setEditRoleForm({
      role: selectedKey,
      labelKo: selectedRole?.labelKo || selectedKey,
      level: roleLevelOf(selectedKey) || '',
      badgeBgColor: normalizeBadgeColor(selectedRole?.badgeBgColor, '#ffffff'),
      badgeTextColor: normalizeBadgeColor(selectedRole?.badgeTextColor, '#334155'),
      adminDeleteLocked: !!selectedRole?.adminDeleteLocked,
      flags: buildRoleFlagsFromDoc(selectedRole)
    });

    setRoleEditOpen(true);
  }, [
    clearMessage,
    ensurePermission,
    editableRoles,
    activeEditRoleKey,
    roleDefinitions,
    roleLevelOf,
    showAppliedPopup
  ]);

  const openRoleCreateModal = useCallback(() => {
    clearMessage();
    if (!ensurePermission('canManageRoleDefinitions', 'Role 관리 권한이 없습니다.')) return;

    setCreateRoleForm({
      role: '',
      labelKo: '',
      level: 15,
      badgeBgColor: '#ffffff',
      badgeTextColor: '#334155',
      adminDeleteLocked: false,
      flags: initRoleFlags()
    });

    setRoleCreateOpen(true);
  }, [clearMessage, ensurePermission]);

  const closeModalById = useCallback((modalId) => {
    if (modalId === 'boardEditModal') setBoardEditOpen(false);
    if (modalId === 'boardCreateModal') setBoardCreateOpen(false);
    if (modalId === 'roleEditModal') setRoleEditOpen(false);
    if (modalId === 'roleCreateModal') setRoleCreateOpen(false);
  }, []);

  const saveCreateBoard = useCallback(async (event) => {
    event.preventDefault();
    clearMessage();

    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    const id = sanitizeRoleKey(createBoardForm.id);
    const name = normalizeText(createBoardForm.name);
    const description = normalizeText(createBoardForm.description);
    const allowedRoles = normalizeRoles(createBoardForm.allowedRoles);

    if (!id || !name || !allowedRoles.length) {
      pushMessage('ID/이름/허용 등급을 확인하세요.', 'error');
      return;
    }

    if (boardItems.some((row) => row.id === id)) {
      pushMessage('이미 사용 중인 게시판 ID입니다.', 'error');
      return;
    }

    await setDoc(doc(db, 'boards', id), {
      isDivider: false,
      name,
      description,
      allowedRoles,
      sortOrder: nextBoardSortOrder,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || ''
    }, { merge: true });

    await refreshBoards(id);
    setBoardCreateOpen(false);
    setBoardEditOpen(true);

    pushMessage(`게시판 ${id}를 생성했습니다.`, 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    createBoardForm,
    boardItems,
    nextBoardSortOrder,
    currentUser,
    refreshBoards,
    pushMessage,
    showAppliedPopup
  ]);

  const saveEditBoard = useCallback(async (event) => {
    event.preventDefault();
    clearMessage();

    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    if (!activeEditBoardId) {
      pushMessage('게시판을 먼저 선택하세요.', 'error');
      return;
    }

    const name = normalizeText(editBoardForm.name);
    const description = normalizeText(editBoardForm.description);
    const allowedRoles = normalizeRoles(editBoardForm.allowedRoles);

    if (!name || !allowedRoles.length) {
      pushMessage('이름/허용 등급을 확인하세요.', 'error');
      return;
    }

    const prev = boardRows.find((row) => row.id === activeEditBoardId);
    if (prev) {
      const noChanges = normalizeText(prev.name) === name
        && normalizeText(prev.description) === description
        && normalizeRoles(prev.allowedRoles).join('|') === allowedRoles.join('|');
      if (noChanges) {
        pushMessage('변경 사항이 없습니다.', 'notice');
        return;
      }
    }

    await setDoc(doc(db, 'boards', activeEditBoardId), {
      name,
      description,
      allowedRoles,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || ''
    }, { merge: true });

    await refreshBoards(activeEditBoardId);
    pushMessage('게시판을 저장했습니다.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    activeEditBoardId,
    editBoardForm,
    boardRows,
    currentUser,
    refreshBoards,
    pushMessage,
    showAppliedPopup
  ]);

  const removeBoard = useCallback(async () => {
    clearMessage();

    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;
    if (!isSuperAdminUser) {
      pushMessage('게시판 삭제는 Super_Admin만 가능합니다.', 'error');
      return;
    }

    if (!activeEditBoardId) {
      pushMessage('게시판을 먼저 선택하세요.', 'error');
      return;
    }

    const board = boardRows.find((row) => row.id === activeEditBoardId);
    const boardLabel = board?.name ? `${board.name} (${activeEditBoardId})` : activeEditBoardId;
    if (!window.confirm(`게시판 ${boardLabel}를 삭제할까요?\n게시글 데이터는 자동 삭제되지 않습니다.`)) return;

    await deleteDoc(doc(db, 'boards', activeEditBoardId));
    const nextItems = await refreshBoards();
    const nextRows = nextItems.filter((item) => !isDividerItem(item));

    if (!nextRows.length) {
      setBoardEditOpen(false);
    }

    pushMessage('게시판을 삭제했습니다.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    isSuperAdminUser,
    activeEditBoardId,
    boardRows,
    refreshBoards,
    pushMessage,
    showAppliedPopup
  ]);

  const addBoardDivider = useCallback(async () => {
    clearMessage();

    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    const input = window.prompt('구분선 이름을 입력하세요. (비워두면 기본값)');
    if (input === null) return;

    const label = normalizeText(input) || '구분선';
    const dividerId = `divider_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    await setDoc(doc(db, 'boards', dividerId), {
      isDivider: true,
      dividerLabel: label,
      sortOrder: nextBoardSortOrder,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || ''
    }, { merge: true });

    await refreshBoards(activeEditBoardId);
    pushMessage('구분선을 추가했습니다. 드래그해서 위치를 조정하세요.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    nextBoardSortOrder,
    currentUser,
    refreshBoards,
    activeEditBoardId,
    pushMessage,
    showAppliedPopup
  ]);

  const saveCreateRole = useCallback(async (event) => {
    event.preventDefault();
    clearMessage();

    if (!ensurePermission('canManageRoleDefinitions', 'Role 정의 수정 권한이 없습니다.')) return;

    const role = sanitizeRoleKey(createRoleForm.role);
    const labelKo = normalizeText(createRoleForm.labelKo);
    const level = Number(createRoleForm.level || 0);
    const badgeBgColor = normalizeBadgeColor(createRoleForm.badgeBgColor, '#ffffff');
    const badgeTextColor = normalizeBadgeColor(createRoleForm.badgeTextColor, '#334155');

    if (!role || !labelKo || !level) {
      pushMessage('Role key/표시명/level을 확인하세요.', 'error');
      return;
    }

    if (roleDefinitions.some((item) => item.role === role)) {
      pushMessage('이미 존재하는 Role key입니다.', 'error');
      return;
    }

    await setDoc(doc(db, 'role_definitions', role), {
      role,
      labelKo,
      level,
      badgeBgColor,
      badgeTextColor,
      adminDeleteLocked: isSuperAdminUser ? !!createRoleForm.adminDeleteLocked : false,
      ...createRoleForm.flags,
      ...legacyRoleVisibilityCleanup,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || ''
    }, { merge: true });

    setRoleCreateOpen(false);
    setRoleEditOpen(true);

    await refreshRoles(role);
    await refreshUsers();

    pushMessage(`Role ${role}을 생성했습니다.`, 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    createRoleForm,
    roleDefinitions,
    isSuperAdminUser,
    currentUser,
    refreshRoles,
    refreshUsers,
    pushMessage,
    showAppliedPopup
  ]);

  const saveEditRole = useCallback(async (event) => {
    event.preventDefault();
    clearMessage();

    if (!ensurePermission('canManageRoleDefinitions', 'Role 관리 권한이 없습니다.')) return;

    if (!activeEditRoleKey) {
      pushMessage('수정할 Role을 선택하세요.', 'error');
      return;
    }

    const roleDoc = roleDefinitions.find((item) => item.role === activeEditRoleKey);
    if (!roleDoc) {
      pushMessage('대상 Role을 찾을 수 없습니다.', 'error');
      return;
    }

    const labelKo = normalizeText(editRoleForm.labelKo);
    const level = Number(editRoleForm.level || 0);
    const badgeBgColor = normalizeBadgeColor(editRoleForm.badgeBgColor, '#ffffff');
    const badgeTextColor = normalizeBadgeColor(editRoleForm.badgeTextColor, '#334155');

    if (!labelKo || !level) {
      pushMessage('표시명/level을 확인하세요.', 'error');
      return;
    }

    const nextAdminDeleteLocked = isSuperAdminUser
      ? !!editRoleForm.adminDeleteLocked
      : roleDeleteLockedForAdmin(roleDoc);

    await setDoc(doc(db, 'role_definitions', activeEditRoleKey), {
      role: activeEditRoleKey,
      labelKo,
      level,
      badgeBgColor,
      badgeTextColor,
      adminDeleteLocked: nextAdminDeleteLocked,
      ...editRoleForm.flags,
      ...legacyRoleVisibilityCleanup,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || ''
    }, { merge: true });

    await refreshRoles(activeEditRoleKey);
    await refreshUsers();

    pushMessage('Role을 저장했습니다.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    activeEditRoleKey,
    roleDefinitions,
    editRoleForm,
    isSuperAdminUser,
    currentUser,
    refreshRoles,
    refreshUsers,
    pushMessage,
    showAppliedPopup
  ]);

  const removeRole = useCallback(async () => {
    clearMessage();

    if (!ensurePermission('canManageRoleDefinitions', 'Role 관리 권한이 없습니다.')) return;

    if (!activeEditRoleKey) {
      pushMessage('삭제할 Role을 선택하세요.', 'error');
      return;
    }

    if (isCoreRole(activeEditRoleKey)) {
      pushMessage('기본 Role은 삭제할 수 없습니다.', 'error');
      return;
    }

    const roleDoc = roleDefinitions.find((item) => item.role === activeEditRoleKey);
    if (roleDeleteLockedForAdmin(roleDoc) && !isSuperAdminUser) {
      pushMessage('이 Role은 Super_Admin만 삭제할 수 있습니다.', 'error');
      return;
    }

    if (!permissions?.canManageRoles) {
      pushMessage('Role 삭제에는 회원 등급 변경 권한이 필요합니다.', 'error');
      return;
    }

    if (!window.confirm(`${activeEditRoleKey} Role을 삭제할까요?\n해당 회원들은 Newbie로 변경됩니다.`)) return;

    const assignedUsersSnap = await getDocs(query(
      collection(db, 'users'),
      where('role', '==', activeEditRoleKey)
    ));

    for (const userDoc of assignedUsersSnap.docs) {
      await updateDoc(doc(db, 'users', userDoc.id), {
        role: 'Newbie',
        updatedAt: serverTimestamp()
      });
    }

    await deleteDoc(doc(db, 'role_definitions', activeEditRoleKey));

    await refreshRoles();
    await refreshUsers();

    pushMessage(`Role을 삭제했습니다. ${assignedUsersSnap.size}명의 회원을 Newbie로 변경했습니다.`, 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    activeEditRoleKey,
    roleDefinitions,
    isSuperAdminUser,
    permissions,
    refreshRoles,
    refreshUsers,
    pushMessage,
    showAppliedPopup
  ]);

  const seedCoreRoles = useCallback(async () => {
    clearMessage();

    if (!isSuperAdminUser) {
      pushMessage('기본 Role 적용은 Super_Admin만 가능합니다.', 'error');
      return;
    }

    if (!ensurePermission('canManageRoleDefinitions', 'Role 초기화 권한이 없습니다.')) return;

    for (const role of coreRoleDefaults) {
      await setDoc(doc(db, 'role_definitions', role.role), {
        ...role,
        ...legacyRoleVisibilityCleanup,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || ''
      }, { merge: true });
    }

    await refreshRoles();
    await refreshUsers();

    pushMessage('기본 Role 정의를 반영했습니다.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    isSuperAdminUser,
    ensurePermission,
    currentUser,
    refreshRoles,
    refreshUsers,
    pushMessage,
    showAppliedPopup
  ]);

  const saveUserRole = useCallback(async (userRow) => {
    clearMessage();

    if (!ensurePermission('canManageRoles', '회원 등급 변경 권한이 없습니다.')) return;

    const uid = userRow.uid;
    const originalRole = normalizeText(userRow.role) || 'Newbie';

    if (uid === currentUser?.uid) {
      pushMessage('본인 계정은 변경할 수 없습니다.', 'error');
      return;
    }

    const draft = userDrafts[uid] || {
      role: originalRole
    };

    const selectedRole = normalizeText(draft.role) || originalRole;

    if (roleLevelOf(originalRole) >= myRoleLevel) {
      pushMessage('동급/상위 등급은 변경할 수 없습니다.', 'error');
      return;
    }

    if (roleLevelOf(selectedRole) >= myRoleLevel) {
      pushMessage('자신보다 낮은 등급만 지정할 수 있습니다.', 'error');
      return;
    }

    const payload = {
      updatedAt: serverTimestamp()
    };

    if (selectedRole !== originalRole) payload.role = selectedRole;

    if (Object.keys(payload).length === 1) {
      pushMessage('변경 사항이 없습니다.', 'notice');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', uid), payload);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestMyDocExists = false;
        let latestTargetDocExists = false;
        let latestMyRole = '-';
        let latestMyRawRole = '-';
        let latestMyRawRoleHex = '-';
        let latestTargetRole = '-';
        let latestTargetRawRole = '-';
        let latestTargetRawRoleHex = '-';
        let latestTargetLower = '-';
        let latestSelectedLower = '-';

        try {
          const [latestMySnap, latestTargetSnap] = await Promise.all([
            getDoc(doc(db, 'users', currentUser?.uid || '')),
            getDoc(doc(db, 'users', uid))
          ]);

          latestMyDocExists = !!latestMySnap?.exists?.() && latestMySnap.exists();
          latestTargetDocExists = !!latestTargetSnap?.exists?.() && latestTargetSnap.exists();

          const latestMyData = latestMyDocExists ? (latestMySnap.data() || {}) : {};
          const latestTargetData = latestTargetDocExists ? (latestTargetSnap.data() || {}) : {};

          const latestMyRawRoleExact = String(latestMyData.role ?? '');
          const latestTargetRawRoleExact = String(latestTargetData.role ?? '');
          latestMyRawRole = normalizeText(latestMyRawRoleExact) || '-';
          latestTargetRawRole = normalizeText(latestTargetRawRoleExact) || '-';
          latestMyRawRoleHex = debugCodePoints(latestMyRawRoleExact);
          latestTargetRawRoleHex = debugCodePoints(latestTargetRawRoleExact);

          latestMyRole = normalizeRoleKey(latestMyRawRole, roleDefMap) || '-';
          latestTargetRole = normalizeRoleKey(latestTargetRawRole, roleDefMap) || '-';

          const latestMyLevel = roleLevelWithDefinitions(latestMyRole, roleDefinitions);
          const latestTargetLevel = roleLevelWithDefinitions(latestTargetRole, roleDefinitions);
          const latestSelectedLevel = roleLevelWithDefinitions(selectedRole, roleDefinitions);

          latestTargetLower = latestMyLevel > latestTargetLevel ? 'Y' : 'N';
          latestSelectedLower = latestMyLevel > latestSelectedLevel ? 'Y' : 'N';
        } catch (_) {
          // keep original permission error; debug read is best-effort only
        }

        const myRawRoleExact = String(currentUserProfile?.rawRole || currentUserProfile?.role || '');
        const myRawRole = normalizeText(myRawRoleExact) || '-';
        const myRole = normalizeRoleKey(myRawRole, roleDefMap) || '-';

        const debugText = joinDebugParts([
          'action=user-role-update',
          'errorStage=user-updateDoc',
          `targetUid=${normalizeText(uid) || '-'}`,
          `myUid=${normalizeText(currentUser?.uid) || '-'}`,
          `originalRole=${normalizeText(originalRole) || '-'}`,
          `selectedRole=${normalizeText(selectedRole) || '-'}`,
          `payloadKeys=${debugValueList(Object.keys(payload))}`,
          `localCanManageRoles=${permissions?.canManageRoles ? 'Y' : 'N'}`,
          `localMyRole=${myRole}`,
          `localMyRawRole=${myRawRole}`,
          `localMyRawRoleHex=${debugCodePoints(myRawRoleExact)}`,
          `localMyLevel=${String(myRoleLevel)}`,
          `localTargetLevel=${String(roleLevelOf(originalRole))}`,
          `localSelectedLevel=${String(roleLevelOf(selectedRole))}`,
          `localTargetLower=${roleLevelOf(originalRole) < myRoleLevel ? 'Y' : 'N'}`,
          `localSelectedLower=${roleLevelOf(selectedRole) < myRoleLevel ? 'Y' : 'N'}`,
          `latestMyDoc=${latestMyDocExists ? 'exists' : 'missing'}`,
          `latestMyRole=${latestMyRole}`,
          `latestMyRawRole=${latestMyRawRole}`,
          `latestMyRawRoleHex=${latestMyRawRoleHex}`,
          `latestTargetDoc=${latestTargetDocExists ? 'exists' : 'missing'}`,
          `latestTargetRole=${latestTargetRole}`,
          `latestTargetRawRole=${latestTargetRawRole}`,
          `latestTargetRawRoleHex=${latestTargetRawRoleHex}`,
          `latestTargetLower=${latestTargetLower}`,
          `latestSelectedLower=${latestSelectedLower}`,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);

        if (shouldLogDebugPayload()) {
          console.error('[user-role-update-permission-debug]', {
            error: err,
            targetUid: uid,
            myUid: currentUser?.uid || '',
            originalRole,
            selectedRole,
            payloadKeys: Object.keys(payload),
            localCanManageRoles: !!permissions?.canManageRoles,
            localMyRole: myRole,
            localMyRawRole: myRawRole,
            localMyRawRoleHex: debugCodePoints(myRawRoleExact),
            localMyLevel: myRoleLevel,
            localTargetLevel: roleLevelOf(originalRole),
            localSelectedLevel: roleLevelOf(selectedRole),
            localTargetLower: roleLevelOf(originalRole) < myRoleLevel,
            localSelectedLower: roleLevelOf(selectedRole) < myRoleLevel,
            latestMyDocExists,
            latestMyRole,
            latestMyRawRole,
            latestMyRawRoleHex,
            latestTargetDocExists,
            latestTargetRole,
            latestTargetRawRole,
            latestTargetRawRoleHex,
            latestTargetLower,
            latestSelectedLower
          });
        } else {
          console.error('[user-role-update-permission-debug]', err);
        }

        pushMessage('권한 오류입니다. 현재 등급에서 허용되지 않은 작업입니다.', 'error');
        return;
      }
      throw err;
    }

    await refreshUsers();
    pushMessage('회원 권한을 변경했습니다.', 'notice');
    showAppliedPopup();
  }, [
    clearMessage,
    ensurePermission,
    currentUser,
    currentUserProfile,
    userDrafts,
    roleDefMap,
    roleDefinitions,
    permissions,
    roleLevelOf,
    myRoleLevel,
    refreshUsers,
    pushMessage,
    showAppliedPopup
  ]);

  const createVenueOption = useCallback(async (event) => {
    event.preventDefault();
    clearMessage();

    if (!ensurePermission('canManageBoards', '체험관 관리 권한이 없습니다.')) return;

    const label = normalizeVenueLabel(newVenueLabel);
    if (!label) {
      pushMessage('체험관 이름을 입력하세요.', 'error');
      return;
    }

    const duplicated = venueOptions.some((item) => normalizeVenueLabel(item?.label).toLowerCase() === label.toLowerCase());
    if (duplicated) {
      pushMessage('이미 등록된 체험관 이름입니다.', 'error');
      return;
    }

    const maxSort = venueOptions.reduce((acc, item) => {
      const value = Number(item?.sortOrder);
      return Number.isFinite(value) ? Math.max(acc, value) : acc;
    }, 0);

    setCreatingVenue(true);
    try {
      await addDoc(collection(db, 'venue_options'), {
        label,
        sortOrder: maxSort + 10,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || ''
      });
      setNewVenueLabel('');
      await refreshVenueOptions();
      pushMessage(`체험관 "${label}"을 추가했습니다.`, 'notice');
      showAppliedPopup();
    } finally {
      setCreatingVenue(false);
    }
  }, [
    clearMessage,
    currentUser?.uid,
    ensurePermission,
    newVenueLabel,
    pushMessage,
    refreshVenueOptions,
    showAppliedPopup,
    venueOptions
  ]);

  const saveVenueOption = useCallback(async (venueId) => {
    clearMessage();
    if (!ensurePermission('canManageBoards', '체험관 관리 권한이 없습니다.')) return;

    const targetId = normalizeText(venueId);
    const row = venueOptions.find((item) => item.id === targetId);
    const label = normalizeVenueLabel(venueDrafts[targetId]?.label);
    if (!targetId || !row) return;
    if (!label) {
      pushMessage('체험관 이름을 입력하세요.', 'error');
      return;
    }

    const duplicated = venueOptions.some((item) => item.id !== targetId && normalizeVenueLabel(item?.label).toLowerCase() === label.toLowerCase());
    if (duplicated) {
      pushMessage('이미 등록된 체험관 이름입니다.', 'error');
      return;
    }

    setSavingVenueId(targetId);
    try {
      await setDoc(doc(db, 'venue_options', targetId), {
        label,
        sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || ''
      }, { merge: true });
      await refreshVenueOptions();
      pushMessage(`체험관 "${label}"을 저장했습니다.`, 'notice');
      showAppliedPopup();
    } finally {
      setSavingVenueId('');
    }
  }, [
    clearMessage,
    currentUser?.uid,
    ensurePermission,
    pushMessage,
    refreshVenueOptions,
    showAppliedPopup,
    venueDrafts,
    venueOptions
  ]);

  const deleteVenueOption = useCallback(async (venueId) => {
    clearMessage();
    if (!ensurePermission('canManageBoards', '체험관 관리 권한이 없습니다.')) return;

    const targetId = normalizeText(venueId);
    const row = venueOptions.find((item) => item.id === targetId);
    if (!targetId || !row) return;
    if (!window.confirm(`체험관 "${row.label}"을 삭제할까요?`)) return;

    setDeletingVenueId(targetId);
    try {
      await deleteDoc(doc(db, 'venue_options', targetId));
      await refreshVenueOptions();
      pushMessage(`체험관 "${row.label}"을 삭제했습니다.`, 'notice');
      showAppliedPopup();
    } finally {
      setDeletingVenueId('');
    }
  }, [
    clearMessage,
    ensurePermission,
    pushMessage,
    refreshVenueOptions,
    showAppliedPopup,
    venueOptions
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const wideMedia = window.matchMedia('(min-width: 901px)');
    const hoverMedia = window.matchMedia('(hover: hover)');
    const pointerMedia = window.matchMedia('(pointer: fine)');

    const syncMode = () => setCompactListMode(detectCompactListMode());
    syncMode();

    if (
      typeof wideMedia.addEventListener === 'function'
      && typeof hoverMedia.addEventListener === 'function'
      && typeof pointerMedia.addEventListener === 'function'
    ) {
      wideMedia.addEventListener('change', syncMode);
      hoverMedia.addEventListener('change', syncMode);
      pointerMedia.addEventListener('change', syncMode);
      return () => {
        wideMedia.removeEventListener('change', syncMode);
        hoverMedia.removeEventListener('change', syncMode);
        pointerMedia.removeEventListener('change', syncMode);
      };
    }

    wideMedia.addListener(syncMode);
    hoverMedia.addListener(syncMode);
    pointerMedia.addListener(syncMode);
    return () => {
      wideMedia.removeListener(syncMode);
      hoverMedia.removeListener(syncMode);
      pointerMedia.removeListener(syncMode);
    };
  }, []);

  const canManageBoards = !!permissions?.canManageBoards;
  const canManageRoleDefinitions = !!permissions?.canManageRoleDefinitions;
  const canManageRoles = !!permissions?.canManageRoles;

  const adminNickname = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUser?.email || '관리자')
    : '관리자';

  const adminRoleText = currentUserProfile ? roleDisplay(currentUserProfile.role) : '-';

  const createRoleBadgePalette = useMemo(() => {
    const roleKey = sanitizeRoleKey(createRoleForm.role) || 'Newbie';
    return getRoleBadgePalette(roleKey, {
      badgeBgColor: normalizeBadgeColor(createRoleForm.badgeBgColor, '#ffffff'),
      badgeTextColor: normalizeBadgeColor(createRoleForm.badgeTextColor, '#334155')
    });
  }, [createRoleForm.role, createRoleForm.badgeBgColor, createRoleForm.badgeTextColor]);

  const editRoleBadgePalette = useMemo(() => {
    const roleKey = sanitizeRoleKey(editRoleForm.role) || 'Role';
    return getRoleBadgePalette(roleKey, {
      badgeBgColor: normalizeBadgeColor(editRoleForm.badgeBgColor, '#ffffff'),
      badgeTextColor: normalizeBadgeColor(editRoleForm.badgeTextColor, '#334155')
    });
  }, [editRoleForm.role, editRoleForm.badgeBgColor, editRoleForm.badgeTextColor]);

  const editRoleDoc = roleDefinitions.find((item) => item.role === activeEditRoleKey) || null;
  const editRoleDeleteDisabled = !canManageRoleDefinitions
    || !activeEditRoleKey
    || isCoreRole(activeEditRoleKey)
    || (roleDeleteLockedForAdmin(editRoleDoc) && !isSuperAdminUser);

  const sortedRoleOptionsForSelect = sortedRoles.map((roleDoc) => ({
    value: roleDoc.role,
    label: roleDisplay(roleDoc.role)
  }));

  const boardCount = boardRows.length;
  const venueCount = venueOptions.length;
  const excelBoardRows = useMemo(() => {
    return boardRows.map((row) => ({
      id: row.id,
      name: row.name || row.id,
      description: row.description || '-',
      allowedRolesText: Array.isArray(row.allowedRoles) ? row.allowedRoles.join(', ') : '-'
    }));
  }, [boardRows]);

  const excelVenueRows = useMemo(() => {
    return venueOptions.map((row) => ({
      id: row.id,
      label: row.label || '-'
    }));
  }, [venueOptions]);

  const excelRoleRows = useMemo(() => {
    return sortedRoles.map((roleDoc) => ({
      role: roleDoc.role,
      labelKo: roleDoc.labelKo || '-',
      level: roleLevelWithDefinitions(roleDoc.role, roleDefinitions),
      summary: roleSummaryText(roleDoc) || '-'
    }));
  }, [roleDefinitions, sortedRoles]);

  const excelUserRows = useMemo(() => {
    return filteredUsers.map((userRow) => {
      const currentRole = normalizeText(userRow.role) || 'Newbie';
      const draft = userDrafts[userRow.uid] || { role: currentRole };
      const state = evaluateUserManageState(userRow.uid, currentRole, draft.role);
      const roleChanged = normalizeText(draft.role) !== currentRole;
      const canSave = state.type === 'ok' && roleChanged;
      return {
        uid: userRow.uid,
        email: userRow.email || '-',
        name: userRow.realName || userRow.nickname || '-',
        currentRole,
        draftRole: draft.role,
        state: canSave ? state.label : (roleChanged ? state.label : '변경 없음'),
        locked: state.type === 'lock',
        canSave
      };
    });
  }, [filteredUsers, userDrafts, evaluateUserManageState]);

  const excelSheetModel = useMemo(() => {
    return buildAdminExcelSheetModel({
      adminNickname,
      adminRoleText,
      boardRows: excelBoardRows,
      venueRows: excelVenueRows,
      roleRows: excelRoleRows,
      userRows: excelUserRows
    });
  }, [adminNickname, adminRoleText, excelBoardRows, excelRoleRows, excelUserRows, excelVenueRows]);

  const isExcelDesktopMode = isExcel && !compactListMode;
  const [excelActiveCellLabel, setExcelActiveCellLabel] = useState('');
  const [excelFormulaText, setExcelFormulaText] = useState('=');
  const handleExcelSelectCell = useCallback((payload) => {
    const label = normalizeText(payload?.label);
    const text = String(payload?.text ?? '').trim();
    setExcelActiveCellLabel(label || '');
    setExcelFormulaText(text || '=');
  }, []);

  const handleExcelAction = useCallback((actionType, payload) => {
    if (actionType === 'refreshBoards') {
      refreshBoards().catch((err) => pushMessage(err?.message || '새로고침 실패', 'error'));
      return;
    }
    if (actionType === 'openBoardEdit') {
      openBoardEditModal();
      return;
    }
    if (actionType === 'openBoardCreate') {
      openBoardCreateModal();
      return;
    }
    if (actionType === 'refreshVenues') {
      refreshVenueOptions().catch((err) => pushMessage(err?.message || '체험관 새로고침 실패', 'error'));
      return;
    }
    if (actionType === 'openRoleEdit') {
      openRoleEditModal();
      return;
    }
    if (actionType === 'openRoleCreate') {
      openRoleCreateModal();
      return;
    }
    if (actionType === 'refreshUsers') {
      refreshUsers().catch((err) => pushMessage(err?.message || '회원 목록 새로고침 실패', 'error'));
      return;
    }
    if (actionType === 'syncNicknameIndex') {
      backfillNicknameIndex().catch((err) => pushMessage(err?.message || '닉네임 인덱스 동기화 실패', 'error'));
      return;
    }
    if (actionType === 'cycleUserRole') {
      const uid = payload?.uid;
      if (!uid) return;
      const options = sortedRoleOptionsForSelect.map((o) => o.value);
      if (!options.length) return;
      setUserDrafts((prev) => {
        const current = prev[uid]?.role || filteredUsers.find((u) => u.uid === uid)?.role || 'Newbie';
        const currentIdx = options.indexOf(normalizeText(current));
        const nextIdx = (currentIdx + 1) % options.length;
        return { ...prev, [uid]: { role: options[nextIdx] } };
      });
      return;
    }
    if (actionType === 'saveUserRoleExcel') {
      const uid = payload?.uid;
      if (!uid) return;
      const userRow = filteredUsers.find((u) => u.uid === uid);
      if (!userRow) return;
      saveUserRole(userRow).catch((err) => pushMessage(err?.message || '회원 권한 변경 실패', 'error'));
    }
  }, [
    backfillNicknameIndex,
    filteredUsers,
    openBoardCreateModal,
    openBoardEditModal,
    openRoleCreateModal,
    openRoleEditModal,
    pushMessage,
    refreshBoards,
    refreshUsers,
    refreshVenueOptions,
    saveUserRole,
    sortedRoleOptionsForSelect
  ]);

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${boardCount}개`}
          activeCellLabel={isExcelDesktopMode ? excelActiveCellLabel : ''}
          formulaText={isExcelDesktopMode ? excelFormulaText : '='}
          showHeaders
          rowCount={EXCEL_STANDARD_ROW_COUNT}
          colCount={EXCEL_STANDARD_COL_COUNT}
          compact={compactListMode}
        />
      ) : null}
      <motion.main
        className={isExcel ? 'page stack admin-shell excel-chrome-offset' : 'page stack admin-shell'}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        {isExcelDesktopMode ? (
          <AppExcelWorkbook
            sheetRows={excelSheetModel.rowData}
            rowCount={excelSheetModel.rowCount}
            colCount={excelSheetModel.colCount}
            onSelectCell={handleExcelSelectCell}
            onMoveHome={() => navigate(MENTOR_FORUM_CONFIG.app.appPage)}
            onToggleTheme={toggleTheme}
            onLogout={() => handleLogout().catch(() => {})}
            onAction={handleExcelAction}
          />
        ) : null}
        <div className={isExcelDesktopMode ? 'hidden' : ''}>
        <section className="card admin-hero">
          <div className="row space-between mobile-col">
            <div>
              <p className="hero-kicker"><ShieldCheck size={15} /> Operations Center</p>
              <h1>관리자 사이트</h1>
              <p className="muted hero-copy" style={{ marginTop: '6px' }}>Admin / Super_Admin 권한 관리 화면</p>
            </div>
            <div className="row top-action-row">
              <ThemeToggle />
            </div>
          </div>

          <div id="message" className={message.text ? (message.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '12px' }}>
            {message.text}
          </div>
        </section>

        <section className="admin-content-shell">
          <aside className="admin-side-rail" aria-label="관리자 내 정보">
            <section className="admin-side-profile">
              <p className="admin-side-kicker">내 정보</p>
              <div className="admin-side-user">
                <p className="author-name">{adminNickname}</p>
                <p className="meta admin-side-role">{adminRoleText}</p>
              </div>

              {sessionRemainingMs != null ? (
                <div className="admin-side-session">
                  <span className="session-ttl-label">
                    자동 로그아웃까지 <strong className="session-ttl-time">{formatTemporaryLoginRemaining(sessionRemainingMs)}</strong>
                  </span>
                  <button type="button" className="session-extend-btn" onClick={handleExtendSession}>연장</button>
                </div>
              ) : null}

              <div className="admin-side-actions">
                <button className="board-rail-profile-btn" type="button" onClick={() => navigate(MENTOR_FORUM_CONFIG.app.appPage)}>
                  <MessageSquare size={14} />
                  포럼으로
                </button>
                <button id="logoutBtn" className="board-rail-profile-btn is-logout" type="button" onClick={() => handleLogout().catch(() => {})}>
                  <LogOut size={14} />
                  로그아웃
                </button>
              </div>
            </section>
          </aside>

          <div className="admin-main-column">
            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><LayoutPanelTop size={18} /> 게시판 관리</h2>
            <div className="row mobile-wrap">
              <span id="boardCountBadge" className="badge">{boardCount}개</span>
              <button id="refreshBoardsBtn" className="btn-muted" type="button" onClick={() => refreshBoards().then(() => pushMessage('게시판 목록을 새로고침했습니다.', 'notice')).catch((err) => pushMessage(err?.message || '새로고침 실패', 'error'))}>
                새로고침
              </button>
              <button id="openBoardEditModalBtn" className="btn-primary" type="button" onClick={openBoardEditModal} disabled={!canManageBoards}>
                게시판 수정
              </button>
              <button id="openBoardCreateModalBtn" className="btn-primary" type="button" onClick={openBoardCreateModal} disabled={!canManageBoards}>
                게시판 생성
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>목록에서 확인하고 모달에서 수정/생성합니다.</p>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-board-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>이름</th>
                  <th>설명</th>
                  <th>허용 등급</th>
                </tr>
              </thead>
              <tbody id="boardTableBody">
                {!boardRows.length ? (
                  <tr>
                    <td colSpan={4} className="muted">게시판이 없습니다.</td>
                  </tr>
                ) : boardRows.map((row) => (
                  <tr key={row.id}>
                    <td><span className="text-ellipsis-1" title={row.id}>{row.id}</span></td>
                    <td><span className="text-ellipsis-1" title={row.name || '-'}>{row.name || '-'}</span></td>
                    <td><span className="text-ellipsis-2 break-anywhere" title={row.description || '-'}>{row.description || '-'}</span></td>
                    <td>
                        <span className="break-anywhere" title={Array.isArray(row.allowedRoles) ? row.allowedRoles.join(', ') : '-'}>
                          {Array.isArray(row.allowedRoles) ? row.allowedRoles.join(', ') : '-'}
                        </span>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><MapPin size={18} /> 체험관</h2>
            <div className="row mobile-wrap">
              <span className="badge">{venueCount}개</span>
              <button
                id="refreshVenuesBtn"
                className="btn-muted"
                type="button"
                onClick={() => refreshVenueOptions().then(() => pushMessage('체험관을 새로고침했습니다.', 'notice')).catch((err) => pushMessage(err?.message || '체험관 새로고침 실패', 'error'))}
              >
                새로고침
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>
            대체근무 작성 폼의 체험관 드롭다운에 표시되는 항목입니다. "직접작성"은 자동으로 함께 제공됩니다.
          </p>

          <form className="row admin-venue-create-row" style={{ marginTop: '10px' }} onSubmit={createVenueOption}>
            <input
              type="text"
              className="admin-venue-create-input"
              placeholder="예: 구로, 경기도서관"
              value={newVenueLabel}
              maxLength={30}
              onChange={(event) => setNewVenueLabel(event.target.value)}
              disabled={!canManageBoards || creatingVenue}
            />
            <button
              type="submit"
              className="btn-primary admin-venue-create-btn"
              disabled={!canManageBoards || creatingVenue}
            >
              {creatingVenue ? '추가 중...' : '체험관 추가'}
            </button>
          </form>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-board-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>번호</th>
                  <th>체험관 이름</th>
                  <th style={{ width: '220px' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {!venueOptions.length ? (
                  <tr>
                    <td colSpan={3} className="muted">등록된 체험관이 없습니다.</td>
                  </tr>
                ) : venueOptions.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        type="text"
                        maxLength={30}
                        value={venueDrafts[row.id]?.label || ''}
                        disabled={!canManageBoards}
                        onChange={(event) => {
                          const nextLabel = event.target.value;
                          setVenueDrafts((prev) => ({
                            ...prev,
                            [row.id]: { label: nextLabel }
                          }));
                        }}
                      />
                    </td>
                    <td>
                      <div className="row mobile-wrap">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!canManageBoards || savingVenueId === row.id}
                          onClick={() => saveVenueOption(row.id).catch((err) => pushMessage(err?.message || '체험관 저장 실패', 'error'))}
                        >
                          {savingVenueId === row.id ? '저장 중...' : '저장'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={!canManageBoards || deletingVenueId === row.id}
                          onClick={() => deleteVenueOption(row.id).catch((err) => pushMessage(err?.message || '체험관 삭제 실패', 'error'))}
                        >
                          {deletingVenueId === row.id ? '삭제 중...' : '삭제'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><ShieldPlus size={18} /> 등급(Role) 정의</h2>
            <div className="row mobile-wrap">
              <button id="openRoleEditModalBtn" className="btn-primary" type="button" onClick={openRoleEditModal} disabled={!canManageRoleDefinitions}>
                등급 수정
              </button>
              <button id="openRoleCreateModalBtn" className="btn-primary" type="button" onClick={openRoleCreateModal} disabled={!canManageRoleDefinitions}>
                등급 생성
              </button>
              <button
                id="seedRolesBtn"
                type="button"
                className={isSuperAdminUser ? 'btn-muted' : 'btn-muted hidden'}
                onClick={() => seedCoreRoles().catch((err) => pushMessage(err?.message || '기본 Role 적용 실패', 'error'))}
                disabled={!isSuperAdminUser}
              >
                기본 Role 적용
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>기본 등급(Newbie, Mentor, Admin, Super_Admin)은 삭제할 수 없습니다.</p>
          <p className="meta" style={{ marginTop: '4px' }}>게시판 읽기/쓰기/댓글 가능 여부는 게시판 허용 등급(allowedRoles) 기준으로 동작합니다.</p>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-role-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>표시명</th>
                  <th>Level</th>
                  <th>배지</th>
                  <th>삭제 잠금</th>
                  <th>권한 요약</th>
                </tr>
              </thead>
              <tbody id="roleTableBody">
                {!sortedRoles.length ? (
                  <tr>
                    <td colSpan={6} className="muted">Role 정의가 없습니다.</td>
                  </tr>
                ) : sortedRoles.map((roleDoc) => {
                  const level = roleLevelWithDefinitions(roleDoc.role, roleDefinitions);
                  const lockText = isCoreRole(roleDoc.role)
                    ? '기본'
                    : roleDeleteLockedForAdmin(roleDoc)
                      ? 'Admin 삭제 불가'
                      : '해제';

                  return (
                    <tr key={roleDoc.role}>
                      <td><span className="text-ellipsis-1" title={roleDoc.role}>{roleDoc.role}</span></td>
                      <td><span className="text-ellipsis-1" title={roleDoc.labelKo || '-'}>{roleDoc.labelKo || '-'}</span></td>
                      <td>{level || '-'}</td>
                      <td><RoleBadge role={roleDoc.role} roleDefinition={roleDoc} /></td>
                      <td>{lockText}</td>
                      <td>
                        <span className="break-anywhere" title={roleSummaryText(roleDoc) || '-'}>
                          {roleSummaryText(roleDoc) || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <div>
              <h2 className="section-title"><UsersRound size={18} /> 회원 등급 변경</h2>
              <p className="meta" style={{ marginTop: '6px' }}>본인/동급/상위 등급은 변경할 수 없습니다.</p>
            </div>
            <div className="row mobile-wrap user-search-row">
              <input
                id="userSearchInput"
                className="admin-user-search-input"
                type="search"
                placeholder="이메일 또는 이름 검색"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
              <button id="refreshUsersBtn" className="btn-muted" type="button" onClick={() => refreshUsers().catch((err) => pushMessage(err?.message || '회원 목록 새로고침 실패', 'error'))}>
                새로고침
              </button>
              <button
                id="syncNicknameIndexBtn"
                className="btn-muted"
                type="button"
                onClick={() => backfillNicknameIndex().catch((err) => pushMessage(err?.message || '닉네임 인덱스 동기화 실패', 'error'))}
                disabled={syncingNicknameIndex || !canManageRoles}
              >
                {syncingNicknameIndex ? '동기화 중...' : '닉네임 인덱스 동기화'}
              </button>
            </div>
          </div>

          <div className="table-wrap user-role-table-wrap" style={{ marginTop: '10px' }}>
            <table className="table user-role-table">
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>이름</th>
                  <th>현재 등급</th>
                  <th>변경 등급</th>
                  <th>상태</th>
                  <th>적용</th>
                </tr>
              </thead>
              <tbody id="userTableBody">
                {!filteredUsers.length ? (
                  <tr>
                    <td colSpan={6} className="muted">검색 결과가 없습니다.</td>
                  </tr>
                ) : filteredUsers.map((userRow) => {
                  const currentRole = normalizeText(userRow.role) || 'Newbie';
                  const draft = userDrafts[userRow.uid] || {
                    role: currentRole
                  };

                  const baseState = evaluateUserManageState(userRow.uid, currentRole, draft.role);
                  const roleChanged = normalizeText(draft.role) !== currentRole;

                  let finalState = baseState;
                  if (baseState.type === 'ok' && !roleChanged) {
                    finalState = buildManageState('warn', '변경 없음');
                  }

                  const canEditRole = baseState.type !== 'lock';
                  const canSave = finalState.type === 'ok';

                  return (
                    <tr key={userRow.uid} data-user-id={userRow.uid}>
                      <td>
                        <span className="text-ellipsis-2 break-anywhere" title={userRow.email || '-'}>
                          {userRow.email || '-'}
                        </span>
                      </td>
                      <td>
                        <div className="user-name-cell">
                          <strong className="text-ellipsis-1" title={userRow.realName || '-'}>{userRow.realName || '-'}</strong>
                          <span className="meta text-ellipsis-1" title={userRow.nickname ? `@${userRow.nickname}` : '-'}>{userRow.nickname ? `@${userRow.nickname}` : '-'}</span>
                        </div>
                      </td>
                      <td><RoleBadge role={currentRole} roleDefinition={roleDefMap.get(currentRole) || null} /></td>
                      <td>
                        <Select
                          value={draft.role}
                          disabled={!canEditRole}
                          onValueChange={(value) => {
                            const nextValue = normalizeText(value) || 'Newbie';
                            setUserDrafts((prev) => ({
                              ...prev,
                              [userRow.uid]: {
                                role: nextValue
                              }
                            }));
                          }}
                        >
                          <SelectTrigger className="user-role-select">
                            <SelectValue placeholder="등급 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedRoleOptionsForSelect.map((option) => (
                              <SelectItem key={`${userRow.uid}-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        <span data-manage-state className={`user-state-badge ${finalState.className}`}>{finalState.label}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          data-action="save-user-role"
                          className="btn-primary"
                          disabled={!canSave || !canManageRoles}
                          onClick={() => saveUserRole(userRow).catch((err) => pushMessage(err?.message || '회원 권한 변경 실패', 'error'))}
                        >
                          적용
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </section>
          </div>
        </section>
        </div>
      </motion.main>

      <AdminModal
        modalId="boardEditModal"
        open={boardEditOpen}
        onClose={() => closeModalById('boardEditModal')}
        panelClassName="admin-modal-panel board-edit-modal-panel"
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>게시판 수정</h3>
              <p className="meta" style={{ marginTop: '6px' }}>게시판을 선택하고 이름/설명/허용 등급을 수정합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="boardEditModal"
              onClick={() => closeModalById('boardEditModal')}
            >
              닫기
            </button>
          </div>

          <div className="grid grid-2 board-edit-layout" style={{ marginTop: '12px' }}>
            <div className="board-edit-list-wrap">
              <div className="row space-between board-edit-toolbar">
                <p className="meta" style={{ margin: 0 }}>게시판 목록 (드래그 순서 변경)</p>
                <button id="addBoardDividerBtn" type="button" onClick={() => addBoardDivider().catch((err) => pushMessage(err?.message || '구분선 추가 실패', 'error'))} disabled={!canManageBoards}>
                  구분선 추가
                </button>
              </div>

              <div id="boardEditList" className="board-edit-list">
                {!boardItems.length ? (
                  <p className="muted" style={{ margin: 0 }}>게시판/구분선이 없습니다.</p>
                ) : boardItems.map((item) => {
                  const activeClass = item.id === activeEditBoardId ? ' active' : '';
                  const draggable = canManageBoards;

                  if (isDividerItem(item)) {
                    return (
                      <div
                        key={item.id}
                        className="board-edit-item board-divider-item"
                        data-item-id={item.id}
                        draggable={draggable}
                        onDragStart={(event) => {
                          if (!canManageBoards) return;
                          draggingBoardItemIdRef.current = item.id;
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', item.id);
                          }
                        }}
                        onDragOver={(event) => {
                          if (!canManageBoards) return;
                          const draggingId = draggingBoardItemIdRef.current;
                          if (!draggingId || draggingId === item.id) return;
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          if (!canManageBoards) return;
                          event.preventDefault();
                          const draggingId = draggingBoardItemIdRef.current;
                          draggingBoardItemIdRef.current = '';
                          if (!draggingId || draggingId === item.id) return;
                          reorderBoardItems(draggingId, item.id).catch((err) => pushMessage(err?.message || '정렬 반영 실패', 'error'));
                        }}
                        onDragEnd={() => {
                          draggingBoardItemIdRef.current = '';
                        }}
                      >
                        <div className="board-divider-view">
                          <span className="board-divider-line" />
                          <strong>{dividerLabel(item)}</strong>
                          <span className="meta board-divider-tag">구분선</span>
                        </div>
                        {canManageBoards ? (
                          <button
                            type="button"
                            className="board-divider-delete"
                            data-action="delete-divider"
                            onClick={async (event) => {
                              event.stopPropagation();
                              clearMessage();
                              if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;
                              if (!window.confirm(`구분선 "${dividerLabel(item)}"을 삭제할까요?`)) return;

                              await deleteDoc(doc(db, 'boards', item.id));
                              await refreshBoards(activeEditBoardId);
                              pushMessage('구분선을 삭제했습니다.', 'notice');
                              showAppliedPopup();
                            }}
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`board-edit-item${activeClass}`}
                      data-item-id={item.id}
                      draggable={draggable}
                      onDragStart={(event) => {
                        if (!canManageBoards) return;
                        draggingBoardItemIdRef.current = item.id;
                        if (event.dataTransfer) {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', item.id);
                        }
                      }}
                      onDragOver={(event) => {
                        if (!canManageBoards) return;
                        const draggingId = draggingBoardItemIdRef.current;
                        if (!draggingId || draggingId === item.id) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!canManageBoards) return;
                        event.preventDefault();
                        const draggingId = draggingBoardItemIdRef.current;
                        draggingBoardItemIdRef.current = '';
                        if (!draggingId || draggingId === item.id) return;
                        reorderBoardItems(draggingId, item.id).catch((err) => pushMessage(err?.message || '정렬 반영 실패', 'error'));
                      }}
                      onDragEnd={() => {
                        draggingBoardItemIdRef.current = '';
                      }}
                    >
                      <button
                        type="button"
                        className="board-edit-select"
                        data-board-id={item.id}
                        onClick={() => {
                          setActiveEditBoardId(item.id);
                          setEditBoardForm({
                            id: item.id,
                            name: item.name || '',
                            description: item.description || '',
                            allowedRoles: normalizeRoles(item.allowedRoles)
                          });
                        }}
                      >
                        <div><strong>{item.name || item.id}</strong></div>
                        <div className="meta" style={{ marginTop: '4px' }}>ID: {item.id}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <form id="editBoardForm" className="stack" onSubmit={saveEditBoard}>
              <label>
                게시판 ID
                <input id="editBoardId" type="text" readOnly value={editBoardForm.id} disabled />
              </label>
              <p className="meta lock-hint-text">게시판 ID는 생성 후 변경할 수 없습니다.</p>
              <label>
                게시판 이름
                <input
                  id="editBoardName"
                  type="text"
                  required
                  value={editBoardForm.name}
                  onChange={(event) => setEditBoardForm((prev) => ({ ...prev, name: event.target.value }))}
                  disabled={!canManageBoards || !editBoardForm.id}
                />
              </label>
              <label>
                설명
                <input
                  id="editBoardDescription"
                  type="text"
                  placeholder="간단 설명"
                  value={editBoardForm.description}
                  onChange={(event) => setEditBoardForm((prev) => ({ ...prev, description: event.target.value }))}
                  disabled={!canManageBoards || !editBoardForm.id}
                />
              </label>
              <div className="board-role-box">
                <p className="meta" style={{ margin: '0 0 6px' }}>이용 가능 등급</p>
                <div id="editBoardRoleList" className="row board-role-list">
                  {!editBoardForm.id ? (
                    <p className="muted" style={{ margin: 0 }}>게시판을 선택하세요.</p>
                  ) : getBoardRoleChoices(editBoardForm.allowedRoles).map((item) => (
                    <label
                      key={`edit-board-role-${item.role}`}
                      className={`row board-role-option${item.checked ? ' is-selected' : ''}${!canManageBoards ? ' is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        value={item.role}
                        checked={item.checked}
                        disabled={!canManageBoards}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setEditBoardForm((prev) => {
                            const selectedSet = new Set(normalizeRoles(prev.allowedRoles));
                            if (checked) selectedSet.add(item.role);
                            else selectedSet.delete(item.role);
                            return { ...prev, allowedRoles: [...selectedSet] };
                          });
                        }}
                      />
                      <span>{item.role}({item.labelKo}){item.extra ? ' *' : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  id="deleteBoardBtn"
                  type="button"
                  className={isSuperAdminUser ? 'btn-danger' : 'btn-danger hidden'}
                  disabled={!canManageBoards || !editBoardForm.id || !isSuperAdminUser}
                  onClick={() => removeBoard().catch((err) => pushMessage(err?.message || '게시판 삭제 실패', 'error'))}
                >
                  삭제
                </button>
                <button type="submit" className="btn-primary" disabled={!canManageBoards || !editBoardForm.id}>저장</button>
              </div>
            </form>
          </div>
      </AdminModal>

      <AdminModal
        modalId="boardCreateModal"
        open={boardCreateOpen}
        onClose={() => closeModalById('boardCreateModal')}
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>게시판 생성</h3>
              <p className="meta" style={{ marginTop: '6px' }}>ID, 이름, 설명, 허용 등급을 입력합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="boardCreateModal"
              onClick={() => closeModalById('boardCreateModal')}
            >
              닫기
            </button>
          </div>

          <form id="createBoardModalForm" className="stack" style={{ marginTop: '12px' }} onSubmit={saveCreateBoard}>
            <label>
              게시판 ID
              <input
                id="createBoardId"
                type="text"
                placeholder="예: notices"
                required
                value={createBoardForm.id}
                onChange={(event) => {
                  const sanitized = sanitizeRoleKey(event.target.value);
                  setCreateBoardForm((prev) => ({ ...prev, id: sanitized }));
                }}
                disabled={!canManageBoards}
              />
            </label>
            <p className="meta" style={{ margin: '-2px 0 0' }}>영문/숫자/_만 입력할 수 있습니다.</p>
            <label>
              게시판 이름
              <input
                id="createBoardName"
                type="text"
                placeholder="예: 공지사항"
                required
                value={createBoardForm.name}
                onChange={(event) => setCreateBoardForm((prev) => ({ ...prev, name: event.target.value }))}
                disabled={!canManageBoards}
              />
            </label>
            <label>
              설명
              <input
                id="createBoardDescription"
                type="text"
                placeholder="간단 설명"
                value={createBoardForm.description}
                onChange={(event) => setCreateBoardForm((prev) => ({ ...prev, description: event.target.value }))}
                disabled={!canManageBoards}
              />
            </label>
            <div className="board-role-box">
              <p className="meta" style={{ margin: '0 0 6px' }}>이용 가능 등급</p>
              <div id="createBoardRoleList" className="row board-role-list">
                {getBoardRoleChoices(createBoardForm.allowedRoles).map((item) => (
                  <label
                    key={`create-board-role-${item.role}`}
                    className={`row board-role-option${item.checked ? ' is-selected' : ''}${!canManageBoards ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      value={item.role}
                      checked={item.checked}
                      disabled={!canManageBoards}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCreateBoardForm((prev) => {
                          const selectedSet = new Set(normalizeRoles(prev.allowedRoles));
                          if (checked) selectedSet.add(item.role);
                          else selectedSet.delete(item.role);
                          return { ...prev, allowedRoles: [...selectedSet] };
                        });
                      }}
                    />
                    <span>{item.role}({item.labelKo}){item.extra ? ' *' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary" disabled={!canManageBoards}>생성</button>
            </div>
          </form>
      </AdminModal>

      <AdminModal
        modalId="roleEditModal"
        open={roleEditOpen}
        onClose={() => closeModalById('roleEditModal')}
        panelClassName="admin-modal-panel board-edit-modal-panel"
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>등급 수정</h3>
              <p className="meta" style={{ marginTop: '6px' }}>등급을 선택하고 정보/권한/배지를 수정합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="roleEditModal"
              onClick={() => closeModalById('roleEditModal')}
            >
              닫기
            </button>
          </div>

          <div className="grid grid-2 board-edit-layout" style={{ marginTop: '12px' }}>
            <div className="board-edit-list-wrap">
              <p className="meta" style={{ margin: '0 0 8px' }}>등급 목록</p>
              <div id="roleEditList" className="board-edit-list">
                {!editableRoles.length ? (
                  <p className="muted" style={{ margin: 0 }}>수정 가능한 커스텀 등급이 없습니다.</p>
                ) : editableRoles.map((roleDoc) => {
                  const activeClass = roleDoc.role === activeEditRoleKey ? ' active' : '';
                  return (
                    <button
                      key={roleDoc.role}
                      type="button"
                      className={`board-edit-item${activeClass}`}
                      data-role-key={roleDoc.role}
                      onClick={() => {
                        setActiveEditRoleKey(roleDoc.role);
                        setEditRoleForm({
                          role: roleDoc.role,
                          labelKo: roleDoc.labelKo || roleDoc.role,
                          level: roleLevelOf(roleDoc.role) || '',
                          badgeBgColor: normalizeBadgeColor(roleDoc.badgeBgColor, '#ffffff'),
                          badgeTextColor: normalizeBadgeColor(roleDoc.badgeTextColor, '#334155'),
                          adminDeleteLocked: !!roleDoc.adminDeleteLocked,
                          flags: buildRoleFlagsFromDoc(roleDoc)
                        });
                      }}
                    >
                      <div><strong>{roleDoc.labelKo || roleDoc.role}</strong></div>
                      <div className="meta" style={{ marginTop: '4px' }}>{roleDoc.role}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <form id="editRoleForm" className="stack" onSubmit={saveEditRole}>
              <label>
                Role Key
                <input id="editRoleKey" type="text" readOnly value={editRoleForm.role} />
              </label>
              <label>
                한글 표시명
                <input
                  id="editRoleLabelKo"
                  type="text"
                  required
                  value={editRoleForm.labelKo}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, labelKo: event.target.value }))}
                  disabled={!canManageRoleDefinitions || !editRoleForm.role}
                />
              </label>
              <label>
                Level
                <input
                  id="editRoleLevel"
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={editRoleForm.level}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, level: event.target.value }))}
                  disabled={!canManageRoleDefinitions || !editRoleForm.role}
                />
              </label>
              <RoleColorField
                id="editRoleBadgeBgColor"
                label="배지 배경색"
                value={editRoleForm.badgeBgColor}
                disabled={!canManageRoleDefinitions || !editRoleForm.role}
                onChange={(nextColor) => setEditRoleForm((prev) => ({ ...prev, badgeBgColor: nextColor }))}
              />
              <RoleColorField
                id="editRoleBadgeTextColor"
                label="배지 글자색"
                value={editRoleForm.badgeTextColor}
                disabled={!canManageRoleDefinitions || !editRoleForm.role}
                onChange={(nextColor) => setEditRoleForm((prev) => ({ ...prev, badgeTextColor: nextColor }))}
              />
              <div className="role-badge-preview-wrap">
                <p className="meta" style={{ margin: '0 0 6px' }}>배지 미리보기</p>
                <span
                  id="editRoleBadgePreview"
                  className="role-badge"
                  style={{
                    background: editRoleBadgePalette.bgColor,
                    color: editRoleBadgePalette.textColor,
                    borderColor: editRoleBadgePalette.borderColor
                  }}
                >
                  {normalizeText(editRoleForm.labelKo) || sanitizeRoleKey(editRoleForm.role) || 'Role'}
                </span>
              </div>
              <label className="row role-lock-toggle">
                <input
                  id="editRoleAdminDeleteLocked"
                  type="checkbox"
                  checked={!!editRoleForm.adminDeleteLocked}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, adminDeleteLocked: event.target.checked }))}
                  disabled={!canManageRoleDefinitions || !isSuperAdminUser || !editRoleForm.role}
                />
                <span>Admin 삭제 불가</span>
              </label>
              <div>
                <p className="meta" style={{ margin: '0 0 6px' }}>권한</p>
                <div id="editRolePermissionFlags" className="grid grid-3">
                  {roleFlagDefs.map((flag) => (
                    <label key={`edit-role-flag-${flag.key}`} className="row role-flag-item">
                      <input
                        type="checkbox"
                        checked={!!editRoleForm.flags[flag.key]}
                        disabled={!canManageRoleDefinitions || !editRoleForm.role}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setEditRoleForm((prev) => ({
                            ...prev,
                            flags: {
                              ...prev.flags,
                              [flag.key]: checked
                            }
                          }));
                        }}
                      />
                      <span>{flag.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button id="deleteRoleBtn" type="button" className="btn-danger" disabled={editRoleDeleteDisabled} onClick={() => removeRole().catch((err) => pushMessage(err?.message || 'Role 삭제 실패', 'error'))}>
                  삭제
                </button>
                <button type="submit" className="btn-primary" disabled={!canManageRoleDefinitions || !editRoleForm.role}>저장</button>
              </div>
            </form>
          </div>
      </AdminModal>

      <AdminModal
        modalId="roleCreateModal"
        open={roleCreateOpen}
        onClose={() => closeModalById('roleCreateModal')}
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>등급 생성</h3>
              <p className="meta" style={{ marginTop: '6px' }}>새 등급의 정보/권한/배지를 입력합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="roleCreateModal"
              onClick={() => closeModalById('roleCreateModal')}
            >
              닫기
            </button>
          </div>

          <form id="createRoleForm" className="stack" style={{ marginTop: '12px' }} onSubmit={saveCreateRole}>
            <label>
              Role Key
              <input
                id="roleKey"
                type="text"
                placeholder="예: Staff"
                required
                value={createRoleForm.role}
                onChange={(event) => {
                  const sanitized = sanitizeRoleKey(event.target.value);
                  setCreateRoleForm((prev) => ({ ...prev, role: sanitized }));
                }}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <label>
              한글 표시명
              <input
                id="roleLabelKo"
                type="text"
                placeholder="예: 스태프"
                required
                value={createRoleForm.labelKo}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, labelKo: event.target.value }))}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <label>
              Level
              <input
                id="roleLevel"
                type="number"
                min="1"
                max="100"
                required
                value={createRoleForm.level}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, level: event.target.value }))}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <RoleColorField
              id="roleBadgeBgColor"
              label="배지 배경색"
              value={createRoleForm.badgeBgColor}
              disabled={!canManageRoleDefinitions}
              onChange={(nextColor) => setCreateRoleForm((prev) => ({ ...prev, badgeBgColor: nextColor }))}
            />
            <RoleColorField
              id="roleBadgeTextColor"
              label="배지 글자색"
              value={createRoleForm.badgeTextColor}
              disabled={!canManageRoleDefinitions}
              onChange={(nextColor) => setCreateRoleForm((prev) => ({ ...prev, badgeTextColor: nextColor }))}
            />
            <div className="role-badge-preview-wrap">
              <p className="meta" style={{ margin: '0 0 6px' }}>배지 미리보기</p>
              <span
                id="roleBadgePreview"
                className="role-badge"
                style={{
                  background: createRoleBadgePalette.bgColor,
                  color: createRoleBadgePalette.textColor,
                  borderColor: createRoleBadgePalette.borderColor
                }}
              >
                {normalizeText(createRoleForm.labelKo) || sanitizeRoleKey(createRoleForm.role) || 'Newbie'}
              </span>
            </div>
            <label className="row role-lock-toggle">
              <input
                id="createRoleAdminDeleteLocked"
                type="checkbox"
                checked={!!createRoleForm.adminDeleteLocked}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, adminDeleteLocked: event.target.checked }))}
                disabled={!canManageRoleDefinitions || !isSuperAdminUser}
              />
              <span>Admin 삭제 불가</span>
            </label>
            <div>
              <p className="meta" style={{ margin: '0 0 6px' }}>권한</p>
              <div id="rolePermissionFlags" className="grid grid-3">
                {roleFlagDefs.map((flag) => (
                  <label key={`create-role-flag-${flag.key}`} className="row role-flag-item">
                    <input
                      type="checkbox"
                      checked={!!createRoleForm.flags[flag.key]}
                      disabled={!canManageRoleDefinitions}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCreateRoleForm((prev) => ({
                          ...prev,
                          flags: {
                            ...prev.flags,
                            [flag.key]: checked
                          }
                        }));
                      }}
                    />
                    <span>{flag.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary" disabled={!canManageRoleDefinitions}>생성</button>
            </div>
          </form>
      </AdminModal>

      <AnimatePresence>
        {appliedPopup.open ? (
          <motion.div
            id="appliedPopup"
            className={`applied-popup show ${appliedPopup.tone === 'notice' ? 'is-notice' : appliedPopup.tone === 'error' ? 'is-error' : 'is-ok'}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {appliedPopup.text}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
