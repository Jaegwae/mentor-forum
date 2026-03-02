// AppPage controller.
// This hook owns all AppPage runtime behavior (auth bootstrap, board/feed sync,
// composer flows, notification center, mobile push, and excel interaction).
// The paired view receives a flat `vm` object to minimize migration risk.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildPermissions } from '../../legacy/rbac.js';
import { createRichEditor } from '../../legacy/rich-editor.js';
import {
  WEB_PUSH_SW_PATH,
  getWebPushCapability,
  requestWebPushToken
} from '../../legacy/push-notifications.js';
import { pushRelayConfigured, sendPushRelayPostCreate } from '../../legacy/push-relay.js';
import {
  APP_EXCEL_COL_COUNT,
  APP_EXCEL_ROW_COUNT,
  buildAppExcelSheetModel
} from '../../components/excel/app-excel-sheet-model.js';
import * as appFirestore from '../../services/firestore/app-page.js';
import * as pageConstants from './constants.js';
import * as pageUtils from './utils.js';
import * as pageData from './data.js';

const {
  ALL_BOARD_ID,
  NOTICE_BOARD_ID,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  COVER_FOR_STATUS,
  COVER_FOR_MAX_DATES,
  COVER_FOR_REQUEST_TITLE,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  DEFAULT_COVER_FOR_VENUE_OPTIONS,
  COVER_FOR_DEFAULT_VENUE,
  COVER_FOR_CUSTOM_VENUE_VALUE,
  COVER_CALENDAR_PREVIEW_LIMIT,
  COVER_FOR_TIME_OPTIONS,
  COVER_FOR_START_TIME_OPTIONS,
  CALENDAR_WEEKDAYS,
  AUTO_LOGOUT_MESSAGE,
  POSTS_PER_PAGE,
  LAST_BOARD_STORAGE_KEY,
  NOTIFICATION_MAX_ITEMS,
  NOTIFICATION_RECENT_WINDOW_MS,
  NEW_POST_LOOKBACK_MS,
  RECENT_COMMENT_MAX_ITEMS,
  RECENT_COMMENT_FETCH_LIMIT,
  RECENT_COMMENT_PREVIEW_LIMIT,
  PINNED_POST_FETCH_LIMIT,
  POST_LIST_VIEW_MODE,
  MENTION_MAX_ITEMS,
  MENTION_MENU_ESTIMATED_WIDTH,
  MENTION_ALL_TOKEN,
  NOTIFICATION_TYPE,
  NOTIFICATION_SUBTYPE,
  NOTIFICATION_PREF_KEY,
  MOBILE_PUSH_PREF_KEY,
  LEGACY_NOTIFICATION_PREF_KEY,
  NOTIFICATION_FEED_FILTER,
  COMPOSER_MENTION_MENU_INITIAL,
  CORE_ROLE_LEVELS,
  ROLE_KEY_ALIASES,
  FALLBACK_ROLE_DEFINITIONS
} = pageConstants;

const {
  numberOrZero,
  normalizeText,
  normalizeBoardIdentity,
  boardIdentityCandidates,
  postBoardIdentityCandidates,
  isTruthyLegacyValue,
  isDeletedPost,
  normalizeErrMessage,
  isPermissionDeniedError,
  shouldLogDebugPayload,
  logErrorWithOptionalDebug,
  debugValueList,
  debugCodePoints,
  joinDebugParts,
  boardPermissionDebugText,
  readRememberedBoardId,
  writeRememberedBoardId,
  formatTemporaryLoginRemaining,
  formatPostListDate,
  formatPostListDateMobile,
  buildRecentCommentPreview,
  notificationCollectionRef,
  notificationDocRef,
  notificationPrefCollectionRef,
  notificationPrefDocRef,
  pushTokenCollectionRef,
  pushTokenDocRef,
  mobilePushBoardPrefKey,
  buildPushTokenDocId,
  viewedPostCollectionRef,
  venueOptionCollectionRef,
  formatNotificationDate,
  notificationPermissionLabel,
  normalizeNotificationType,
  normalizeNickname,
  buildNicknameKey,
  detectMentionContext,
  normalizeNotificationFeedFilter,
  normalizeCoverVenueOptions,
  normalizeCoverForVenue,
  sanitizeCoverForVenueInput,
  logCoverVenueDebug,
  notificationCategoryLabel,
  notificationHeadline,
  isForcedNotification,
  isWorkScheduleShiftAlertNotification,
  notificationMatchesFeedFilter,
  detectCompactListMode,
  toDateKey,
  fromDateKey,
  formatDateKeyLabel,
  isCalendarBoardId,
  normalizeWorkScheduleRows,
  normalizeWorkScheduleMemberText,
  buildWorkScheduleSummaryLines,
  workScheduleRowContainsPersonName,
  normalizeDateKeyInput,
  normalizeTimeInput,
  timeValueToMinutes,
  isValidTimeRange,
  suggestEndTime,
  normalizeCoverForTimeValues,
  normalizeCoverForVenueValues,
  normalizeCoverForDateTimeEntries,
  normalizeCoverForDateKeys,
  normalizeCoverForStatus,
  coverForStatusLabel,
  isClosedCoverForStatus,
  normalizeCoverForDateStatuses,
  postCoverForDateEntries,
  summarizeCoverForDateEntries,
  summarizeCoverForPost,
  hashText,
  buildPastelTone,
  pastelToneStyle,
  pastelToneCardStyle,
  hexToRgb,
  rgbaFromHex,
  profileCardSurface,
  toMillis,
  isPinnedPost,
  pinnedAtMillis,
  comparePostsWithPinnedPriority,
  isDividerItem,
  navSortValue,
  sortBoardNavItems,
  createRoleDefMap,
  roleLevelOf,
  normalizeRoles,
  boardAllowedRoles,
  boardAutoVisibility,
  isPrivilegedBoardRole,
  isNoticeBoard,
  normalizeRoleKey,
  isExplicitNewbieRole,
  roleMatchCandidates,
  canUseBoardWithProfile,
  canWriteBoardWithProfile,
  mergePostsByCreatedAtDesc,
  getVisiblePosts,
  buildAuthorName
} = pageUtils;

const {
  loadRoleDefinitions,
  ensureUserProfile,
  loadBoards,
  queryPostsForBoard,
  fetchCommentCount
} = pageData;

