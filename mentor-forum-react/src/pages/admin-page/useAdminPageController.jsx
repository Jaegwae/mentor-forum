// AdminPage controller.
// Coordinates admin workflows: auth/session guard, board CRUD/order, role
// definition CRUD, user-role updates, venue option management, and excel bridge.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutPanelTop, LogOut, MapPin, MessageSquare, ShieldCheck, ShieldPlus, UsersRound } from 'lucide-react';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select.jsx';
import { ThemeToggle } from '../../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildAdminExcelSheetModel
} from '../../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../../hooks/useTheme.js';
import {
  auth,
  ensureFirebaseConfigured,
  onAuthStateChanged,
  getTemporaryLoginRemainingMs,
  setTemporaryLoginExpiry,
  TEMP_LOGIN_TTL_MS,
  clearTemporaryLoginExpiry,
  enforceTemporaryLoginExpiry,
  signOut,
  serverTimestamp
} from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import * as adminFirestore from '../../services/firestore/admin-page.js';
import {
  buildPermissions,
  roleDisplay,
  getRoleBadgePalette,
  normalizeBadgeColor
} from '../../legacy/rbac.js';
import * as pageConstants from './constants.js';
import * as pageUtils from './utils.js';
import * as pageData from './data.js';

const {
  AUTO_LOGOUT_MESSAGE,
  DEFAULT_VENUE_LABELS,
  roleFlagDefs,
  ROLE_KEY_ALIASES,
  ROLE_COLOR_PRESETS,
  coreRoleDefaults,
  CORE_ROLE_SET,
  legacyRoleVisibilityCleanup
} = pageConstants;

const {
  normalizeText,
  sanitizeRoleKey,
  detectCompactListMode,
  shouldLogDebugPayload,
  isPermissionDeniedError,
  joinDebugParts,
  debugCodePoints,
  debugValueList,
  normalizeNickname,
  buildNicknameKey,
  normalizeVenueLabel,
  sortVenueOptions,
  timestampToMs,
  normalizeRoles,
  isCoreRole,
  roleDeleteLockedForAdmin,
  formatTemporaryLoginRemaining,
  createRoleDefMap,
  normalizeRoleKey,
  roleLevelWithDefinitions,
  sortRolesForManage,
  sortUsersForManage,
  isDividerItem,
  dividerLabel,
  boardSortValue,
  sortBoardItems,
  initRoleFlags,
  buildRoleFlagsFromDoc,
  buildManageState,
  roleSummaryText
} = pageUtils;

const {
  loadRoleDefinitionsFromDb,
  ensureUserProfile
} = pageData;