export function useAppPageController({ navigate, location, theme, toggleTheme }) {
  const isExcel = theme === 'excel';

  // Mutable refs used for timers, one-off guards, and request sequencing.
  // These values must not trigger re-render, so they intentionally live in refs.
  const pendingBoardIdRef = useRef(new URLSearchParams(location.search).get('boardId') || '');
  const editorRef = useRef(null);
  const editorElRef = useRef(null);
  const fontSizeLabelRef = useRef(null);
  const expiryTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const lastActivityRefreshAtRef = useRef(0);
  const postsLoadRequestRef = useRef(0);
  const appliedPopupTimerRef = useRef(null);
  const knownRealtimePostIdsRef = useRef(new Set());
  const realtimePostsReadyRef = useRef(false);
  const notificationPrefsRef = useRef({});
  const mentionRequestIdRef = useRef(0);
  const mentionCacheRef = useRef(new Map());
  const composerVenueInputRefs = useRef([]);

  // Global page readiness / top-level UX messaging.
  const [ready, setReady] = useState(false);
  const [pageMessage, setPageMessage] = useState({ type: '', text: '' });
  const [appliedPopup, setAppliedPopup] = useState({ open: false, text: '' });

  // Auth + profile + permission model.
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);

  // Board navigation and post feed state.
  const [boardNavItems, setBoardNavItems] = useState([]);
  const [boardList, setBoardList] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(ALL_BOARD_ID);

  const [visiblePosts, setVisiblePosts] = useState([]);
  const [commentCountByPost, setCommentCountByPost] = useState({});
  const [listMessage, setListMessage] = useState({ type: '', text: '' });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [postListViewMode, setPostListViewMode] = useState(POST_LIST_VIEW_MODE.LATEST);
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);
  const [excelActiveCellLabel, setExcelActiveCellLabel] = useState('');
  const [excelFormulaText, setExcelFormulaText] = useState('=');

  // UI shell state (mobile drawer, guides, modal visibility).
  const [boardDrawerOpen, setBoardDrawerOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);

  // Composer state (new post, cover-for fields, mention menu).
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMessage, setComposerMessage] = useState({ type: '', text: '' });
  const [postTitle, setPostTitle] = useState('');
  const [composerCoverDateKeys, setComposerCoverDateKeys] = useState(() => {
    const todayKey = toDateKey(new Date());
    return todayKey ? [todayKey] : [];
  });
  const [composerCoverStartTimeValues, setComposerCoverStartTimeValues] = useState([COVER_FOR_DEFAULT_START_TIME]);
  const [composerCoverEndTimeValues, setComposerCoverEndTimeValues] = useState([COVER_FOR_DEFAULT_END_TIME]);
  const [composerCoverVenueValues, setComposerCoverVenueValues] = useState([COVER_FOR_DEFAULT_VENUE]);
  const [composerCoverVenueCustomModes, setComposerCoverVenueCustomModes] = useState([false]);
  const [, setComposerVenueInputFocusIndex] = useState(-1);
  const [composerMentionMenu, setComposerMentionMenu] = useState(COMPOSER_MENTION_MENU_INITIAL);
  const [composerMentionCandidates, setComposerMentionCandidates] = useState([]);
  const [composerMentionActiveIndex, setComposerMentionActiveIndex] = useState(0);
  const [venueOptions, setVenueOptions] = useState(DEFAULT_COVER_FOR_VENUE_OPTIONS);
  const [submittingPost, setSubmittingPost] = useState(false);

  // Temporary-session countdown for users who did not opt into persistent login.
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);

  const todayDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const [coverCalendarCursor, setCoverCalendarCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [coverCalendarSelectedDate, setCoverCalendarSelectedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [coverCalendarModalOpen, setCoverCalendarModalOpen] = useState(false);
  const [coverCalendarModalDateKey, setCoverCalendarModalDateKey] = useState('');
  const [composerDatePickerOpen, setComposerDatePickerOpen] = useState(false);
  const [composerDatePickerTargetIndex, setComposerDatePickerTargetIndex] = useState(-1);
  const [composerDatePickerCursor, setComposerDatePickerCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const composerDatePickerOpenedAtRef = useRef(0);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationPrefs, setNotificationPrefs] = useState({});
  const [notificationFeedFilter, setNotificationFeedFilter] = useState(NOTIFICATION_FEED_FILTER.ALL);
  const [mobilePushModalOpen, setMobilePushModalOpen] = useState(false);
  const [mobilePushCapability, setMobilePushCapability] = useState({ supported: false, reason: '확인 중...', reasonCode: 'checking' });
  const [mobilePushWorking, setMobilePushWorking] = useState(false);
  const [mobilePushStatus, setMobilePushStatus] = useState({ type: '', text: '' });
  const [mobilePushTokens, setMobilePushTokens] = useState([]);
  const [viewedPostIdMap, setViewedPostIdMap] = useState({});
  const [recentComments, setRecentComments] = useState([]);
  const [recentCommentsLoading, setRecentCommentsLoading] = useState(false);
  const [selectedPinPostIdMap, setSelectedPinPostIdMap] = useState({});
  const [pinActionPending, setPinActionPending] = useState(false);

  // Derived maps and computed model fields consumed by the view.
  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const currentUserUid = normalizeText(currentUser?.uid);
  const isAdminOrSuper = normalizeText(currentUserProfile?.role) === 'Admin' || normalizeText(currentUserProfile?.role) === 'Super_Admin';
  const coverVenueOptions = useMemo(() => {
    return normalizeCoverVenueOptions(venueOptions);
  }, [venueOptions]);
  const coverVenueDefault = useMemo(() => {
    if (coverVenueOptions.includes(COVER_FOR_DEFAULT_VENUE)) return COVER_FOR_DEFAULT_VENUE;
    return coverVenueOptions[0] || COVER_FOR_DEFAULT_VENUE;
  }, [coverVenueOptions]);
  const profileSurface = useMemo(() => {
    return profileCardSurface(currentUserProfile?.role, roleDefMap, theme);
  }, [currentUserProfile?.role, roleDefMap, theme]);

  const boardLookup = useMemo(() => {
    const next = new Map();
    boardList.forEach((board) => {
      const boardId = normalizeText(board?.id);
      if (!boardId) return;
      next.set(boardId, board);
    });
    return next;
  }, [boardList]);

  const currentBoard = useMemo(() => {
    const boardId = normalizeText(selectedBoardId);
    if (!boardId) return null;
    return boardLookup.get(boardId) || null;
  }, [boardLookup, selectedBoardId]);

  const isAllBoardSelected = normalizeText(selectedBoardId) === ALL_BOARD_ID;

  const currentBoardName = useMemo(() => {
    if (isAllBoardSelected) return '전체 게시글';
    if (currentBoard) return currentBoard.name || currentBoard.id;
    return normalizeText(selectedBoardId) || '-';
  }, [currentBoard, isAllBoardSelected, selectedBoardId]);

  const currentBoardRoles = useMemo(() => {
    if (!currentBoard) return [];
    return boardAllowedRoles(currentBoard, roleDefMap);
  }, [currentBoard, roleDefMap]);

  const currentBoardVisibility = useMemo(() => {
    if (!currentBoard) return 'mentor';
    return boardAutoVisibility(currentBoard, roleDefMap);
  }, [currentBoard, roleDefMap]);
  const canManagePinInCurrentBoard = isAdminOrSuper && !isAllBoardSelected && !!currentBoard;

  const visiblePostById = useMemo(() => {
    const map = new Map();
    visiblePosts.forEach((post) => {
      const postId = normalizeText(post?.id);
      if (!postId) return;
      map.set(postId, post);
    });
    return map;
  }, [visiblePosts]);

  const listedPosts = useMemo(() => {
    const sorted = [...visiblePosts];
    return sorted.sort((a, b) => comparePostsWithPinnedPriority(a, b, postListViewMode));
  }, [postListViewMode, visiblePosts]);
  const selectedPinPostIds = useMemo(() => {
    return Object.keys(selectedPinPostIdMap).filter((postId) => {
      return selectedPinPostIdMap[postId] && visiblePostById.has(postId);
    });
  }, [selectedPinPostIdMap, visiblePostById]);
  const selectedPinPostCount = selectedPinPostIds.length;
  const selectedPinMode = useMemo(() => {
    let hasPinned = false;
    let hasUnpinned = false;

    selectedPinPostIds.forEach((postId) => {
      const post = visiblePostById.get(postId);
      if (!post) return;
      if (isPinnedPost(post)) hasPinned = true;
      else hasUnpinned = true;
    });

    if (hasPinned && hasUnpinned) return 'mixed';
    if (hasPinned) return 'pinned';
    if (hasUnpinned) return 'unpinned';
    return '';
  }, [selectedPinPostIds, visiblePostById]);
  const showPinToolbar = canManagePinInCurrentBoard && selectedPinPostCount > 0;
  const totalPostCount = listedPosts.length;
  const latestTenPosts = useMemo(() => {
    return [...visiblePosts]
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, 10);
  }, [visiblePosts]);
  const recentUnreadPostIdSet = useMemo(() => {
    const nowMs = Date.now();
    const next = new Set();
    latestTenPosts.forEach((post) => {
      const postId = normalizeText(post?.id);
      if (!postId) return;
      const createdAtMs = toMillis(post?.createdAt);
      if (!createdAtMs || nowMs - createdAtMs > NEW_POST_LOOKBACK_MS) return;
      if (viewedPostIdMap[postId]) return;
      next.add(postId);
    });
    return next;
  }, [latestTenPosts, viewedPostIdMap]);
  const totalPageCount = Math.max(1, Math.ceil(totalPostCount / POSTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPageCount);
  const currentPageStartIndex = (safeCurrentPage - 1) * POSTS_PER_PAGE;
  const currentPagePosts = useMemo(() => {
    return listedPosts.slice(currentPageStartIndex, currentPageStartIndex + POSTS_PER_PAGE);
  }, [listedPosts, currentPageStartIndex]);
  const postListViewTabs = useMemo(() => {
    return [
      { key: POST_LIST_VIEW_MODE.LATEST, label: '최신' },
      { key: POST_LIST_VIEW_MODE.POPULAR, label: '인기' }
    ];
  }, []);
  const postListEmptyText = useMemo(() => {
    if (postListViewMode === POST_LIST_VIEW_MODE.POPULAR) return '인기 게시글이 없습니다.';
    return '게시글이 없습니다.';
  }, [postListViewMode]);
  const activeListMessage = useMemo(() => {
    if (listMessage.text) return listMessage;
    if (!loadingPosts && totalPostCount <= 0) {
      return { type: 'notice', text: postListEmptyText };
    }
    return { type: '', text: '' };
  }, [listMessage, loadingPosts, postListEmptyText, totalPostCount]);
  const isPostListEmptyState = useMemo(() => {
    const text = normalizeText(activeListMessage.text);
    if (!text || loadingPosts || totalPostCount > 0) return false;
    return text === '게시글이 없습니다.' || text === '인기 게시글이 없습니다.';
  }, [activeListMessage.text, loadingPosts, totalPostCount]);
  const desktopPostTableColSpan = (isAllBoardSelected ? 6 : 5) + (canManagePinInCurrentBoard ? 1 : 0);
  const paginationPages = useMemo(() => {
    if (totalPageCount <= 1) return [];
    const windowSize = 5;
    let start = Math.max(1, safeCurrentPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPageCount, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const pages = [];
    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }, [safeCurrentPage, totalPageCount]);
  const isCommentNotificationEnabled = useMemo(() => {
    return notificationPrefs[NOTIFICATION_PREF_KEY.COMMENT] !== false
      && notificationPrefs[LEGACY_NOTIFICATION_PREF_KEY.COMMENT] !== false;
  }, [notificationPrefs]);
  const isMentionNotificationEnabled = useMemo(() => {
    return notificationPrefs[NOTIFICATION_PREF_KEY.MENTION] !== false
      && notificationPrefs[LEGACY_NOTIFICATION_PREF_KEY.MENTION] !== false;
  }, [notificationPrefs]);
  const isMobilePushEnabled = useMemo(() => {
    return notificationPrefs[MOBILE_PUSH_PREF_KEY.GLOBAL] !== false;
  }, [notificationPrefs]);
  const effectiveNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (isForcedNotification(item)) return true;

      const boardId = normalizeText(item?.boardId);
      if (boardId && notificationPrefs[boardId] === false) return false;

      const type = normalizeNotificationType(item?.type);
      if (type === NOTIFICATION_TYPE.COMMENT && !isCommentNotificationEnabled) return false;
      if (type === NOTIFICATION_TYPE.MENTION && !isMentionNotificationEnabled) return false;
      return true;
    });
  }, [isCommentNotificationEnabled, isMentionNotificationEnabled, notificationPrefs, notifications]);
  const recentEffectiveNotifications = useMemo(() => {
    const nowMs = Date.now();
    return effectiveNotifications.filter((item) => {
      const createdAtMs = Number(item?.createdAtMs) || 0;
      if (createdAtMs <= 0) return false;
      return nowMs - createdAtMs <= NOTIFICATION_RECENT_WINDOW_MS;
    });
  }, [effectiveNotifications]);
  const filteredNotifications = useMemo(() => {
    return recentEffectiveNotifications.filter((item) => notificationMatchesFeedFilter(item, notificationFeedFilter));
  }, [notificationFeedFilter, recentEffectiveNotifications]);
  const unreadNotificationCount = useMemo(() => {
    return recentEffectiveNotifications.filter((item) => !(item && Number(item.readAtMs) > 0)).length;
  }, [recentEffectiveNotifications]);
  const hasUnreadNotifications = unreadNotificationCount > 0;
  const notificationBoardItems = useMemo(() => {
    return boardList.filter((board) => {
      return !!board && !isDividerItem(board) && normalizeText(board.id);
    });
  }, [boardList]);
  const hasActivePushToken = useMemo(() => {
    return mobilePushTokens.some((item) => item.enabled !== false);
  }, [mobilePushTokens]);
  const notificationPermission = typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
    ? window.Notification.permission
    : 'unsupported';
  const notificationPermissionText = notificationPermissionLabel(notificationPermission);

  const showAppliedPopup = useCallback((text = '반영되었습니다.') => {
    if (appliedPopupTimerRef.current) {
      window.clearTimeout(appliedPopupTimerRef.current);
      appliedPopupTimerRef.current = null;
    }

    setAppliedPopup({ open: true, text: String(text || '') });

    appliedPopupTimerRef.current = window.setTimeout(() => {
      setAppliedPopup((prev) => ({ ...prev, open: false }));
      appliedPopupTimerRef.current = null;
    }, 2000);
  }, []);

  const fetchMentionCandidates = useCallback(async (queryText = '') => {
    const normalizedQuery = normalizeNickname(queryText);
    const keyPrefix = buildNicknameKey(normalizedQuery);
    const snap = await appFirestore.fetchMentionIndexDocs({
      keyPrefix,
      maxItems: MENTION_MAX_ITEMS
    });
    const rows = snap.docs
      .map((row) => {
        const data = row.data() || {};
        const uid = normalizeText(data.uid);
        const nickname = normalizeNickname(data.nickname);
        if (!uid || !nickname) return null;
        return {
          uid,
          nickname
        };
      })
      .filter((row) => !!row && row.uid !== currentUserUid);

    const byUid = new Map();
    rows.forEach((row) => {
      if (!byUid.has(row.uid)) byUid.set(row.uid, row);
    });
    const next = [...byUid.values()].slice(0, MENTION_MAX_ITEMS);
    if (isAdminOrSuper) {
      // Only privileged users can trigger @ALL mention; expose it in the suggestion list for them.
      const lowerQuery = normalizedQuery.toLowerCase();
      if (!lowerQuery || MENTION_ALL_TOKEN.toLowerCase().startsWith(lowerQuery)) {
        next.unshift({ uid: '__all__', nickname: MENTION_ALL_TOKEN });
      }
    }
    return next.slice(0, MENTION_MAX_ITEMS);
  }, [currentUserUid, isAdminOrSuper]);

  const closeComposerMentionMenu = useCallback(() => {
    setComposerMentionMenu(COMPOSER_MENTION_MENU_INITIAL);
    setComposerMentionCandidates([]);
    setComposerMentionActiveIndex(0);
  }, []);

  const readComposerMentionAnchor = useCallback((editor, mentionStart) => {
    const fallback = { anchorLeft: 8, anchorTop: 12 };
    const quill = editor?.getQuill?.();
    if (!quill) return fallback;

    try {
      const safeStart = Math.max(0, Math.floor(Number(mentionStart) || 0));
      const bounds = quill.getBounds(safeStart, 0);
      const editorWidth = Number(quill.container?.clientWidth) || 0;
      const scrollLeft = Number(quill.root?.scrollLeft) || 0;
      const scrollTop = Number(quill.root?.scrollTop) || 0;
      const desiredLeft = Math.max(8, Math.floor((Number(bounds?.left) || 0) - scrollLeft));
      const maxLeft = editorWidth > 0
        ? Math.max(8, editorWidth - MENTION_MENU_ESTIMATED_WIDTH)
        : desiredLeft;

      return {
        anchorLeft: Math.max(8, Math.min(desiredLeft, maxLeft)),
        anchorTop: Math.max(8, Math.floor((Number(bounds?.top) || 0) + (Number(bounds?.height) || 18) - scrollTop + 4))
      };
    } catch (_) {
      return fallback;
    }
  }, []);

  const syncComposerMentionMenu = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      closeComposerMentionMenu();
      return;
    }

    const selection = editor.getSelection?.() || { index: 0 };
    const rawText = editor.getRawText?.() || editor.getPayload?.()?.text || '';
    const context = detectMentionContext(rawText, selection.index);
    if (!context) {
      closeComposerMentionMenu();
      return;
    }

    const anchor = readComposerMentionAnchor(editor, context.start);
    setComposerMentionMenu({
      open: true,
      query: context.query,
      start: context.start,
      end: context.end,
      anchorLeft: anchor.anchorLeft,
      anchorTop: anchor.anchorTop
    });
    setComposerMentionActiveIndex(0);

    const cacheKey = `${currentUserUid || '-'}:${context.query.toLowerCase()}`;
    const cached = mentionCacheRef.current.get(cacheKey);
    if (cached) {
      setComposerMentionCandidates(cached);
      return;
    }

    const requestId = Number(mentionRequestIdRef.current || 0) + 1;
    mentionRequestIdRef.current = requestId;
    fetchMentionCandidates(context.query)
      .then((rows) => {
        if (Number(mentionRequestIdRef.current || 0) !== requestId) return;
        mentionCacheRef.current.set(cacheKey, rows);
        setComposerMentionCandidates(rows);
      })
      .catch(() => {
        if (Number(mentionRequestIdRef.current || 0) !== requestId) return;
        setComposerMentionCandidates([]);
      });
  }, [closeComposerMentionMenu, currentUserUid, fetchMentionCandidates, readComposerMentionAnchor]);

  const applyComposerMentionCandidate = useCallback((candidate) => {
    const editor = editorRef.current;
    const nickname = normalizeNickname(candidate?.nickname);
    if (!editor || !nickname) return;

    const start = Number.isFinite(Number(composerMentionMenu.start)) ? Number(composerMentionMenu.start) : -1;
    const end = Number.isFinite(Number(composerMentionMenu.end)) ? Number(composerMentionMenu.end) : -1;
    const safeSelection = editor.getSelection?.() || { index: 0 };
    const replaceStart = start >= 0 ? start : Math.max(0, Number(safeSelection.index) || 0);
    const replaceLen = start >= 0 && end >= start
      ? (end - start)
      : 0;

    const inserted = editor.insertMention?.(replaceStart, replaceLen, {
      uid: normalizeText(candidate?.uid),
      nickname
    });
    if (!inserted) {
      editor.replaceRange?.(replaceStart, replaceLen, `@${nickname} `);
    }
    closeComposerMentionMenu();
    editor.focus?.();
  }, [closeComposerMentionMenu, composerMentionMenu.end, composerMentionMenu.start]);

  useEffect(() => {
    return () => {
      if (appliedPopupTimerRef.current) {
        window.clearTimeout(appliedPopupTimerRef.current);
        appliedPopupTimerRef.current = null;
      }
    };
  }, []);

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

  useEffect(() => {
    if (composerOpen || coverCalendarModalOpen || composerDatePickerOpen || notificationCenterOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }

    document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [composerOpen, coverCalendarModalOpen, composerDatePickerOpen, notificationCenterOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setBoardDrawerOpen(false);
      setComposerOpen(false);
      setCoverCalendarModalOpen(false);
      setComposerDatePickerOpen(false);
      setComposerDatePickerTargetIndex(-1);
      setNotificationCenterOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 901px)');

    const syncDrawer = (matches) => {
      if (matches) setBoardDrawerOpen(false);
    };

    syncDrawer(media.matches);

    const handleChange = (event) => {
      syncDrawer(event.matches);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};

    const wideMedia = window.matchMedia('(min-width: 901px)');
    const hoverMedia = window.matchMedia('(hover: hover)');
    const pointerMedia = window.matchMedia('(pointer: fine)');

    const syncMode = () => {
      setCompactListMode(detectCompactListMode());
    };

    syncMode();
    const addMediaListener = (media) => {
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', syncMode);
        return () => media.removeEventListener('change', syncMode);
      }
      media.addListener(syncMode);
      return () => media.removeListener(syncMode);
    };

    const cleanups = [
      addMediaListener(wideMedia),
      addMediaListener(hoverMedia),
      addMediaListener(pointerMedia)
    ];

    window.addEventListener('resize', syncMode);
    window.addEventListener('orientationchange', syncMode);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener('resize', syncMode);
      window.removeEventListener('orientationchange', syncMode);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const guideFlag = normalizeText(params.get('guide')).toLowerCase();
    if (guideFlag !== '1' && guideFlag !== 'true' && guideFlag !== 'y') return;

    setGuideModalOpen(true);
    params.delete('guide');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : ''
      },
      { replace: true, state: location.state }
    );
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    // Keep board selection stable across route transitions by restoring the highest-priority source
    // (state > query > fromBoard) into a pending ref, then applying it after boardList loads.
    const params = new URLSearchParams(location.search);
    const boardId = normalizeText(params.get('boardId'));
    const fromBoardId = normalizeText(params.get('fromBoardId'));
    const routeState = (location && typeof location.state === 'object' && location.state) ? location.state : {};
    const statePreferredBoardId = normalizeText(routeState.preferredBoardId || routeState.fromBoardId || '');
    const target = (
      (statePreferredBoardId && statePreferredBoardId !== ALL_BOARD_ID ? statePreferredBoardId : '')
      || (fromBoardId && fromBoardId !== ALL_BOARD_ID ? fromBoardId : '')
      || (boardId && boardId !== ALL_BOARD_ID ? boardId : '')
    );
    if (target) {
      pendingBoardIdRef.current = target;
    }
  }, [location.search, location.state]);

  useEffect(() => {
    if (!composerOpen) return () => {};
    if (!editorElRef.current || !fontSizeLabelRef.current) return;

    editorRef.current = createRichEditor({
      editorEl: editorElRef.current,
      fontSizeLabelEl: fontSizeLabelRef.current,
      onChange: () => {
        setComposerMessage((prev) => (prev.text ? { type: '', text: '' } : prev));
        syncComposerMentionMenu();
      },
      onSelectionChange: () => {
        syncComposerMentionMenu();
      }
    });
    editorRef.current.setPayload({ text: '', runs: [] });

    return () => {
      closeComposerMentionMenu();
      editorRef.current = null;
    };
  }, [closeComposerMentionMenu, composerOpen, syncComposerMentionMenu]);

  useEffect(() => {
    let active = true;
    setPageMessage({ type: '', text: '' });
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        setPageMessage({ type: 'error', text: err.message || 'Firebase 설정 오류' });
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

      try {
        await user.reload();
      } catch (_) {
        // Keep current auth state if reload fails.
      }

      if (!active) return;

      if (!user.emailVerified) {
        alert('이메일 인증 후 이용 가능합니다.');
        try {
          await signOut(auth);
        } catch (_) {
          // Ignore sign-out error on redirect path.
        }
        if (active) {
          navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
        }
        return;
      }

      setCurrentUser(user);

      try {
        const loadedRoleDefinitions = await loadRoleDefinitions();
        if (!active) return;

        const loadedRoleDefMap = createRoleDefMap(loadedRoleDefinitions);
        const profile = await ensureUserProfile(user, loadedRoleDefMap);
        if (!active) return;

        const rawRole = normalizeText(profile.rawRole || profile.role);
        const roleKey = normalizeRoleKey(profile.role, loadedRoleDefMap);
        const normalizedProfile = { ...profile, role: roleKey, rawRole };
        const roleDef = loadedRoleDefMap.get(roleKey) || null;
        const loadedPermissions = buildPermissions(roleKey, normalizedProfile, roleDef);

        const navItems = await loadBoards(roleKey, loadedRoleDefMap, rawRole);
        if (!active) return;

        setRoleDefinitions(loadedRoleDefinitions);
        setCurrentUserProfile(normalizedProfile);
        setPermissions(loadedPermissions);
        setBoardNavItems(navItems);
        setBoardList(navItems.filter((item) => !isDividerItem(item)));
        setPageMessage({ type: '', text: '' });
      } catch (err) {
        if (!active) return;
        setPageMessage({ type: 'error', text: normalizeErrMessage(err, '초기화 실패') });
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
  }, [clearCountdownTimer, clearExpiryTimer, navigate, scheduleTemporaryLoginExpiry]);

  useEffect(() => {
    const validIds = new Set([ALL_BOARD_ID, ...boardList.map((board) => normalizeText(board?.id)).filter(Boolean)]);
    setSelectedBoardId((prev) => {
      const pending = normalizeText(pendingBoardIdRef.current);
      if (pending && pending !== prev) {
        pendingBoardIdRef.current = '';
        return pending;
      }

      const normalizedPrev = normalizeText(prev);
      if (normalizedPrev && validIds.has(normalizedPrev)) return normalizedPrev;

      pendingBoardIdRef.current = '';
      return ALL_BOARD_ID;
    });
  }, [boardList, location.search]);

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

  const canUseBoard = useCallback((board) => {
    return canUseBoardWithProfile(board, currentUserProfile, roleDefMap);
  }, [currentUserProfile, roleDefMap]);

  const canWriteBoard = useCallback((board) => {
    return canWriteBoardWithProfile(board, currentUserProfile, roleDefMap);
  }, [currentUserProfile, roleDefMap]);

  const hydrateCommentCounts = useCallback(async (posts, requestId) => {
    const pairs = await Promise.all(
      posts.map(async (post) => [post.id, await fetchCommentCount(post.id)])
    );

    if (requestId !== postsLoadRequestRef.current) return;

    setCommentCountByPost((prev) => {
      const next = { ...prev };
      let changed = false;

      pairs.forEach(([postId, count]) => {
        const normalizedCount = numberOrZero(count);
        if (next[postId] !== normalizedCount) {
          next[postId] = normalizedCount;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, []);

  const loadPostsForCurrentBoard = useCallback(async () => {
    if (!currentUserProfile) return;

    const requestId = postsLoadRequestRef.current + 1;
    postsLoadRequestRef.current = requestId;

    setLoadingPosts(true);
    setListMessage({ type: '', text: '' });
    setCommentCountByPost({});

    const selectedId = selectedBoardId || ALL_BOARD_ID;
    let posts = [];

    try {
      if (selectedId === ALL_BOARD_ID) {
        if (!boardList.length) {
          posts = [];
        } else {
          const settled = await Promise.allSettled(
            boardList.map((board) => queryPostsForBoard(board.id, 30))
          );

          const groups = settled
            .filter((item) => item.status === 'fulfilled')
            .map((item) => item.value);

          const rejected = settled.filter((item) => item.status === 'rejected');

          if (!groups.length && rejected.length) {
            throw rejected[0].reason;
          }

          posts = mergePostsByCreatedAtDesc(groups, 50);
        }
      } else {
        if (!currentBoard) {
          const fallbackBoardId = normalizeText(selectedId);
          const fallbackLimit = isCalendarBoardId(fallbackBoardId) ? 320 : 50;
          posts = await queryPostsForBoard(fallbackBoardId, fallbackLimit, {
            allowLooseFallback: true,
            boardName: fallbackBoardId
          });
        } else if (!canUseBoard(currentBoard)) {
          setVisiblePosts([]);
          setListMessage({ type: 'error', text: '선택한 게시판을 읽을 권한이 없습니다.' });
          setLoadingPosts(false);
          return;
        } else {
          const boardPostLimit = isCalendarBoardId(currentBoard.id) ? 320 : 50;
          posts = await queryPostsForBoard(currentBoard.id, boardPostLimit, {
            allowLooseFallback: true,
            boardName: currentBoard.name || ''
          });
        }
      }
    } catch (err) {
      if (requestId !== postsLoadRequestRef.current) return;
      setVisiblePosts([]);
      setListMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 조회 실패') });
      setLoadingPosts(false);
      return;
    }

    if (requestId !== postsLoadRequestRef.current) return;

    const nextVisiblePosts = getVisiblePosts(posts);
    setVisiblePosts(nextVisiblePosts);

    if (!nextVisiblePosts.length) {
      setListMessage({ type: 'notice', text: '게시글이 없습니다.' });
      setLoadingPosts(false);
      return;
    }

    setListMessage({ type: '', text: '' });
    setLoadingPosts(false);
  }, [boardList, canUseBoard, currentBoard, currentUserProfile, hydrateCommentCounts, selectedBoardId]);

  useEffect(() => {
    if (!ready || !currentUserProfile) return;
    loadPostsForCurrentBoard().catch(() => {});
  }, [ready, currentUserProfile, selectedBoardId, boardList, loadPostsForCurrentBoard]);

  useEffect(() => {
    if (!ready || !currentUserProfile) return () => {};

    const targetBoardId = normalizeText(selectedBoardId);
    if (!targetBoardId || targetBoardId === ALL_BOARD_ID) return () => {};
    if (!isCalendarBoardId(targetBoardId)) return () => {};
    if (currentBoard && !canUseBoard(currentBoard)) return () => {};

    let cancelled = false;
    const unsubscribe = appFirestore.subscribePostsByBoard({
      boardId: targetBoardId,
      onNext: (snap) => {
        if (cancelled) return;

        const posts = snap.docs.map((row) => ({ id: row.id, ...row.data() }));
        const nextVisiblePosts = getVisiblePosts(posts);
        setVisiblePosts(nextVisiblePosts);

        if (!nextVisiblePosts.length) {
          setListMessage({ type: 'notice', text: '게시글이 없습니다.' });
          setLoadingPosts(false);
          return;
        }

        setListMessage({ type: '', text: '' });
        setLoadingPosts(false);
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[calendar-board-realtime-subscribe-failed]', err, {
          error: err,
          uid: currentUserUid,
          boardId: targetBoardId
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canUseBoard, currentBoard, currentUserProfile, currentUserUid, ready, selectedBoardId]);

  useEffect(() => {
    if (!ready || !currentUserUid || !currentUserProfile || !boardList.length) return () => {};

    const boardById = new Map(
      boardList.map((board) => [normalizeText(board?.id), board])
    );

    const unsubscribe = appFirestore.subscribeRecentPosts({
      maxItems: 120,
      onNext: (snap) => {
      const previousSeen = knownRealtimePostIdsRef.current;
      const nextSeen = new Set();

      snap.docs.forEach((row) => {
        const post = { id: row.id, ...row.data() };
        if (isDeletedPost(post)) return;

        const postId = normalizeText(post.id);
        if (!postId) return;
        nextSeen.add(postId);

        const isRealtimeNew = realtimePostsReadyRef.current && !previousSeen.has(postId);
        if (!isRealtimeNew) return;

        const boardId = normalizeText(post.boardId);
        const board = boardById.get(boardId) || null;
        if (!board) return;
        if (normalizeText(post.authorUid) === currentUserUid) return;
        if (notificationPrefsRef.current[boardId] === false) return;

        appendNotification({
          notificationId: `post:${postId}`,
          postId,
          boardId,
          boardName: normalizeText(board.name) || boardId,
          type: NOTIFICATION_TYPE.POST,
          subtype: NOTIFICATION_SUBTYPE.POST_CREATE,
          title: normalizeText(post.title) || '(제목 없음)',
          actorUid: normalizeText(post.authorUid),
          actorName: normalizeText(post.authorName || post.authorUid) || '익명',
          body: '',
          createdAtMs: toMillis(post.createdAt) || Date.now()
        });
      });

      knownRealtimePostIdsRef.current = nextSeen;
      realtimePostsReadyRef.current = true;
      },
      onError: (err) => {
        console.error('[post-notification-realtime-failed]', err);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [boardList, currentUserProfile, currentUserUid, ready]);

  useEffect(() => {
    if (!ready || !currentUserUid || !boardList.length) {
      setRecentComments([]);
      setRecentCommentsLoading(false);
      return () => {};
    }

    // Recent comments are rendered from a cross-board view.
    // Build both strict-id and loose-identity maps because legacy posts may store board references
    // with different casing/name formats.
    setRecentCommentsLoading(true);
    const boardById = new Map(
      boardList.map((board) => [normalizeText(board?.id), board])
    );
    const boardByIdentity = new Map();
    boardList.forEach((board) => {
      const boardId = normalizeText(board?.id);
      const boardName = normalizeText(board?.name);
      boardIdentityCandidates(boardId, boardName).forEach((candidate) => {
        const key = normalizeBoardIdentity(candidate);
        if (!key) return;
        if (!boardByIdentity.has(key)) {
          boardByIdentity.set(key, board);
        }
      });
    });
    const resolveBoardForPost = (post) => {
      // Try loose identity matching first, then fall back to strict boardId lookup.
      const candidates = postBoardIdentityCandidates(post);
      for (let idx = 0; idx < candidates.length; idx += 1) {
        const key = normalizeBoardIdentity(candidates[idx]);
        if (!key) continue;
        const matched = boardByIdentity.get(key);
        if (matched) return matched;
      }
      return boardById.get(normalizeText(post?.boardId)) || null;
    };

    let cancelled = false;
    let fallbackToken = 0;
    const parseRowsFromSnapshot = (snap) => {
      return snap.docs
        .map((row) => {
          const data = row.data() || {};
          const postId = normalizeText(row.ref?.parent?.parent?.id);
          const commentId = normalizeText(row.id);
          if (!postId || !commentId) return null;

          return {
            postId,
            commentId,
            createdAt: data.createdAt || null,
            createdAtMs: numberOrZero(data.createdAtMs),
            updatedAt: data.updatedAt || null,
            contentText: normalizeText(
              data.contentText
              || data.contentRich?.text
              || data.content
              || data.body
              || ''
            ),
            authorName: normalizeText(data.authorName || data.authorUid || '')
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aMs = a.createdAtMs || toMillis(a.createdAt) || toMillis(a.updatedAt);
          const bMs = b.createdAtMs || toMillis(b.createdAt) || toMillis(b.updatedAt);
          return bMs - aMs;
        });
    };
    const requestFallbackRows = async () => {
      // Fallback path when ordered query returns empty/error due to legacy timestamps/index gaps.
      try {
        const fallbackSnap = await appFirestore.fetchRecentCommentsFallback({
          maxItems: Math.max(120, RECENT_COMMENT_FETCH_LIMIT * 4)
        });
        return parseRowsFromSnapshot(fallbackSnap);
      } catch (err) {
        console.error('[recent-comments-fallback-fetch-failed]', err);
        return [];
      }
    };

    const applyRows = (rows) => {
      // Resolve post metadata in batch, then keep only top N rows that map to readable posts.
      const uniquePostIds = [...new Set(rows.map((item) => item.postId))];
      Promise.all(uniquePostIds.map(async (postId) => {
        try {
          const postSnap = await appFirestore.fetchPostDoc(postId);
          if (!postSnap.exists()) return [postId, null];
          return [postId, { id: postSnap.id, ...postSnap.data() }];
        } catch (_) {
          return [postId, null];
        }
      }))
        .then((pairs) => {
          if (cancelled) return;

          const postById = new Map(pairs);
          const nextItems = [];

          rows.forEach((row) => {
            if (nextItems.length >= RECENT_COMMENT_MAX_ITEMS) return;

            const post = postById.get(row.postId);
            if (!post || isDeletedPost(post)) return;

            const board = resolveBoardForPost(post);
            const fallbackBoardId = normalizeText(post?.boardId || post?.board || post?.boardName);
            const boardId = normalizeText(board?.id) || fallbackBoardId;
            const boardName = normalizeText(board?.name) || boardId || '게시판';
            if (!boardId) return;

            nextItems.push({
              key: `${row.postId}:${row.commentId}`,
              postId: row.postId,
              commentId: row.commentId,
              boardId,
              boardName,
              postTitle: normalizeText(post.title) || '(제목 없음)',
              preview: buildRecentCommentPreview(row.contentText),
              authorName: row.authorName || '익명',
              createdAt: row.createdAt || row.updatedAt || null,
              createdAtMs: row.createdAtMs || toMillis(row.createdAt) || toMillis(row.updatedAt)
            });
          });

          nextItems.sort((a, b) => b.createdAtMs - a.createdAtMs);
          setRecentComments(nextItems);
          setRecentCommentsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setRecentComments([]);
          setRecentCommentsLoading(false);
        });
    };

    const unsubscribe = appFirestore.subscribeRecentComments({
      maxItems: RECENT_COMMENT_FETCH_LIMIT,
      onNext: (snap) => {
        const rows = parseRowsFromSnapshot(snap);
        if (rows.length) {
          applyRows(rows);
          return;
        }

        fallbackToken += 1;
        const token = fallbackToken;
        requestFallbackRows()
          .then((fallbackRows) => {
            if (cancelled || token !== fallbackToken) return;
            if (!fallbackRows.length) {
              setRecentComments([]);
              setRecentCommentsLoading(false);
              return;
            }
            applyRows(fallbackRows);
          })
          .catch(() => {
            if (cancelled || token !== fallbackToken) return;
            setRecentComments([]);
            setRecentCommentsLoading(false);
          });
      },
      onError: (err) => {
        console.error('[recent-comments-realtime-failed]', err);
        if (cancelled) return;

        fallbackToken += 1;
        const token = fallbackToken;
        requestFallbackRows()
          .then((fallbackRows) => {
            if (cancelled || token !== fallbackToken) return;
            if (!fallbackRows.length) {
              setRecentComments([]);
              setRecentCommentsLoading(false);
              return;
            }
            applyRows(fallbackRows);
          })
          .catch(() => {
            if (cancelled || token !== fallbackToken) return;
            setRecentComments([]);
            setRecentCommentsLoading(false);
          });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [boardList, currentUserUid, ready]);

  useEffect(() => {
    setCurrentPage(1);
  }, [postListViewMode, selectedBoardId]);

  useEffect(() => {
    setSelectedPinPostIdMap({});
  }, [visiblePosts]);

  useEffect(() => {
    if (canManagePinInCurrentBoard) return;
    setSelectedPinPostIdMap({});
  }, [canManagePinInCurrentBoard]);

  useEffect(() => {
    const nextTotalPages = Math.max(1, Math.ceil(listedPosts.length / POSTS_PER_PAGE));
    setCurrentPage((prev) => Math.min(prev, nextTotalPages));
  }, [listedPosts.length]);

  useEffect(() => {
    if (loadingPosts || !currentPagePosts.length) return;
    const requestId = postsLoadRequestRef.current;
    hydrateCommentCounts(currentPagePosts, requestId).catch(() => {});
  }, [currentPagePosts, hydrateCommentCounts, loadingPosts]);

  const closeComposer = useCallback(() => {
    closeComposerMentionMenu();
    setComposerVenueInputFocusIndex(-1);
    setComposerOpen(false);
  }, [closeComposerMentionMenu]);

  const resetComposer = useCallback((targetBoard = null) => {
    const board = targetBoard || currentBoard;
    const todayKey = toDateKey(new Date()) || toDateKey(todayDate);
    setPostTitle('');
    setComposerMessage({ type: '', text: '' });
    if (board && normalizeText(board.id) === COVER_FOR_BOARD_ID) {
      setComposerCoverDateKeys(todayKey ? [todayKey] : []);
      setComposerCoverStartTimeValues([COVER_FOR_DEFAULT_START_TIME]);
      setComposerCoverEndTimeValues([COVER_FOR_DEFAULT_END_TIME]);
      setComposerCoverVenueValues([coverVenueDefault]);
      setComposerCoverVenueCustomModes([false]);
      setComposerVenueInputFocusIndex(-1);
    } else {
      setComposerCoverDateKeys([]);
      setComposerCoverStartTimeValues([]);
      setComposerCoverEndTimeValues([]);
      setComposerCoverVenueValues([]);
      setComposerCoverVenueCustomModes([]);
      setComposerVenueInputFocusIndex(-1);
    }

    const editor = editorRef.current;
    if (editor) {
      editor.setPayload({ text: '', runs: [] });
    }
    closeComposerMentionMenu();
  }, [closeComposerMentionMenu, coverVenueDefault, currentBoard, todayDate]);

  const openComposer = useCallback(() => {
    if (isAllBoardSelected) {
      alert('글쓰기는 개별 게시판에서만 가능합니다. 햄버거 버튼에서 게시판을 선택해주세요.');
      return;
    }

    if (!currentBoard || !canWriteBoard(currentBoard)) {
      alert('선택한 게시판에 글 작성 권한이 없습니다.');
      return;
    }

    resetComposer(currentBoard);
    setComposerOpen(true);
  }, [canWriteBoard, currentBoard, isAllBoardSelected, resetComposer]);

  useEffect(() => {
    if (composerOpen) return;
    setComposerDatePickerOpen(false);
    setComposerDatePickerTargetIndex(-1);
    setComposerVenueInputFocusIndex(-1);
  }, [composerOpen]);

  useEffect(() => {
    if (!composerOpen) {
      closeComposerMentionMenu();
      return () => {};
    }
    return () => {};
  }, [closeComposerMentionMenu, composerOpen]);

  useEffect(() => {
    if (!composerMentionMenu.open) return () => {};

    const onKeyDown = (event) => {
      if (!composerMentionMenu.open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeComposerMentionMenu();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setComposerMentionActiveIndex((prev) => {
          if (!composerMentionCandidates.length) return 0;
          return (prev + 1) % composerMentionCandidates.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setComposerMentionActiveIndex((prev) => {
          if (!composerMentionCandidates.length) return 0;
          return (prev - 1 + composerMentionCandidates.length) % composerMentionCandidates.length;
        });
        return;
      }

      if (event.key === 'Enter' && composerMentionCandidates.length) {
        event.preventDefault();
        event.stopPropagation();
        const target = composerMentionCandidates[composerMentionActiveIndex] || composerMentionCandidates[0];
        applyComposerMentionCandidate(target);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [
    applyComposerMentionCandidate,
    closeComposerMentionMenu,
    composerMentionActiveIndex,
    composerMentionCandidates,
    composerMentionMenu.open
  ]);

  const addComposerCoverDate = useCallback(() => {
    setComposerCoverDateKeys((prevDates) => {
      if (prevDates.length >= COVER_FOR_MAX_DATES) return prevDates;
      const todayKey = normalizeDateKeyInput(toDateKey(new Date())) || normalizeDateKeyInput(toDateKey(todayDate));
      if (!todayKey) return prevDates;

      const nextDates = [...prevDates, todayKey];
      setComposerCoverStartTimeValues((prevStartTimes) => {
        const normalizedStart = normalizeCoverForTimeValues(prevStartTimes, prevDates.length, COVER_FOR_DEFAULT_START_TIME);
        return [...normalizedStart, COVER_FOR_DEFAULT_START_TIME];
      });
      setComposerCoverEndTimeValues((prevEndTimes) => {
        const normalizedEnd = normalizeCoverForTimeValues(prevEndTimes, prevDates.length, COVER_FOR_DEFAULT_END_TIME);
        return [...normalizedEnd, COVER_FOR_DEFAULT_END_TIME];
      });
      setComposerCoverVenueValues((prevVenues) => {
        const normalizedVenues = normalizeCoverForVenueValues(prevVenues, prevDates.length, coverVenueDefault, { allowEmpty: true });
        return [...normalizedVenues, coverVenueDefault];
      });
      setComposerCoverVenueCustomModes((prevModes) => {
        const source = Array.isArray(prevModes) ? prevModes : [];
        const normalizedModes = [];
        for (let idx = 0; idx < prevDates.length; idx += 1) {
          normalizedModes.push(Boolean(source[idx]));
        }
        return [...normalizedModes, false];
      });
      return nextDates;
    });
  }, [coverVenueDefault, todayDate]);

  const removeComposerCoverDate = useCallback((index) => {
    setComposerCoverDateKeys((prevDates) => {
      if (prevDates.length <= 1) return prevDates;
      if (index < 0 || index >= prevDates.length) return prevDates;
      const nextDates = prevDates.filter((_, idx) => idx !== index);
      setComposerCoverStartTimeValues((prevStartTimes) => {
        const normalizedStart = normalizeCoverForTimeValues(prevStartTimes, prevDates.length, COVER_FOR_DEFAULT_START_TIME);
        return normalizedStart.filter((_, idx) => idx !== index);
      });
      setComposerCoverEndTimeValues((prevEndTimes) => {
        const normalizedEnd = normalizeCoverForTimeValues(prevEndTimes, prevDates.length, COVER_FOR_DEFAULT_END_TIME);
        return normalizedEnd.filter((_, idx) => idx !== index);
      });
      setComposerCoverVenueValues((prevVenues) => {
        const normalizedVenues = normalizeCoverForVenueValues(prevVenues, prevDates.length, coverVenueDefault, { allowEmpty: true });
        return normalizedVenues.filter((_, idx) => idx !== index);
      });
      setComposerCoverVenueCustomModes((prevModes) => {
        const source = Array.isArray(prevModes) ? prevModes : [];
        const normalizedModes = [];
        for (let idx = 0; idx < prevDates.length; idx += 1) {
          normalizedModes.push(Boolean(source[idx]));
        }
        return normalizedModes.filter((_, idx) => idx !== index);
      });
      return nextDates;
    });
  }, [coverVenueDefault]);

  const updateComposerCoverDate = useCallback((index, nextValue) => {
    setComposerCoverDateKeys((prevDates) => {
      if (index < 0 || index >= prevDates.length) return prevDates;
      const next = [...prevDates];
      const normalized = normalizeDateKeyInput(nextValue);
      next[index] = normalized || next[index] || normalizeDateKeyInput(toDateKey(todayDate));
      return next;
    });
  }, [todayDate]);

  const updateComposerCoverStartTime = useCallback((index, nextValue) => {
    const normalizedStart = normalizeTimeInput(nextValue) || COVER_FOR_DEFAULT_START_TIME;
    setComposerCoverStartTimeValues((prevStartTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevStartTimes, maxSize, COVER_FOR_DEFAULT_START_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      next[index] = normalizedStart;
      return next;
    });

    setComposerCoverEndTimeValues((prevEndTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevEndTimes, maxSize, COVER_FOR_DEFAULT_END_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      const currentEnd = normalizeTimeInput(next[index]) || COVER_FOR_DEFAULT_END_TIME;
      next[index] = isValidTimeRange(normalizedStart, currentEnd)
        ? currentEnd
        : suggestEndTime(normalizedStart);
      return next;
    });
  }, [composerCoverDateKeys.length]);

  const updateComposerCoverEndTime = useCallback((index, nextValue) => {
    setComposerCoverEndTimeValues((prevEndTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevEndTimes, maxSize, COVER_FOR_DEFAULT_END_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      next[index] = normalizeTimeInput(nextValue) || COVER_FOR_DEFAULT_END_TIME;
      return next;
    });
  }, [composerCoverDateKeys.length]);

  const updateComposerCoverVenue = useCallback((index, nextValue, options = {}) => {
    const keepRaw = !!options.keepRaw;
    setComposerCoverVenueValues((prevVenues) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForVenueValues(prevVenues, maxSize, coverVenueDefault, { allowEmpty: true });
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      const sanitizedInput = sanitizeCoverForVenueInput(nextValue);
      next[index] = keepRaw
        ? sanitizedInput
        : normalizeCoverForVenue(sanitizedInput);
      return next;
    });
  }, [composerCoverDateKeys.length, coverVenueDefault]);

  const setComposerCoverVenueCustomMode = useCallback((index, enabled) => {
    setComposerCoverVenueCustomModes((prevModes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const source = Array.isArray(prevModes) ? prevModes : [];
      const normalizedModes = [];
      for (let idx = 0; idx < maxSize; idx += 1) {
        normalizedModes.push(Boolean(source[idx]));
      }
      if (index < 0 || index >= normalizedModes.length) return normalizedModes;
      const next = [...normalizedModes];
      next[index] = Boolean(enabled);
      return next;
    });
  }, [composerCoverDateKeys.length]);

  const updateComposerCoverVenueSelect = useCallback((index, nextValue) => {
    const selectedValue = normalizeText(nextValue);
    logCoverVenueDebug('select-change', {
      index,
      selectedValue,
      currentValue: sanitizeCoverForVenueInput(composerCoverVenueValues[index])
    });

    if (selectedValue === COVER_FOR_CUSTOM_VENUE_VALUE) {
      setComposerCoverVenueCustomMode(index, true);
      const currentVenueRaw = sanitizeCoverForVenueInput(composerCoverVenueValues[index]);
      const currentVenue = normalizeCoverForVenue(currentVenueRaw);
      const keepCustom = currentVenue && !coverVenueOptions.includes(currentVenue)
        ? currentVenueRaw
        : '';
      updateComposerCoverVenue(index, keepCustom, { keepRaw: true });
      logCoverVenueDebug('select-custom-mode', {
        index,
        keepCustom
      });

      window.setTimeout(() => {
        const inputEl = composerVenueInputRefs.current[index];
        if (!inputEl) {
          logCoverVenueDebug('focus-miss', { index });
          return;
        }
        inputEl.focus();
        setComposerVenueInputFocusIndex(index);
        logCoverVenueDebug('focus-applied', {
          index,
          activeTag: String(document?.activeElement?.tagName || ''),
          activeClass: String(document?.activeElement?.className || '')
        });
      }, 40);
      return;
    }
    setComposerCoverVenueCustomMode(index, false);
    updateComposerCoverVenue(index, selectedValue);
    logCoverVenueDebug('select-regular-mode', {
      index,
      selectedValue
    });
  }, [
    composerCoverVenueValues,
    composerVenueInputRefs,
    coverVenueOptions,
    setComposerCoverVenueCustomMode,
    updateComposerCoverVenue
  ]);

  const openComposerDatePicker = useCallback((index) => {
    const normalizedIndex = Number(index);
    if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0) return;
    const selectedKey = normalizeDateKeyInput(composerCoverDateKeys[normalizedIndex]) || toDateKey(todayDate);
    const selectedDate = fromDateKey(selectedKey) || todayDate;
    setComposerDatePickerTargetIndex(normalizedIndex);
    setComposerDatePickerCursor(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    composerDatePickerOpenedAtRef.current = Date.now();
    setComposerDatePickerOpen(true);
  }, [composerCoverDateKeys, todayDate]);

  const closeComposerDatePicker = useCallback((options = {}) => {
    const source = normalizeText(options?.source);
    if (source === 'backdrop') {
      const openedAt = Number(composerDatePickerOpenedAtRef.current) || 0;
      if (Date.now() - openedAt < 320) return;
    }
    setComposerDatePickerOpen(false);
    setComposerDatePickerTargetIndex(-1);
    composerDatePickerOpenedAtRef.current = 0;
  }, []);

  const submitPost = useCallback(async (event) => {
    event.preventDefault();

    if (!currentUser || !currentUserProfile) {
      setComposerMessage({ type: 'error', text: '로그인 정보가 만료되었습니다. 다시 로그인해주세요.' });
      return;
    }

    if (!currentBoard || !canWriteBoard(currentBoard)) {
      setComposerMessage({ type: 'error', text: '선택한 게시판에 접근할 수 없습니다.' });
      return;
    }

    const editor = editorRef.current;
    const payload = editor ? editor.getPayload() : { text: '', runs: [] };
    const delta = editor?.getDelta?.() || { ops: [{ insert: '\n' }] };
    const cleanTitle = normalizeText(postTitle);
    const isCoverRequestBoard = normalizeText(currentBoard.id) === COVER_FOR_BOARD_ID;
    const coverEntryCompositeValues = isCoverRequestBoard
      ? normalizeCoverForDateTimeEntries(
        composerCoverDateKeys,
        composerCoverStartTimeValues,
        composerCoverEndTimeValues,
        composerCoverVenueValues,
        '',
        COVER_FOR_DEFAULT_START_TIME,
        COVER_FOR_DEFAULT_END_TIME,
        coverVenueDefault
      ).map((entry) => {
        const venue = normalizeCoverForVenue(entry.venue);
        return `${entry.dateKey}|${entry.startTimeValue}|${entry.endTimeValue}|${venue}`;
      })
      : [];
    const duplicateCoverEntryValues = isCoverRequestBoard
      ? [...new Set(
        coverEntryCompositeValues.filter((entryValue, idx) => coverEntryCompositeValues.indexOf(entryValue) !== idx)
      )]
      : [];
    const coverDateFallbackKey = toDateKey(new Date()) || toDateKey(todayDate);
    const nextCoverDateTimeEntries = isCoverRequestBoard
      ? normalizeCoverForDateTimeEntries(
        composerCoverDateKeys,
        composerCoverStartTimeValues,
        composerCoverEndTimeValues,
        composerCoverVenueValues,
        coverDateFallbackKey,
        COVER_FOR_DEFAULT_START_TIME,
        COVER_FOR_DEFAULT_END_TIME,
        coverVenueDefault
      )
      : [];
    const nextCoverDateKeys = nextCoverDateTimeEntries.map((entry) => entry.dateKey);
    const nextCoverStartTimeValues = nextCoverDateTimeEntries.map((entry) => entry.startTimeValue);
    const nextCoverEndTimeValues = nextCoverDateTimeEntries.map((entry) => entry.endTimeValue);
    const nextCoverVenueValues = nextCoverDateTimeEntries.map((entry) => normalizeCoverForVenue(entry.venue));

    if (!cleanTitle) {
      setComposerMessage({ type: 'error', text: '제목을 입력해주세요.' });
      return;
    }

    if (!normalizeText(payload.text)) {
      setComposerMessage({ type: 'error', text: '본문을 입력해주세요.' });
      return;
    }

    if (isCoverRequestBoard && duplicateCoverEntryValues.length) {
      const duplicateDateText = duplicateCoverEntryValues
        .map((entryValue) => {
          const [dateKey = '', startTimeValue = '', endTimeValue = '', venue = ''] = String(entryValue).split('|');
          return `${formatDateKeyLabel(dateKey)} ${startTimeValue}~${endTimeValue} [${venue}]`;
        })
        .join(', ');
      setComposerMessage({
        type: 'error',
        text: `동일한 날짜/시간/체험관 조합은 1번만 등록할 수 있습니다. 중복 항목: ${duplicateDateText}`
      });
      return;
    }

    if (isCoverRequestBoard && !nextCoverDateKeys.length) {
      setComposerMessage({ type: 'error', text: '캘린더 게시판 일정 날짜를 최소 1개 선택해주세요.' });
      return;
    }

    if (
      isCoverRequestBoard
      && nextCoverDateTimeEntries.some((entry) => !normalizeCoverForVenue(entry.venue))
    ) {
      setComposerMessage({ type: 'error', text: '각 날짜별 체험관을 선택해주세요.' });
      return;
    }

    if (
      isCoverRequestBoard
      && nextCoverDateTimeEntries.some((entry) => !isValidTimeRange(entry.startTimeValue, entry.endTimeValue))
    ) {
      setComposerMessage({ type: 'error', text: '요청 시간은 시작 시간보다 늦은 종료 시간을 선택해주세요.' });
      return;
    }

    closeComposerMentionMenu();
    setSubmittingPost(true);
    setComposerMessage({ type: '', text: '' });

    let createdPostId = '';
    let payloadToCreate = null;
    try {
      payloadToCreate = {
        boardId: currentBoard.id,
        title: cleanTitle,
        visibility: boardAutoVisibility(currentBoard, roleDefMap),
        contentDelta: delta,
        contentText: payload.text,
        contentRich: payload,
        authorUid: currentUser.uid,
        authorName: buildAuthorName(currentUserProfile),
        authorRole: currentUserProfile.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deleted: false,
        views: 0
      };

      if (isCoverRequestBoard) {
        payloadToCreate.coverForStatus = COVER_FOR_STATUS.SEEKING;
        payloadToCreate.coverForDateKeys = nextCoverDateKeys;
        payloadToCreate.coverForDateStatuses = nextCoverDateKeys.map(() => COVER_FOR_STATUS.SEEKING);
        payloadToCreate.coverForStartTimeValues = nextCoverStartTimeValues;
        payloadToCreate.coverForEndTimeValues = nextCoverEndTimeValues;
        payloadToCreate.coverForTimeValues = nextCoverStartTimeValues;
        payloadToCreate.coverForVenueValues = nextCoverVenueValues;
        payloadToCreate.coverForVenue = normalizeCoverForVenue(nextCoverVenueValues[0]) || coverVenueDefault;
      }

      payloadToCreate.isPinned = false;
      payloadToCreate.pinnedAt = null;
      payloadToCreate.pinnedAtMs = 0;
      payloadToCreate.pinnedByUid = '';

      const createdRef = await appFirestore.createPost(payloadToCreate);
      createdPostId = normalizeText(createdRef?.id);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestUserDocExists = false;
        let latestBoardDocExists = false;
        let latestRawRoleExact = '';
        let latestRawRole = '';
        let latestRole = '';
        let latestBoardAllowedRoles = [];
        let latestBoardIsDivider = null;
        let latestCanWriteByClientEval = null;

        try {
          const [latestUserSnap, latestBoardSnap] = await Promise.all([
            appFirestore.fetchUserDoc(currentUser.uid),
            appFirestore.fetchBoardDoc(currentBoard?.id || '')
          ]);

          latestUserDocExists = !!latestUserSnap?.exists?.() && latestUserSnap.exists();
          latestBoardDocExists = !!latestBoardSnap?.exists?.() && latestBoardSnap.exists();

          let latestProfileData = null;
          if (latestUserDocExists) {
            latestProfileData = latestUserSnap.data() || {};
            latestRawRoleExact = String((latestProfileData || {}).role ?? '');
            latestRawRole = normalizeText(latestRawRoleExact);
            latestRole = normalizeRoleKey(latestRawRole, roleDefMap);

            const syncedRawRole = latestRawRole || normalizeText(currentUserProfile.rawRole || currentUserProfile.role);
            const syncedRole = latestRole || normalizeRoleKey(syncedRawRole, roleDefMap);
            const localRawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);
            const localRole = normalizeRoleKey(currentUserProfile.role, roleDefMap);

            if (syncedRawRole !== localRawRole || syncedRole !== localRole) {
              setCurrentUserProfile((prev) => (prev
                ? {
                  ...prev,
                  ...latestProfileData,
                  role: syncedRole,
                  rawRole: syncedRawRole
                }
                : prev));
            }
          }

          if (latestBoardDocExists) {
            const latestBoardData = latestBoardSnap.data() || {};
            latestBoardAllowedRoles = Array.isArray(latestBoardData.allowedRoles) ? latestBoardData.allowedRoles : [];
            latestBoardIsDivider = latestBoardData.isDivider === true;

            const profileForEval = latestUserDocExists
              ? {
                ...currentUserProfile,
                ...(latestProfileData || {}),
                role: latestRole || normalizeRoleKey(normalizeText((latestProfileData || {}).role), roleDefMap),
                rawRole: latestRawRole || normalizeText((latestProfileData || {}).role)
              }
              : currentUserProfile;

            latestCanWriteByClientEval = canWriteBoardWithProfile(
              { id: latestBoardSnap.id, ...latestBoardData },
              profileForEval,
              roleDefMap
            );
          }
        } catch (_) {
          // Keep original permission error when extra debug reads fail.
        }

        const invalidRangeIndexes = nextCoverDateTimeEntries
          .map((entry, idx) => (isValidTimeRange(entry.startTimeValue, entry.endTimeValue) ? '' : String(idx + 1)))
          .filter(Boolean);
        const coverDebugText = isCoverRequestBoard
          ? joinDebugParts([
            `coverDateCount=${nextCoverDateKeys.length}`,
            `coverDates=${debugValueList(nextCoverDateKeys)}`,
              `coverStarts=${debugValueList(nextCoverStartTimeValues)}`,
              `coverEnds=${debugValueList(nextCoverEndTimeValues)}`,
              `coverVenues=${debugValueList(nextCoverVenueValues)}`,
              `invalidRanges=${invalidRangeIndexes.length ? invalidRangeIndexes.join(',') : '-'}`
            ])
          : '';
        const latestDebugText = joinDebugParts([
          `localCanWrite=${canWriteBoardWithProfile(currentBoard, currentUserProfile, roleDefMap) ? 'yes' : 'no'}`,
          `payloadBoardId=${normalizeText(payloadToCreate?.boardId) || '-'}`,
          `payloadAuthorUid=${normalizeText(payloadToCreate?.authorUid) || '-'}`,
          `payloadAuthorUidMatchesAuth=${normalizeText(payloadToCreate?.authorUid) === normalizeText(currentUser?.uid) ? 'yes' : 'no'}`,
          `payloadDeleted=${String(payloadToCreate?.deleted)}`,
          `payloadDeletedType=${typeof payloadToCreate?.deleted}`,
          `payloadCoverStatus=${normalizeText(payloadToCreate?.coverForStatus) || '-'}`,
          `payloadCoverVenue=${normalizeText(payloadToCreate?.coverForVenue) || '-'}`,
          `latestUserDoc=${latestUserDocExists ? 'exists' : 'missing'}`,
          `latestMyRole=${latestRole || '-'}`,
          `latestMyRawRole=${latestRawRole || '-'}`,
          `latestMyRawRoleHex=${debugCodePoints(latestRawRoleExact)}`,
          `latestBoardDoc=${latestBoardDocExists ? 'exists' : 'missing'}`,
          `latestBoardAllowedRoles=${debugValueList(latestBoardAllowedRoles)}`,
          `latestBoardIsDivider=${latestBoardIsDivider == null ? '-' : String(latestBoardIsDivider)}`,
          `latestCanWrite=${latestCanWriteByClientEval == null ? '-' : (latestCanWriteByClientEval ? 'yes' : 'no')}`
        ]);
        const debugText = joinDebugParts([
          'action=post-create',
          'errorStage=post-add',
          boardPermissionDebugText(currentBoard, currentUserProfile),
          coverDebugText,
          latestDebugText,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[post-create-permission-debug]', err, {
          error: err,
          boardId: currentBoard?.id || '',
          boardName: currentBoard?.name || '',
          allowedRoles: Array.isArray(currentBoard?.allowedRoles) ? currentBoard.allowedRoles : [],
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          userRawRoleHex: debugCodePoints(currentUserProfile?.rawRole || currentUserProfile?.role || ''),
          localCanWrite: canWriteBoardWithProfile(currentBoard, currentUserProfile, roleDefMap),
          latestUserDocExists,
          latestRole,
          latestRawRole,
          latestRawRoleHex: debugCodePoints(latestRawRoleExact),
          latestBoardDocExists,
          latestBoardAllowedRoles,
          latestBoardIsDivider,
          latestCanWriteByClientEval,
          payloadBoardId: normalizeText(payloadToCreate?.boardId),
          payloadAuthorUid: normalizeText(payloadToCreate?.authorUid),
          payloadAuthorUidMatchesAuth: normalizeText(payloadToCreate?.authorUid) === normalizeText(currentUser?.uid),
          payloadDeleted: payloadToCreate?.deleted,
          payloadDeletedType: typeof payloadToCreate?.deleted,
          payloadCoverStatus: normalizeText(payloadToCreate?.coverForStatus),
          payloadCoverVenue: normalizeText(payloadToCreate?.coverForVenue),
          payloadCoverVenueValues: Array.isArray(payloadToCreate?.coverForVenueValues) ? payloadToCreate.coverForVenueValues : [],
          createdPostId,
          coverForDateKeys: nextCoverDateKeys,
          coverForStartTimeValues: nextCoverStartTimeValues,
          coverForEndTimeValues: nextCoverEndTimeValues,
          coverForVenueValues: nextCoverVenueValues,
          invalidRangeIndexes,
          debugText
        });
        setComposerMessage({
          type: 'error',
          text: normalizeErrMessage(err, '저장 실패')
        });
        setSubmittingPost(false);
        return;
      }
      setComposerMessage({ type: 'error', text: normalizeErrMessage(err, '저장 실패') });
      setSubmittingPost(false);
      return;
    }

    if (createdPostId && pushRelayConfigured() && typeof currentUser?.getIdToken === 'function') {
      void (async () => {
        try {
          const idToken = normalizeText(await currentUser.getIdToken());
          if (!idToken) return;
          await sendPushRelayPostCreate({
            idToken,
            postId: createdPostId,
            boardId: normalizeText(currentBoard?.id),
            createdAtMs: Date.now()
          });
        } catch (relayErr) {
          logErrorWithOptionalDebug('[post-create-push-relay-dispatch-failed]', relayErr, {
            error: relayErr,
            postId: createdPostId,
            boardId: normalizeText(currentBoard?.id)
          });
        }
      })();
    }

    resetComposer(currentBoard);
    closeComposer();

    try {
      await loadPostsForCurrentBoard();
    } catch (err) {
      logErrorWithOptionalDebug('[post-create-list-refresh-failed]', err, {
        error: err,
        boardId: currentBoard?.id || '',
        boardName: currentBoard?.name || '',
        createdPostId
      });
      setListMessage({
        type: 'error',
        text: '게시글은 등록되었지만 목록을 갱신하지 못했습니다. 새로고침 후 확인해주세요.'
      });
    }

    showAppliedPopup('게시글 등록이 완료되었습니다.');
    setSubmittingPost(false);
    return;
  }, [
    canWriteBoard,
    closeComposer,
    currentBoard,
    currentUser,
    currentUserProfile,
    loadPostsForCurrentBoard,
    postTitle,
    composerCoverDateKeys,
    composerCoverStartTimeValues,
    composerCoverEndTimeValues,
    composerCoverVenueValues,
    closeComposerMentionMenu,
    coverVenueDefault,
    resetComposer,
    setListMessage,
    roleDefMap,
    showAppliedPopup,
    todayDate
  ]);

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
    writeRememberedBoardId(selectedBoardId);
  }, [selectedBoardId]);

  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  useEffect(() => {
    let active = true;
    getWebPushCapability().then((result) => {
      if (!active) return;
      setMobilePushCapability(result);
    }).catch((err) => {
      if (!active) return;
      setMobilePushCapability({
        supported: false,
        reason: err?.message || '모바일 알림 지원 여부를 확인하지 못했습니다.',
        reasonCode: 'check-failed'
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUserUid) {
      setVenueOptions(DEFAULT_COVER_FOR_VENUE_OPTIONS);
      return () => {};
    }

    const unsubscribe = appFirestore.subscribeVenueOptions({
      maxItems: 120,
      onNext: (snap) => {
      const options = snap.docs
        .map((row) => {
          const data = row.data() || {};
          return {
            label: normalizeCoverForVenue(data.label || data.name || row.id),
            sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : Number.MAX_SAFE_INTEGER
          };
        })
        .filter((item) => !!item.label)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.label.localeCompare(b.label, 'ko');
        })
        .map((item) => item.label);
      setVenueOptions(options.length ? options : DEFAULT_COVER_FOR_VENUE_OPTIONS);
      },
      onError: (err) => {
      logErrorWithOptionalDebug('[venue-option-sync-subscribe-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setVenueOptions(DEFAULT_COVER_FOR_VENUE_OPTIONS);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserUid]);

  useEffect(() => {
    if (!currentUserUid) {
      setViewedPostIdMap({});
      return () => {};
    }

    const unsubscribe = appFirestore.subscribeViewedPosts({
      uid: currentUserUid,
      maxItems: 2000,
      onNext: (snap) => {
      const nextMap = {};
      snap.docs.forEach((row) => {
        const postId = normalizeText(row.id || row.data()?.postId);
        if (!postId) return;
        nextMap[postId] = true;
      });
      setViewedPostIdMap(nextMap);
      },
      onError: (err) => {
      logErrorWithOptionalDebug('[viewed-post-sync-subscribe-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setViewedPostIdMap({});
      }
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserUid]);

  useEffect(() => {
    if (!currentUserUid) {
      setMobilePushTokens([]);
      return () => {};
    }

    const unsubscribe = appFirestore.subscribePushTokens({
      uid: currentUserUid,
      maxItems: 24,
      onNext: (snap) => {
      const rows = snap.docs
        .map((row) => {
          const data = row.data() || {};
          const id = normalizeText(row.id);
          const token = normalizeText(data.token);
          if (!id || !token) return null;
          return {
            id,
            token,
            platform: normalizeText(data.platform || 'web') || 'web',
            enabled: data.enabled !== false,
            updatedAtMs: toMillis(data.updatedAt)
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      setMobilePushTokens(rows);
      },
      onError: (err) => {
      logErrorWithOptionalDebug('[push-token-sync-subscribe-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setMobilePushTokens([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserUid]);

  useEffect(() => {
    knownRealtimePostIdsRef.current = new Set();
    realtimePostsReadyRef.current = false;

    if (!currentUserUid) {
      setNotifications([]);
      setNotificationPrefs({});
      setNotificationFeedFilter(NOTIFICATION_FEED_FILTER.ALL);
      return () => {};
    }

    const unsubscribeNotifications = appFirestore.subscribeNotifications({
      uid: currentUserUid,
      maxItems: NOTIFICATION_MAX_ITEMS,
      onNext: (snap) => {
      const normalized = snap.docs
        .map((row) => {
          const data = row.data() || {};
          const id = normalizeText(row.id);
          const postId = normalizeText(data.postId || row.id);
          const boardId = normalizeText(data.boardId);
          if (!id || !postId || !boardId) return null;
          const subtype = normalizeText(data.subtype);
          if (isWorkScheduleShiftAlertNotification({ id, boardId, subtype })) return null;
          return {
            id,
            postId,
            boardId,
            boardName: normalizeText(data.boardName) || boardId,
            title: normalizeText(data.title) || '(제목 없음)',
            type: normalizeNotificationType(data.type),
            subtype,
            actorUid: normalizeText(data.actorUid || ''),
            actorName: normalizeText(data.actorName || data.authorName) || '익명',
            body: normalizeText(data.body || ''),
            commentId: normalizeText(data.commentId || ''),
            createdAtMs: Number(data.createdAtMs) || 0,
            readAtMs: Number(data.readAtMs) || 0
          };
        })
        .filter(Boolean);
      normalized.sort((a, b) => b.createdAtMs - a.createdAtMs);
      setNotifications(normalized.slice(0, NOTIFICATION_MAX_ITEMS));
      },
      onError: (err) => {
      logErrorWithOptionalDebug('[notification-sync-subscribe-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setNotifications([]);
      }
    });

    const unsubscribePrefs = appFirestore.subscribeNotificationPrefs({
      uid: currentUserUid,
      onNext: (snap) => {
      const nextPrefs = {};
      snap.docs.forEach((row) => {
        const data = row.data() || {};
        const boardId = normalizeText(row.id || data.boardId);
        if (!boardId) return;
        nextPrefs[boardId] = data.enabled !== false;
      });
      setNotificationPrefs(nextPrefs);
      },
      onError: (err) => {
      logErrorWithOptionalDebug('[notification-pref-sync-subscribe-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setNotificationPrefs({});
      }
    });

    return () => {
      unsubscribeNotifications();
      unsubscribePrefs();
    };
  }, [currentUserUid]);

  const isBoardNotificationEnabled = useCallback((boardId) => {
    const targetId = normalizeText(boardId);
    if (!targetId) return false;
    return notificationPrefs[targetId] !== false;
  }, [notificationPrefs]);

  const isNotificationTypeEnabled = useCallback((prefKey) => {
    const key = normalizeText(prefKey);
    if (!key) return true;
    return notificationPrefs[key] !== false;
  }, [notificationPrefs]);

  const appendNotification = useCallback(async (payload) => {
    const postId = normalizeText(payload?.postId);
    const boardId = normalizeText(payload?.boardId);
    if (!postId || !boardId || !currentUserUid) return;

    const notificationId = normalizeText(payload?.notificationId || payload?.id) || `post:${postId}`;
    const type = normalizeNotificationType(payload?.type);
    const subtype = normalizeText(payload?.subtype || '');
    if (isWorkScheduleShiftAlertNotification({ id: notificationId, boardId, subtype })) return;
    const createdAtMs = Number(payload?.createdAtMs) || Date.now();
    const nextItem = {
      id: notificationId,
      postId,
      boardId,
      boardName: normalizeText(payload?.boardName) || boardId,
      title: normalizeText(payload?.title) || '(제목 없음)',
      type,
      subtype,
      actorUid: normalizeText(payload?.actorUid || ''),
      actorName: normalizeText(payload?.actorName || payload?.authorName) || '익명',
      body: normalizeText(payload?.body || ''),
      commentId: normalizeText(payload?.commentId || ''),
      createdAtMs,
      readAtMs: 0
    };

    setNotifications((prev) => {
      if (prev.some((item) => item.id === nextItem.id)) return prev;
      const merged = [nextItem, ...prev];
      merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
      return merged.slice(0, NOTIFICATION_MAX_ITEMS);
    });

    try {
      const existing = await appFirestore.fetchNotificationDoc(currentUserUid, notificationId);
      if (existing.exists()) return;
      await appFirestore.upsertNotificationDoc(currentUserUid, notificationId, {
        userUid: currentUserUid,
        actorUid: normalizeText(nextItem.actorUid || currentUserUid),
        postId,
        boardId,
        boardName: nextItem.boardName,
        type,
        subtype,
        title: nextItem.title,
        actorName: nextItem.actorName,
        body: nextItem.body,
        commentId: nextItem.commentId,
        createdAtMs,
        readAtMs: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-sync-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        notificationId
      });
    }
  }, [currentUserUid]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!currentUserUid) return;
    const unreadItems = filteredNotifications
      .filter((item) => !(Number(item?.readAtMs) > 0))
      .map((item) => ({
        id: normalizeText(item?.id)
      }))
      .filter((item) => item.id);
    if (!unreadItems.length) return;

    const now = Date.now();
    const unreadIdSet = new Set(unreadItems.map((item) => item.id));
    setNotifications((prev) => prev.map((item) => (
      unreadIdSet.has(normalizeText(item?.id)) && !(Number(item?.readAtMs) > 0)
        ? { ...item, readAtMs: now }
        : item
    )));

    await Promise.all(
      unreadItems.map(async (item) => {
        try {
          await appFirestore.updateNotificationDoc(currentUserUid, item.id, {
            readAtMs: now,
            readAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          logErrorWithOptionalDebug('[notification-sync-mark-all-read-failed]', err, {
            error: err,
            uid: currentUserUid,
            notificationId: item.id
          });
        }
      })
    );
  }, [currentUserUid, filteredNotifications]);

  const markNotificationRead = useCallback(async (notificationId) => {
    const targetId = normalizeText(notificationId);
    if (!targetId || !currentUserUid) return;
    const now = Date.now();
    setNotifications((prev) => prev.map((item) => (
      item.id === targetId && !(Number(item?.readAtMs) > 0)
        ? { ...item, readAtMs: now }
        : item
    )));

    try {
      await appFirestore.updateNotificationDoc(currentUserUid, targetId, {
        readAtMs: now,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-sync-mark-read-failed]', err, {
        error: err,
        uid: currentUserUid,
        notificationId: targetId
      });
    }
  }, [currentUserUid]);

  const toggleBoardNotification = useCallback(async (boardId) => {
    const targetId = normalizeText(boardId);
    if (!targetId || !currentUserUid) return;
    const nextEnabled = !isBoardNotificationEnabled(targetId);

    setNotificationPrefs((prev) => ({
      ...(prev || {}),
      [targetId]: nextEnabled
    }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, targetId, {
        userUid: currentUserUid,
        boardId: targetId,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-pref-sync-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        boardId: targetId
      });
      setNotificationPrefs((prev) => ({
        ...(prev || {}),
        [targetId]: !nextEnabled
      }));
    }
  }, [currentUserUid, isBoardNotificationEnabled]);

  const toggleNotificationTypePreference = useCallback(async (prefKey) => {
    const targetKey = normalizeText(prefKey);
    if (!targetKey || !currentUserUid) return;
    const nextEnabled = !isNotificationTypeEnabled(targetKey);

    setNotificationPrefs((prev) => ({
      ...(prev || {}),
      [targetKey]: nextEnabled
    }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, targetKey, {
        userUid: currentUserUid,
        boardId: targetKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-pref-type-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        prefKey: targetKey
      });
      setNotificationPrefs((prev) => ({
        ...(prev || {}),
        [targetKey]: !nextEnabled
      }));
    }
  }, [currentUserUid, isNotificationTypeEnabled]);

  const isMobilePushBoardEnabled = useCallback((boardId) => {
    const key = mobilePushBoardPrefKey(boardId);
    if (!key) return false;
    return notificationPrefs[key] !== false;
  }, [notificationPrefs]);

  const toggleMobilePushBoardPreference = useCallback(async (boardId) => {
    const boardKey = normalizeText(boardId);
    const prefKey = mobilePushBoardPrefKey(boardKey);
    if (!currentUserUid || !boardKey || !prefKey) return;
    const nextEnabled = !isMobilePushBoardEnabled(boardKey);

    setNotificationPrefs((prev) => ({
      ...(prev || {}),
      [prefKey]: nextEnabled
    }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, prefKey, {
        userUid: currentUserUid,
        boardId: prefKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-pref-board-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        boardId: boardKey,
        prefKey
      });
      setNotificationPrefs((prev) => ({
        ...(prev || {}),
        [prefKey]: !nextEnabled
      }));
    }
  }, [currentUserUid, isMobilePushBoardEnabled]);

  const setMobilePushGlobalPreference = useCallback(async (enabled) => {
    if (!currentUserUid) return;
    const nextEnabled = enabled !== false;
    setNotificationPrefs((prev) => ({
      ...(prev || {}),
      [MOBILE_PUSH_PREF_KEY.GLOBAL]: nextEnabled
    }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, MOBILE_PUSH_PREF_KEY.GLOBAL, {
        userUid: currentUserUid,
        boardId: MOBILE_PUSH_PREF_KEY.GLOBAL,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-pref-global-write-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setNotificationPrefs((prev) => ({
        ...(prev || {}),
        [MOBILE_PUSH_PREF_KEY.GLOBAL]: !nextEnabled
      }));
      throw err;
    }
  }, [currentUserUid]);

  const refreshMobilePushCapability = useCallback(async () => {
    const capability = await getWebPushCapability();
    setMobilePushCapability(capability);
  }, []);

  const enableMobilePush = useCallback(async () => {
    if (!currentUserUid) return;
    setMobilePushWorking(true);
    setMobilePushStatus({ type: '', text: '' });

    try {
      const capability = await getWebPushCapability();
      setMobilePushCapability(capability);
      if (!capability.supported) {
        setMobilePushStatus({ type: 'error', text: capability.reason || '모바일 알림을 지원하지 않는 환경입니다.' });
        return;
      }

      const tokenResult = await requestWebPushToken({ serviceWorkerPath: WEB_PUSH_SW_PATH });
      if (!tokenResult.ok) {
        setMobilePushStatus({
          type: 'error',
          text: tokenResult.reason || '알림 권한 또는 토큰 발급에 실패했습니다.'
        });
        return;
      }

      const token = normalizeText(tokenResult.token);
      const tokenId = buildPushTokenDocId(token);
      if (!tokenId) {
        setMobilePushStatus({ type: 'error', text: '토큰 정보를 확인할 수 없습니다.' });
        return;
      }

      // Keep a single active token per account to prevent duplicate notifications
      // when legacy tokens remain enabled on the same device.
      const staleEnabledTokens = mobilePushTokens.filter((tokenInfo) => (
        tokenInfo?.id
        && tokenInfo.id !== tokenId
        && tokenInfo.enabled !== false
      ));
      if (staleEnabledTokens.length) {
        await Promise.all(staleEnabledTokens.map(async (tokenInfo) => {
          await appFirestore.upsertPushTokenDoc(currentUserUid, tokenInfo.id, {
            userUid: currentUserUid,
            token: normalizeText(tokenInfo.token),
            enabled: false,
            platform: normalizeText(tokenInfo.platform || 'web') || 'web',
            updatedAt: serverTimestamp()
          }, { merge: true });
        }));
      }

      await appFirestore.upsertPushTokenDoc(currentUserUid, tokenId, {
        userUid: currentUserUid,
        token,
        enabled: true,
        platform: /android/i.test(navigator.userAgent || '') ? 'android' : (/iphone|ipad|ipod/i.test(navigator.userAgent || '') ? 'ios' : 'web'),
        locale: normalizeText(navigator.language || 'ko-KR').slice(0, 40),
        userAgent: String(navigator.userAgent || '').slice(0, 480),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      }, { merge: true });

      await setMobilePushGlobalPreference(true);
      setMobilePushStatus({ type: 'notice', text: '모바일 알림이 켜졌습니다.' });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-enable-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setMobilePushStatus({ type: 'error', text: normalizeErrMessage(err, '모바일 알림 설정에 실패했습니다.') });
    } finally {
      setMobilePushWorking(false);
    }
  }, [currentUserUid, mobilePushTokens, setMobilePushGlobalPreference]);

  const disableMobilePush = useCallback(async () => {
    if (!currentUserUid) return;
    setMobilePushWorking(true);
    setMobilePushStatus({ type: '', text: '' });

    try {
      await Promise.all(
        mobilePushTokens.map(async (tokenInfo) => {
          if (!tokenInfo?.id) return;
          await appFirestore.upsertPushTokenDoc(currentUserUid, tokenInfo.id, {
            userUid: currentUserUid,
            token: normalizeText(tokenInfo.token),
            enabled: false,
            platform: normalizeText(tokenInfo.platform || 'web') || 'web',
            updatedAt: serverTimestamp()
          }, { merge: true });
        })
      );

      await setMobilePushGlobalPreference(false);
      setMobilePushStatus({ type: 'notice', text: '모바일 알림을 껐습니다.' });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-disable-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setMobilePushStatus({ type: 'error', text: normalizeErrMessage(err, '모바일 알림 해제에 실패했습니다.') });
    } finally {
      setMobilePushWorking(false);
    }
  }, [currentUserUid, mobilePushTokens, setMobilePushGlobalPreference]);

  const handleMovePost = useCallback((postId, postBoardId = '', focusCommentId = '') => {
    const qs = new URLSearchParams();
    qs.set('postId', String(postId || ''));
    const normalizedCommentId = normalizeText(focusCommentId);
    if (normalizedCommentId) {
      qs.set('commentId', normalizedCommentId);
    }

    const normalizedPostBoardId = normalizeText(postBoardId);
    const selectedId = normalizeText(selectedBoardId);
    const rememberedBoardId = readRememberedBoardId();
    const fromBoardId = (selectedId && selectedId !== ALL_BOARD_ID)
      ? selectedId
      : (normalizedPostBoardId || rememberedBoardId);
    const resolvedPostBoardId = normalizedPostBoardId || fromBoardId || rememberedBoardId || ALL_BOARD_ID;
    const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';

    if (resolvedPostBoardId && resolvedPostBoardId !== ALL_BOARD_ID) {
      try {
        // Before entering detail, normalize the current history entry to the resolved board URL.
        // This keeps browser back-navigation aligned with the post's source board.
        const listQs = new URLSearchParams(location.search);
        listQs.set('boardId', resolvedPostBoardId);
        listQs.delete('fromBoardId');
        const nextListUrl = listQs.toString() ? `${appPage}?${listQs.toString()}` : appPage;
        const historyState = (window.history && typeof window.history.state === 'object' && window.history.state)
          ? window.history.state
          : {};
        const historyUsr = (historyState && typeof historyState.usr === 'object' && historyState.usr)
          ? historyState.usr
          : {};
        window.history.replaceState(
          { ...historyState, usr: { ...historyUsr, preferredBoardId: resolvedPostBoardId } },
          '',
          nextListUrl
        );
      } catch (_) {
        // Ignore history replacement failures.
      }
    }

    qs.set('boardId', resolvedPostBoardId);
    if (fromBoardId) qs.set('fromBoardId', fromBoardId);
    writeRememberedBoardId(fromBoardId);

    const postPage = MENTOR_FORUM_CONFIG.app.postPage || '/post';
    navigate(`${postPage}?${qs.toString()}`, {
      state: {
        fromBoardId: fromBoardId || '',
        postBoardId: resolvedPostBoardId || ''
      }
    });
  }, [location.search, navigate, selectedBoardId]);

  const handleSelectBoard = useCallback((nextBoardId) => {
    // Single source of truth for board switching:
    // 1) state update, 2) session remember, 3) URL sync (replace to avoid noisy history stack).
    const normalizedBoardId = normalizeText(nextBoardId) || ALL_BOARD_ID;
    setSelectedBoardId(normalizedBoardId);
    pendingBoardIdRef.current = normalizedBoardId === ALL_BOARD_ID ? '' : normalizedBoardId;

    if (normalizedBoardId !== ALL_BOARD_ID) {
      writeRememberedBoardId(normalizedBoardId);
    }

    const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';
    const listQs = new URLSearchParams(location.search);
    if (normalizedBoardId === ALL_BOARD_ID) {
      listQs.delete('boardId');
    } else {
      listQs.set('boardId', normalizedBoardId);
    }
    listQs.delete('fromBoardId');

    navigate(
      {
        pathname: appPage,
        search: listQs.toString() ? `?${listQs.toString()}` : ''
      },
      {
        replace: true,
        state: normalizedBoardId === ALL_BOARD_ID
          ? {}
          : { preferredBoardId: normalizedBoardId }
      }
    );
  }, [location.search, navigate]);

  const handleMoveHome = useCallback(() => {
    const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';
    navigate(appPage);
  }, [navigate]);

  const handleBrandTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleMoveHome();
  }, [handleMoveHome]);

  const isPostPinSelectionDisabled = useCallback((post) => {
    if (!canManagePinInCurrentBoard || pinActionPending) return true;
    const postId = normalizeText(post?.id);
    if (!postId) return true;
    if (selectedPinPostIdMap[postId]) return false;
    if (!selectedPinMode || selectedPinMode === 'mixed') return false;

    const pinned = isPinnedPost(post);
    return selectedPinMode === 'pinned' ? !pinned : pinned;
  }, [canManagePinInCurrentBoard, pinActionPending, selectedPinMode, selectedPinPostIdMap]);

  const handleTogglePinSelect = useCallback((post, checked) => {
    if (!canManagePinInCurrentBoard) return;
    const normalizedPostId = normalizeText(post?.id);
    if (!normalizedPostId) return;
    const targetPinned = isPinnedPost(post);

    setSelectedPinPostIdMap((prev) => {
      if (!checked) {
        if (!prev[normalizedPostId]) return prev;
        const next = { ...prev };
        delete next[normalizedPostId];
        return next;
      }

      if (prev[normalizedPostId]) return prev;

      let currentMode = '';
      Object.keys(prev).forEach((postId) => {
        if (!prev[postId]) return;
        const selectedPost = visiblePostById.get(postId);
        if (!selectedPost) return;
        currentMode = isPinnedPost(selectedPost) ? 'pinned' : 'unpinned';
      });

      const targetMode = targetPinned ? 'pinned' : 'unpinned';
      if (currentMode && currentMode !== targetMode) return prev;
      return { ...prev, [normalizedPostId]: true };
    });
  }, [canManagePinInCurrentBoard, visiblePostById]);

  const handleBulkPinUpdate = useCallback(async (nextPinned) => {
    if (!canManagePinInCurrentBoard) {
      alert('상단 고정은 개별 게시판에서만 가능합니다.');
      return;
    }

    const targetPostIds = selectedPinPostIds
      .map((postId) => normalizeText(postId))
      .filter(Boolean);

    if (!targetPostIds.length) {
      alert('상단 고정할 게시글을 먼저 선택해주세요.');
      return;
    }

    if (!selectedPinMode || selectedPinMode === 'mixed') {
      alert('같은 상태(고정/일반)의 게시글만 선택해주세요.');
      return;
    }

    if (selectedPinMode === 'unpinned' && !nextPinned) {
      alert('선택한 게시글은 현재 고정되지 않아 고정 해제할 수 없습니다.');
      return;
    }

    if (selectedPinMode === 'pinned' && nextPinned) {
      alert('선택한 게시글은 이미 상단 고정 상태입니다.');
      return;
    }

    setPinActionPending(true);

    const nowMs = Date.now();
    try {
      const results = await Promise.allSettled(targetPostIds.map((postId) => {
        const payload = nextPinned
          ? {
            isPinned: true,
            pinnedAt: serverTimestamp(),
            pinnedAtMs: nowMs,
            pinnedByUid: currentUserUid,
            updatedAt: serverTimestamp()
          }
          : {
            isPinned: false,
            pinnedAt: null,
            pinnedAtMs: 0,
            pinnedByUid: '',
            updatedAt: serverTimestamp()
          };
        return appFirestore.updatePostDoc(postId, payload);
      }));

      const successIds = [];
      const failedIds = [];

      results.forEach((result, index) => {
        const postId = targetPostIds[index];
        if (result.status === 'fulfilled') successIds.push(postId);
        else failedIds.push(postId);
      });

      if (successIds.length) {
        const successIdSet = new Set(successIds);
        setVisiblePosts((prev) => prev.map((post) => {
          const postId = normalizeText(post?.id);
          if (!successIdSet.has(postId)) return post;
          return {
            ...post,
            isPinned: nextPinned,
            pinnedAtMs: nextPinned ? nowMs : 0,
            pinnedAt: nextPinned ? post?.pinnedAt : null,
            pinnedByUid: nextPinned ? currentUserUid : ''
          };
        }));
      }

      setSelectedPinPostIdMap((prev) => {
        if (!successIds.length) return prev;
        const next = { ...prev };
        successIds.forEach((postId) => {
          delete next[postId];
        });
        return next;
      });

      if (!failedIds.length) {
        setPageMessage({
          type: 'notice',
          text: nextPinned
            ? `${successIds.length}개 게시글을 상단 고정했습니다.`
            : `${successIds.length}개 게시글의 상단 고정을 해제했습니다.`
        });
        return;
      }

      setPageMessage({
        type: 'error',
        text: `${successIds.length}개 처리, ${failedIds.length}개 실패했습니다.`
      });
    } catch (err) {
      setPageMessage({
        type: 'error',
        text: normalizeErrMessage(err, nextPinned ? '상단 고정 실패' : '상단 고정 해제 실패')
      });
    } finally {
      setPinActionPending(false);
    }
  }, [canManagePinInCurrentBoard, currentUserUid, selectedPinMode, selectedPinPostIds]);

  const drawerItems = useMemo(() => {
    return [{ id: ALL_BOARD_ID, name: '전체 게시글', isDivider: false }, ...boardNavItems];
  }, [boardNavItems]);

  const composerFabHidden = isAllBoardSelected || !currentBoard || !canWriteBoard(currentBoard);
  const canAccessAdminSite = !!permissions?.canAccessAdminSite;

  const userDisplayName = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUser?.email || '사용자')
    : '사용자';

  const showCurrentBoardAudience = !isAllBoardSelected && !!currentBoard;
  const calendarBoardId = normalizeText(selectedBoardId) || normalizeText(currentBoard?.id);
  const showCoverCalendar = isCalendarBoardId(calendarBoardId);
  const composerIsCoverForBoard = !!currentBoard && normalizeText(currentBoard.id) === COVER_FOR_BOARD_ID;
  const myPostsPage = MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts';
  const myCommentsPage = MENTOR_FORUM_CONFIG.app.myCommentsPage || '/me/comments';

  const coverCalendarMonthLabel = useMemo(() => {
    const firstDay = new Date(coverCalendarCursor.getFullYear(), coverCalendarCursor.getMonth(), 1);
    return firstDay.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  }, [coverCalendarCursor]);

  const composerDatePickerSelectedKey = useMemo(() => {
    if (composerDatePickerTargetIndex < 0 || composerDatePickerTargetIndex >= composerCoverDateKeys.length) {
      return normalizeDateKeyInput(toDateKey(todayDate));
    }
    return normalizeDateKeyInput(composerCoverDateKeys[composerDatePickerTargetIndex]) || normalizeDateKeyInput(toDateKey(todayDate));
  }, [composerCoverDateKeys, composerDatePickerTargetIndex, todayDate]);

  const composerDatePickerSelectedDate = useMemo(() => {
    return fromDateKey(composerDatePickerSelectedKey) || todayDate;
  }, [composerDatePickerSelectedKey, todayDate]);

  const composerDatePickerStartMonth = useMemo(() => {
    return new Date(todayDate.getFullYear() - 15, 0, 1);
  }, [todayDate]);

  const composerDatePickerEndMonth = useMemo(() => {
    return new Date(todayDate.getFullYear() + 15, 11, 1);
  }, [todayDate]);

  useEffect(() => {
    if (showCoverCalendar) return;
    setCoverCalendarModalOpen(false);
    setCoverCalendarModalDateKey('');
  }, [showCoverCalendar]);

  const coverCalendarEventsByDate = useMemo(() => {
    const map = new Map();
    if (!showCoverCalendar) return map;
    const currentUserRealName = normalizeText(currentUserProfile?.realName);

    visiblePosts
      .filter((post) => !isDeletedPost(post) && isCalendarBoardId(post.boardId))
      .forEach((post) => {
        const authorName = normalizeText(post.authorName || post.authorUid) || '익명';
        const tone = buildPastelTone(post.id);
        const boardId = normalizeText(post.boardId);

        if (boardId === WORK_SCHEDULE_BOARD_ID) {
          const rows = normalizeWorkScheduleRows(post?.workScheduleRows);
          rows.forEach((row, rowIndex) => {
            const dateKey = normalizeDateKeyInput(row?.dateKey);
            if (!dateKey) return;

            const summaryLines = buildWorkScheduleSummaryLines(row);
            const eventId = [String(post.id), String(dateKey), 'work_schedule', String(rowIndex)].join('|');
            if (!map.has(dateKey)) map.set(dateKey, []);
            map.get(dateKey).push({
              id: eventId,
              eventId,
              kind: 'work_schedule',
              postId: post.id,
              boardId: post.boardId,
              authorName,
              title: normalizeText(post.title) || '(제목 없음)',
              fullTime: normalizeWorkScheduleMemberText(row?.fullTime),
              part1: normalizeWorkScheduleMemberText(row?.part1),
              part2: normalizeWorkScheduleMemberText(row?.part2),
              part3: normalizeWorkScheduleMemberText(row?.part3),
              education: normalizeWorkScheduleMemberText(row?.education),
              summaryLines,
              label: currentUserRealName && workScheduleRowContainsPersonName(row, currentUserRealName)
                ? '[근무 하는 날]'
                : '',
              tone,
              createdAtMs: toMillis(post.createdAt)
            });
          });
          return;
        }

        const entries = postCoverForDateEntries(post);

        entries.forEach(({ dateKey, status, startTimeValue, endTimeValue, venue }, entryIndex) => {
          if (!dateKey) return;
          if (normalizeCoverForStatus(status) !== COVER_FOR_STATUS.SEEKING) return;
          const safeStartTime = normalizeTimeInput(startTimeValue) || COVER_FOR_DEFAULT_START_TIME;
          const safeEndTime = normalizeTimeInput(endTimeValue) || COVER_FOR_DEFAULT_END_TIME;
          const safeVenue = normalizeCoverForVenue(venue) || normalizeCoverForVenue(post.coverForVenue) || COVER_FOR_DEFAULT_VENUE;
          const eventId = [
            String(post.id),
            String(dateKey),
            String(safeStartTime),
            String(safeEndTime),
            String(safeVenue),
            String(entryIndex)
          ].join('|');
          if (!map.has(dateKey)) map.set(dateKey, []);
          map.get(dateKey).push({
            id: eventId,
            eventId,
            kind: 'cover_for',
            postId: post.id,
            boardId: post.boardId,
            authorName,
            title: normalizeText(post.title) || '(제목 없음)',
            startTimeValue: safeStartTime,
            endTimeValue: safeEndTime,
            venue: safeVenue,
            status,
            tone,
            createdAtMs: toMillis(post.createdAt)
          });
        });
      });

    map.forEach((items, key) => {
      items.sort((a, b) => {
        const byDate = b.createdAtMs - a.createdAtMs;
        if (byDate !== 0) return byDate;
        return String(a.postId).localeCompare(String(b.postId), 'ko');
      });
      map.set(key, items);
    });

    return map;
  }, [currentUserProfile?.realName, showCoverCalendar, visiblePosts]);

  const coverCalendarModalItems = useMemo(() => {
    if (!coverCalendarModalDateKey) return [];
    return coverCalendarEventsByDate.get(coverCalendarModalDateKey) || [];
  }, [coverCalendarEventsByDate, coverCalendarModalDateKey]);

  const coverCalendarModalDateText = useMemo(() => {
    const date = fromDateKey(coverCalendarModalDateKey);
    if (!date) return '-';
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }, [coverCalendarModalDateKey]);

  const coverCalendarCells = useMemo(() => {
    const year = coverCalendarCursor.getFullYear();
    const month = coverCalendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

    const todayKey = toDateKey(todayDate);
    const selectedKey = toDateKey(coverCalendarSelectedDate);

    const cells = [];
    for (let idx = 0; idx < cellCount; idx += 1) {
      const cellDate = new Date(year, month, idx - firstWeekday + 1);
      const dateKey = toDateKey(cellDate);
      const inMonth = cellDate.getMonth() === month;

      const classes = ['cover-calendar-day'];
      if (!inMonth) classes.push('is-outside');
      if (cellDate.getDay() === 0) classes.push('is-sun');
      if (cellDate.getDay() === 6) classes.push('is-sat');
      if (dateKey === todayKey) classes.push('is-today');
      if (dateKey === selectedKey) classes.push('is-selected');

      const dayEvents = coverCalendarEventsByDate.get(dateKey) || [];
      const eventCount = dayEvents.length;
      if (eventCount > 0) classes.push('has-events');
      const hasWorkScheduleEvents = dayEvents.some((event) => event.kind === 'work_schedule');
      const previewEvents = hasWorkScheduleEvents
        ? (() => {
          const mineEvent = dayEvents.find((event) => normalizeText(event?.label));
          if (!mineEvent) return [];
          return [{
            postId: mineEvent.postId,
            label: normalizeText(mineEvent.label),
            tone: mineEvent.tone
          }];
        })()
        : dayEvents.slice(0, COVER_CALENDAR_PREVIEW_LIMIT).map((event) => ({
          postId: event.postId,
          label: `[${event.startTimeValue || COVER_FOR_DEFAULT_START_TIME}~${event.endTimeValue || COVER_FOR_DEFAULT_END_TIME}] [${event.venue || COVER_FOR_DEFAULT_VENUE}]`,
          tone: event.tone
        }));

      cells.push({
        key: dateKey,
        classes: classes.join(' '),
        day: cellDate.getDate(),
        eventCount,
        previewEvents,
        hasMoreEvents: dayEvents.length > previewEvents.length,
        moreCount: Math.max(0, dayEvents.length - previewEvents.length)
      });
    }

    return cells;
  }, [coverCalendarCursor, coverCalendarEventsByDate, coverCalendarSelectedDate, todayDate]);

  const loadingText = ready ? '게시글을 불러오는 중...' : '초기화 중...';
  const isExcelDesktopMode = isExcel && !compactListMode;
  const userRoleLabel = useMemo(() => {
    const roleKey = normalizeText(currentUserProfile?.role);
    if (!roleKey) return '-';
    return roleDefMap.get(roleKey)?.labelKo || roleKey;
  }, [currentUserProfile?.role, roleDefMap]);

  const excelBoardItems = useMemo(() => {
    return drawerItems
      .filter((item) => item && !isDividerItem(item))
      .map((item) => ({
        id: item.id,
        name: item.name || item.id,
        isSelected: item.id === selectedBoardId
      }));
  }, [drawerItems, selectedBoardId]);

  const excelPosts = useMemo(() => {
    return currentPagePosts.map((post, idx) => {
      const no = totalPostCount - (currentPageStartIndex + idx);
      const board = boardLookup.get(normalizeText(post.boardId)) || null;
      const boardLabel = board?.name || post.boardId || '-';
      const commentCount = numberOrZero(commentCountByPost[post.id]);
      const isRecentPost = recentUnreadPostIdSet.has(String(post.id));
      const coverSummary = normalizeText(post.boardId) === COVER_FOR_BOARD_ID ? summarizeCoverForPost(post) : null;
      const coverStatusTag = coverSummary?.label || '';
      const isPinned = isPinnedPost(post);
      const titleSegments = [
        isPinned ? '[고정]' : '',
        coverStatusTag ? `[${coverStatusTag}]` : '',
        post.title || '(제목 없음)',
        commentCount > 0 ? `[${commentCount}]` : '',
        isRecentPost ? '[N]' : ''
      ].filter(Boolean);

      return {
        postId: post.id,
        boardId: post.boardId,
        no,
        title: titleSegments.join(' '),
        author: post.authorName || post.authorUid || '-',
        dateText: formatPostListDate(post.createdAt),
        views: numberOrZero(post.views),
        boardLabel
      };
    });
  }, [
    boardLookup,
    commentCountByPost,
    currentPagePosts,
    currentPageStartIndex,
    recentUnreadPostIdSet,
    totalPostCount
  ]);

  const excelSheetModel = useMemo(() => {
    return buildAppExcelSheetModel({
      rowCount: APP_EXCEL_ROW_COUNT,
      colCount: APP_EXCEL_COL_COUNT,
      userDisplayName,
      userRoleLabel,
      boardItems: excelBoardItems,
      selectedBoardId,
      canAccessAdminSite,
      hasUnreadNotifications,
      isMobilePushEnabled: isMobilePushEnabled && hasActivePushToken,
      currentBoardName,
      totalPostCount,
      postListViewMode,
      posts: excelPosts,
      safeCurrentPage,
      totalPageCount,
      paginationPages,
      showComposerAction: !composerFabHidden,
      emptyMessage: loadingPosts ? loadingText : (activeListMessage.text || postListEmptyText)
    });
  }, [
    activeListMessage.text,
    canAccessAdminSite,
    composerFabHidden,
    currentBoardName,
    excelBoardItems,
    excelPosts,
    hasActivePushToken,
    hasUnreadNotifications,
    isMobilePushEnabled,
    loadingPosts,
    loadingText,
    paginationPages,
    postListEmptyText,
    postListViewMode,
    safeCurrentPage,
    selectedBoardId,
    totalPageCount,
    totalPostCount,
    userDisplayName,
    userRoleLabel
  ]);

  const handleExcelSelectCell = useCallback((payload) => {
    const label = normalizeText(payload?.label);
    const text = String(payload?.text ?? '').trim();
    setExcelActiveCellLabel(label || '');
    setExcelFormulaText(text || '=');
  }, []);

  const handleExcelOpenPost = useCallback((postId, boardId) => {
    if (!postId) return;
    handleMovePost(postId, boardId || selectedBoardId);
  }, [handleMovePost, selectedBoardId]);

  const handleExcelSortChange = useCallback((mode) => {
    const normalized = normalizeText(mode).toLowerCase();
    setPostListViewMode(normalized === POST_LIST_VIEW_MODE.POPULAR ? POST_LIST_VIEW_MODE.POPULAR : POST_LIST_VIEW_MODE.LATEST);
  }, []);

  const handleExcelPageChange = useCallback((pageNo) => {
    const nextPage = Math.max(1, Math.min(totalPageCount, Math.floor(Number(pageNo) || 1)));
    setCurrentPage(nextPage);
  }, [totalPageCount]);


  return {
    navigate,
    location,
    theme,
    toggleTheme,
    isExcel,
    pendingBoardIdRef,
    editorRef,
    editorElRef,
    fontSizeLabelRef,
    expiryTimerRef,
    countdownTimerRef,
    lastActivityRefreshAtRef,
    postsLoadRequestRef,
    appliedPopupTimerRef,
    knownRealtimePostIdsRef,
    realtimePostsReadyRef,
    notificationPrefsRef,
    mentionRequestIdRef,
    mentionCacheRef,
    composerVenueInputRefs,
    ready,
    setReady,
    pageMessage,
    setPageMessage,
    appliedPopup,
    setAppliedPopup,
    currentUser,
    setCurrentUser,
    currentUserProfile,
    setCurrentUserProfile,
    permissions,
    setPermissions,
    roleDefinitions,
    setRoleDefinitions,
    boardNavItems,
    setBoardNavItems,
    boardList,
    setBoardList,
    selectedBoardId,
    setSelectedBoardId,
    visiblePosts,
    setVisiblePosts,
    commentCountByPost,
    setCommentCountByPost,
    listMessage,
    setListMessage,
    loadingPosts,
    setLoadingPosts,
    currentPage,
    setCurrentPage,
    postListViewMode,
    setPostListViewMode,
    compactListMode,
    setCompactListMode,
    excelActiveCellLabel,
    setExcelActiveCellLabel,
    excelFormulaText,
    setExcelFormulaText,
    boardDrawerOpen,
    setBoardDrawerOpen,
    guideModalOpen,
    setGuideModalOpen,
    composerOpen,
    setComposerOpen,
    composerMessage,
    setComposerMessage,
    postTitle,
    setPostTitle,
    composerCoverDateKeys,
    setComposerCoverDateKeys,
    composerCoverStartTimeValues,
    setComposerCoverStartTimeValues,
    composerCoverEndTimeValues,
    setComposerCoverEndTimeValues,
    composerCoverVenueValues,
    setComposerCoverVenueValues,
    composerCoverVenueCustomModes,
    setComposerCoverVenueCustomModes,
    setComposerVenueInputFocusIndex,
    composerMentionMenu,
    setComposerMentionMenu,
    composerMentionCandidates,
    setComposerMentionCandidates,
    composerMentionActiveIndex,
    setComposerMentionActiveIndex,
    venueOptions,
    setVenueOptions,
    submittingPost,
    setSubmittingPost,
    sessionRemainingMs,
    setSessionRemainingMs,
    todayDate,
    coverCalendarCursor,
    setCoverCalendarCursor,
    coverCalendarSelectedDate,
    setCoverCalendarSelectedDate,
    coverCalendarModalOpen,
    setCoverCalendarModalOpen,
    coverCalendarModalDateKey,
    setCoverCalendarModalDateKey,
    composerDatePickerOpen,
    setComposerDatePickerOpen,
    composerDatePickerTargetIndex,
    setComposerDatePickerTargetIndex,
    composerDatePickerCursor,
    setComposerDatePickerCursor,
    notificationCenterOpen,
    setNotificationCenterOpen,
    notifications,
    setNotifications,
    notificationPrefs,
    setNotificationPrefs,
    notificationFeedFilter,
    setNotificationFeedFilter,
    mobilePushModalOpen,
    setMobilePushModalOpen,
    mobilePushCapability,
    setMobilePushCapability,
    mobilePushWorking,
    setMobilePushWorking,
    mobilePushStatus,
    setMobilePushStatus,
    mobilePushTokens,
    setMobilePushTokens,
    viewedPostIdMap,
    setViewedPostIdMap,
    recentComments,
    setRecentComments,
    recentCommentsLoading,
    setRecentCommentsLoading,
    selectedPinPostIdMap,
    setSelectedPinPostIdMap,
    pinActionPending,
    setPinActionPending,
    roleDefMap,
    currentUserUid,
    isAdminOrSuper,
    coverVenueOptions,
    coverVenueDefault,
    profileSurface,
    boardLookup,
    currentBoard,
    isAllBoardSelected,
    currentBoardName,
    currentBoardRoles,
    currentBoardVisibility,
    canManagePinInCurrentBoard,
    visiblePostById,
    listedPosts,
    selectedPinPostIds,
    selectedPinPostCount,
    selectedPinMode,
    showPinToolbar,
    totalPostCount,
    latestTenPosts,
    recentUnreadPostIdSet,
    totalPageCount,
    safeCurrentPage,
    currentPageStartIndex,
    currentPagePosts,
    postListViewTabs,
    postListEmptyText,
    activeListMessage,
    isPostListEmptyState,
    desktopPostTableColSpan,
    paginationPages,
    isCommentNotificationEnabled,
    isMentionNotificationEnabled,
    isMobilePushEnabled,
    effectiveNotifications,
    recentEffectiveNotifications,
    filteredNotifications,
    unreadNotificationCount,
    hasUnreadNotifications,
    notificationBoardItems,
    hasActivePushToken,
    notificationPermission,
    notificationPermissionText,
    showAppliedPopup,
    fetchMentionCandidates,
    closeComposerMentionMenu,
    readComposerMentionAnchor,
    syncComposerMentionMenu,
    applyComposerMentionCandidate,
    clearExpiryTimer,
    clearCountdownTimer,
    handleTemporaryLoginExpiry,
    scheduleTemporaryLoginExpiry,
    hasTemporarySession,
    canUseBoard,
    canWriteBoard,
    hydrateCommentCounts,
    loadPostsForCurrentBoard,
    closeComposer,
    resetComposer,
    openComposer,
    addComposerCoverDate,
    removeComposerCoverDate,
    updateComposerCoverDate,
    updateComposerCoverStartTime,
    updateComposerCoverEndTime,
    updateComposerCoverVenue,
    setComposerCoverVenueCustomMode,
    updateComposerCoverVenueSelect,
    openComposerDatePicker,
    closeComposerDatePicker,
    submitPost,
    handleExtendSession,
    handleLogout,
    isBoardNotificationEnabled,
    isNotificationTypeEnabled,
    appendNotification,
    markAllNotificationsRead,
    markNotificationRead,
    toggleBoardNotification,
    toggleNotificationTypePreference,
    isMobilePushBoardEnabled,
    toggleMobilePushBoardPreference,
    setMobilePushGlobalPreference,
    refreshMobilePushCapability,
    enableMobilePush,
    disableMobilePush,
    handleMovePost,
    handleSelectBoard,
    handleMoveHome,
    handleBrandTitleKeyDown,
    isPostPinSelectionDisabled,
    handleTogglePinSelect,
    handleBulkPinUpdate,
    drawerItems,
    composerFabHidden,
    canAccessAdminSite,
    userDisplayName,
    showCurrentBoardAudience,
    showCoverCalendar,
    composerIsCoverForBoard,
    myPostsPage,
    myCommentsPage,
    coverCalendarMonthLabel,
    composerDatePickerSelectedKey,
    composerDatePickerSelectedDate,
    composerDatePickerStartMonth,
    composerDatePickerEndMonth,
    coverCalendarEventsByDate,
    coverCalendarModalItems,
    coverCalendarModalDateText,
    coverCalendarCells,
    loadingText,
    isExcelDesktopMode,
    userRoleLabel,
    excelBoardItems,
    excelPosts,
    excelSheetModel,
    handleExcelSelectCell,
    handleExcelOpenPost,
    handleExcelSortChange,
    handleExcelPageChange
  };
}