export function useAdminPageController() {
  usePageMeta('멘토스 관리자 사이트', 'admin-page');

  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isExcel = theme === 'excel';
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

  // Refs for temporary-session timers and DnD bookkeeping.
  const expiryTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const lastActivityRefreshAtRef = useRef(0);
  const appliedPopupTimerRef = useRef(null);
  const draggingBoardItemIdRef = useRef('');

  // Page-level UX state.
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [appliedPopup, setAppliedPopup] = useState({ open: false, text: '반영되었습니다.', tone: 'ok' });

  // Auth + profile + permission snapshot.
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);

  // Temporary login countdown state.
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);

  // Role-definition edit/create state.
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

  // Board edit/create state.
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

  // User/venue management state.
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

  // Modal visibility state.
  const [boardEditOpen, setBoardEditOpen] = useState(false);
  const [boardCreateOpen, setBoardCreateOpen] = useState(false);
  const [roleEditOpen, setRoleEditOpen] = useState(false);
  const [roleCreateOpen, setRoleCreateOpen] = useState(false);

  // Derived maps/lists consumed by the view and action guards.
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
    const snap = await adminFirestore.fetchBoardsDocs();
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
    const usersSnap = await adminFirestore.fetchUsersDocs();
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
    const snap = await adminFirestore.fetchVenueOptionsDocs();
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
      missingLabels.map((label, index) => adminFirestore.addVenueOptionDoc({
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

        const indexSnap = await adminFirestore.fetchNicknameIndexDoc(nicknameKey);
        if (indexSnap.exists()) {
          const existingUid = normalizeText(indexSnap.data()?.uid);
          if (existingUid && existingUid !== uid) {
            conflictCount += 1;
          } else {
            existsCount += 1;
          }
          continue;
        }

        await adminFirestore.upsertNicknameIndexDoc(nicknameKey, {
          uid,
          nickname,
          nicknameKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
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
    await adminFirestore.saveBoardOrder(items, currentUser.uid, serverTimestamp);
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

    await adminFirestore.upsertBoardDoc(id, {
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

    await adminFirestore.upsertBoardDoc(activeEditBoardId, {
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

    await adminFirestore.deleteBoardDoc(activeEditBoardId);
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

    await adminFirestore.upsertBoardDoc(dividerId, {
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

  const removeBoardDivider = useCallback(async (dividerItem) => {
    clearMessage();
    if (!ensurePermission('canManageBoards', '게시판 관리 권한이 없습니다.')) return;

    const dividerId = normalizeText(dividerItem?.id);
    if (!dividerId) return;
    if (!window.confirm(`구분선 "${dividerLabel(dividerItem)}"을 삭제할까요?`)) return;

    await adminFirestore.deleteBoardDoc(dividerId);
    await refreshBoards(activeEditBoardId);
    pushMessage('구분선을 삭제했습니다.', 'notice');
    showAppliedPopup();
  }, [
    activeEditBoardId,
    clearMessage,
    ensurePermission,
    pushMessage,
    refreshBoards,
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

    await adminFirestore.upsertRoleDefinitionDoc(role, {
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

    await adminFirestore.upsertRoleDefinitionDoc(activeEditRoleKey, {
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

    const assignedUsersSnap = await adminFirestore.fetchUsersByRoleDocs(activeEditRoleKey);

    for (const userDoc of assignedUsersSnap.docs) {
      await adminFirestore.updateUserDoc(userDoc.id, {
        role: 'Newbie',
        updatedAt: serverTimestamp()
      });
    }

    await adminFirestore.deleteRoleDefinitionDoc(activeEditRoleKey);

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
      await adminFirestore.upsertRoleDefinitionDoc(role.role, {
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
      await adminFirestore.updateUserDoc(uid, payload);
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
            adminFirestore.fetchUserDoc(currentUser?.uid || ''),
            adminFirestore.fetchUserDoc(uid)
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
      await adminFirestore.addVenueOptionDoc({
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
      await adminFirestore.upsertVenueOptionDoc(targetId, {
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
      await adminFirestore.deleteVenueOptionDoc(targetId);
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


  return {
    navigate,
    theme,
    toggleTheme,
    isExcel,
    compactListMode,
    setCompactListMode,
    expiryTimerRef,
    countdownTimerRef,
    lastActivityRefreshAtRef,
    appliedPopupTimerRef,
    draggingBoardItemIdRef,
    ready,
    setReady,
    message,
    setMessage,
    appliedPopup,
    setAppliedPopup,
    currentUser,
    setCurrentUser,
    currentUserProfile,
    setCurrentUserProfile,
    permissions,
    setPermissions,
    sessionRemainingMs,
    setSessionRemainingMs,
    roleDefinitions,
    setRoleDefinitions,
    activeEditRoleKey,
    setActiveEditRoleKey,
    createRoleForm,
    setCreateRoleForm,
    editRoleForm,
    setEditRoleForm,
    boardItems,
    setBoardItems,
    activeEditBoardId,
    setActiveEditBoardId,
    createBoardForm,
    setCreateBoardForm,
    editBoardForm,
    setEditBoardForm,
    allUserRows,
    setAllUserRows,
    userSearch,
    setUserSearch,
    userDrafts,
    setUserDrafts,
    syncingNicknameIndex,
    setSyncingNicknameIndex,
    venueOptions,
    setVenueOptions,
    venueDrafts,
    setVenueDrafts,
    newVenueLabel,
    setNewVenueLabel,
    creatingVenue,
    setCreatingVenue,
    savingVenueId,
    setSavingVenueId,
    deletingVenueId,
    setDeletingVenueId,
    boardEditOpen,
    setBoardEditOpen,
    boardCreateOpen,
    setBoardCreateOpen,
    roleEditOpen,
    setRoleEditOpen,
    roleCreateOpen,
    setRoleCreateOpen,
    roleDefMap,
    sortedRoles,
    editableRoles,
    boardRows,
    anyModalOpen,
    isSuperAdminUser,
    myRoleLevel,
    clearMessage,
    pushMessage,
    showAppliedPopup,
    roleLevelOf,
    evaluateUserManageState,
    getBoardRoleChoices,
    defaultBoardRoles,
    filteredUsers,
    clearExpiryTimer,
    clearCountdownTimer,
    handleTemporaryLoginExpiry,
    scheduleTemporaryLoginExpiry,
    hasTemporarySession,
    refreshRoles,
    refreshBoards,
    refreshUsers,
    refreshVenueOptions,
    ensureDefaultVenueOptions,
    backfillNicknameIndex,
    handleExtendSession,
    handleLogout,
    ensurePermission,
    nextBoardSortOrder,
    persistBoardOrder,
    reorderBoardItems,
    openBoardEditModal,
    openBoardCreateModal,
    openRoleEditModal,
    openRoleCreateModal,
    closeModalById,
    saveCreateBoard,
    saveEditBoard,
    removeBoard,
    addBoardDivider,
    removeBoardDivider,
    saveCreateRole,
    saveEditRole,
    removeRole,
    seedCoreRoles,
    saveUserRole,
    createVenueOption,
    saveVenueOption,
    deleteVenueOption,
    canManageBoards,
    canManageRoleDefinitions,
    canManageRoles,
    adminNickname,
    adminRoleText,
    createRoleBadgePalette,
    editRoleBadgePalette,
    editRoleDoc,
    editRoleDeleteDisabled,
    sortedRoleOptionsForSelect,
    boardCount,
    venueCount,
    excelBoardRows,
    excelVenueRows,
    excelRoleRows,
    excelUserRows,
    excelSheetModel,
    isExcelDesktopMode,
    excelActiveCellLabel,
    setExcelActiveCellLabel,
    excelFormulaText,
    setExcelFormulaText,
    handleExcelSelectCell,
    handleExcelAction
  };
}
