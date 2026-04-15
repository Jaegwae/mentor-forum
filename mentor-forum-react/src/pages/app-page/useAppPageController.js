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
import { useAppBoardFeed } from './useAppBoardFeed.js';
import { useAppComposerState } from './useAppComposerState.js';
import { useAppComposerMentions } from './useAppComposerMentions.js';
import { useAppComposerActions } from './useAppComposerActions.js';
import { useAppNotificationCenter } from './useAppNotificationCenter.js';
import { useAppNotificationSync } from './useAppNotificationSync.js';
import { useAppNavigationPins } from './useAppNavigationPins.js';
import { useAppCalendar } from './useAppCalendar.js';

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

  // ---- ref bucket ---------------------------------------------------------
  // These refs back timers, editor handles, DOM anchors, and "latest request
  // wins" guards without participating in the render lifecycle.
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
  const composerVenueInputRefs = useRef([]);

  // ---- shell/auth/session state ------------------------------------------
  // Global page readiness / top-level UX messaging.
  const [ready, setReady] = useState(false);
  const [pageMessage, setPageMessage] = useState({ type: '', text: '' });
  const [appliedPopup, setAppliedPopup] = useState({ open: false, text: '' });

  // Auth + profile + permission model.
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);
  const [excelActiveCellLabel, setExcelActiveCellLabel] = useState('');
  const [excelFormulaText, setExcelFormulaText] = useState('=');

  // UI shell state (mobile drawer, guides, modal visibility).
  const [boardDrawerOpen, setBoardDrawerOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);

  // Temporary-session countdown for users who did not opt into persistent login.
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);

  const todayDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  const showAppliedPopup = useCallback((text) => {
    const normalizedText = normalizeText(text);
    if (appliedPopupTimerRef.current != null) {
      window.clearTimeout(appliedPopupTimerRef.current);
      appliedPopupTimerRef.current = null;
    }
    if (!normalizedText) {
      setAppliedPopup({ open: false, text: '' });
      return;
    }
    setAppliedPopup({ open: true, text: normalizedText });
    appliedPopupTimerRef.current = window.setTimeout(() => {
      setAppliedPopup({ open: false, text: '' });
      appliedPopupTimerRef.current = null;
    }, 2200);
  }, [normalizeText]);

  // ---- split sub-hooks ----------------------------------------------------
  // The controller is intentionally composed from smaller hooks so feed,
  // composer, notifications, navigation, and calendar logic can evolve
  // independently instead of re-forming one giant controller body.
  const {
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
    coverVenueOptions,
    coverVenueDefault,
    submittingPost,
    setSubmittingPost,
    composerDatePickerOpen,
    setComposerDatePickerOpen,
    composerDatePickerTargetIndex,
    setComposerDatePickerTargetIndex,
    composerDatePickerCursor,
    setComposerDatePickerCursor,
    addComposerCoverDate,
    removeComposerCoverDate,
    updateComposerCoverDate,
    updateComposerCoverStartTime,
    updateComposerCoverEndTime,
    updateComposerCoverVenue,
    updateComposerCoverVenueSelect,
    openComposerDatePicker,
    closeComposerDatePicker
  } = useAppComposerState({
    COMPOSER_MENTION_MENU_INITIAL,
    COVER_FOR_CUSTOM_VENUE_VALUE,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_DEFAULT_VENUE,
    DEFAULT_COVER_FOR_VENUE_OPTIONS,
    composerVenueInputRefs,
    normalizeCoverForTimeValues,
    normalizeCoverForVenue,
    normalizeCoverForVenueValues,
    normalizeCoverVenueOptions,
    normalizeDateKeyInput,
    normalizeText,
    normalizeTimeInput,
    sanitizeCoverForVenueInput,
    suggestEndTime,
    timeValueToMinutes,
    toDateKey,
    todayDate,
    isValidTimeRange,
    logCoverVenueDebug
  });
  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const currentUserUid = normalizeText(currentUser?.uid);
  const isAdminOrSuper = normalizeText(currentUserProfile?.role) === 'Admin' || normalizeText(currentUserProfile?.role) === 'Super_Admin';
  const {
    closeComposerMentionMenu,
    syncComposerMentionMenu,
    applyComposerMentionCandidate
  } = useAppComposerMentions({
    editorRef,
    currentUserUid,
    isAdminOrSuper,
    appFirestore,
    normalizeNickname,
    buildNicknameKey,
    normalizeText,
    detectMentionContext,
    MENTION_MAX_ITEMS,
    MENTION_ALL_TOKEN,
    MENTION_MENU_ESTIMATED_WIDTH,
    composerMentionMenu,
    setComposerMentionMenu,
    composerMentionCandidates,
    setComposerMentionCandidates,
    composerMentionActiveIndex,
    setComposerMentionActiveIndex,
    composerOpen,
    COMPOSER_MENTION_MENU_INITIAL
  });
  // Derived maps and computed model fields consumed by the view.
  const profileSurface = useMemo(() => {
    return profileCardSurface(currentUserProfile?.role, roleDefMap, theme);
  }, [currentUserProfile?.role, roleDefMap, theme]);
  const canUseBoard = useCallback((board) => {
    return canUseBoardWithProfile(board, currentUserProfile, roleDefMap);
  }, [currentUserProfile, roleDefMap]);
  const {
    setBoardList,
    boardNavItems,
    boardList,
    selectedBoardId,
    setSelectedBoardId,
    visiblePosts,
    commentCountByPost,
    listMessage,
    setListMessage,
    loadingPosts,
    setCurrentPage,
    postListViewMode,
    setPostListViewMode,
    boardLookup,
    currentBoard,
    isAllBoardSelected,
    currentBoardName,
    currentBoardRoles,
    currentBoardVisibility,
    canManagePinInCurrentBoard,
    visiblePostById,
    setVisiblePosts,
    totalPostCount,
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
    loadPostsForCurrentBoard
  } = useAppBoardFeed({
    ALL_BOARD_ID,
    POSTS_PER_PAGE,
    POST_LIST_VIEW_MODE,
    currentUserProfile,
    roleDefMap,
    isAdminOrSuper,
    NEW_POST_LOOKBACK_MS,
    postsLoadRequestRef,
    numberOrZero,
    normalizeText,
    toMillis,
    boardAllowedRoles,
    boardAutoVisibility,
    comparePostsWithPinnedPriority,
    getVisiblePosts,
    mergePostsByCreatedAtDesc,
    isPinnedPost,
    canUseBoard,
    queryPostsForBoard,
    fetchCommentCount,
    normalizeErrMessage,
    isCalendarBoardId
  });
  const {
    notificationCenterOpen,
    setNotificationCenterOpen,
    notificationFeedFilter,
    setNotificationFeedFilter,
    mobilePushModalOpen,
    setMobilePushModalOpen,
    mobilePushCapability,
    mobilePushWorking,
    mobilePushStatus,
    setMobilePushStatus,
    mobilePushTokens,
    recentComments,
    recentCommentsLoading,
    isMobilePushEnabled,
    filteredNotifications,
    unreadNotificationCount,
    hasUnreadNotifications,
    notificationBoardItems,
    hasActivePushToken,
    notificationPermission,
    notificationPermissionText,
    isBoardNotificationEnabled,
    isNotificationTypeEnabled,
    isMobilePushBoardEnabled,
    markAllNotificationsRead,
    markNotificationRead,
    toggleBoardNotification,
    toggleNotificationTypePreference,
    toggleMobilePushBoardPreference,
    refreshMobilePushCapability,
    enableMobilePush,
    disableMobilePush,
    notifications,
    setNotifications,
    notificationPrefs,
    setNotificationPrefs,
    setMobilePushCapability,
    setMobilePushTokens,
    viewedPostIdMap,
    setViewedPostIdMap,
    setRecentComments,
    setRecentCommentsLoading,
    appendNotification
  } = useAppNotificationCenter({
    NOTIFICATION_PREF_KEY,
    LEGACY_NOTIFICATION_PREF_KEY,
    MOBILE_PUSH_PREF_KEY,
    NOTIFICATION_RECENT_WINDOW_MS,
    NOTIFICATION_MAX_ITEMS,
    NOTIFICATION_TYPE,
    currentUserUid,
    boardList,
    appFirestore,
    numberOrZero,
    normalizeText,
    normalizeNotificationType,
    notificationMatchesFeedFilter,
    notificationPermissionLabel,
    isForcedNotification,
    normalizeErrMessage,
    logErrorWithOptionalDebug,
    buildPushTokenDocId,
    getWebPushCapability,
    requestWebPushToken,
    WEB_PUSH_SW_PATH,
    toMillis,
    serverTimestamp
  });
  useAppNotificationSync({
    appFirestore,
    currentUserUid,
    currentUserProfile,
    boardList,
    ready,
    notificationPrefs,
    notificationPrefsRef,
    knownRealtimePostIdsRef,
    realtimePostsReadyRef,
    setNotifications,
    setNotificationPrefs,
    setNotificationFeedFilter,
    setMobilePushCapability,
    setMobilePushTokens,
    setViewedPostIdMap,
    setRecentComments,
    setRecentCommentsLoading,
    appendNotification,
    getWebPushCapability,
    normalizeErrMessage,
    logErrorWithOptionalDebug,
    normalizeText,
    numberOrZero,
    toMillis,
    boardIdentityCandidates,
    normalizeBoardIdentity,
    postBoardIdentityCandidates,
    isDeletedPost,
    RECENT_COMMENT_FETCH_LIMIT,
    RECENT_COMMENT_MAX_ITEMS,
    NOTIFICATION_FEED_FILTER,
    NOTIFICATION_MAX_ITEMS,
    NOTIFICATION_TYPE,
    NOTIFICATION_SUBTYPE,
    isWorkScheduleShiftAlertNotification
  });
  const canWriteBoard = useCallback((board) => {
    return canWriteBoardWithProfile(board, currentUserProfile, roleDefMap);
  }, [currentUserProfile, roleDefMap]);
  const {
    closeComposer,
    openComposer,
    submitPost
  } = useAppComposerActions({
    currentBoard,
    currentUser,
    currentUserProfile,
    roleDefMap,
    editorRef,
    appFirestore,
    canWriteBoard,
    canWriteBoardWithProfile,
    normalizeRoleKey,
    normalizeText,
    normalizeErrMessage,
    boardPermissionDebugText,
    debugCodePoints,
    debugValueList,
    joinDebugParts,
    formatDateKeyLabel,
    normalizeCoverForVenue,
    normalizeCoverForDateTimeEntries,
    normalizeDateKeyInput,
    isPermissionDeniedError,
    isValidTimeRange,
    toDateKey,
    buildAuthorName,
    logErrorWithOptionalDebug,
    COVER_FOR_BOARD_ID,
    COVER_FOR_STATUS,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_DEFAULT_END_TIME,
    coverVenueDefault,
    todayDate,
    setCurrentUserProfile,
    setListMessage,
    showAppliedPopup,
    loadPostsForCurrentBoard,
    closeComposerMentionMenu,
    setComposerVenueInputFocusIndex,
    setComposerOpen,
    setComposerMessage,
    setPostTitle,
    setComposerCoverDateKeys,
    setComposerCoverStartTimeValues,
    setComposerCoverEndTimeValues,
    setComposerCoverVenueValues,
    setComposerCoverVenueCustomModes,
    setSubmittingPost,
    postTitle,
    composerCoverDateKeys,
    composerCoverStartTimeValues,
    composerCoverEndTimeValues,
    composerCoverVenueValues,
    serverTimestamp,
    isAllBoardSelected
  });
  const {
    selectedPinPostIdMap,
    setSelectedPinPostIdMap,
    pinActionPending,
    selectedPinPostIds,
    selectedPinPostCount,
    selectedPinMode,
    showPinToolbar,
    handleMovePost,
    handleSelectBoard,
    handleMoveHome,
    handleBrandTitleKeyDown,
    isPostPinSelectionDisabled,
    handleTogglePinSelect,
    handleBulkPinUpdate
  } = useAppNavigationPins({
    ALL_BOARD_ID,
    appPage: MENTOR_FORUM_CONFIG.app.appPage || '/app',
    currentBoard,
    currentUserUid,
    selectedBoardId,
    visiblePostById,
    isPinnedPost,
    canManagePinInCurrentBoard,
    pinUpdatePost: (postId, nextPinned, nowMs, uid) => {
      const payload = nextPinned
        ? {
          isPinned: true,
          pinnedAt: serverTimestamp(),
          pinnedAtMs: nowMs,
          pinnedByUid: uid,
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
    },
    normalizeText,
    normalizeErrMessage,
    readRememberedBoardId,
    writeRememberedBoardId,
    navigate,
    locationSearch: location.search,
    setSelectedBoardId,
    pendingBoardIdRef,
    setVisiblePosts,
    setPageMessage
  });
  const {
    coverCalendarCursor,
    setCoverCalendarCursor,
    coverCalendarSelectedDate,
    setCoverCalendarSelectedDate,
    coverCalendarModalOpen,
    setCoverCalendarModalOpen,
    coverCalendarModalDateKey,
    setCoverCalendarModalDateKey,
    showCoverCalendar,
    coverCalendarMonthLabel,
    coverCalendarEventsByDate,
    coverCalendarModalItems,
    coverCalendarModalDateText,
    coverCalendarCells
  } = useAppCalendar({
    currentBoard,
    currentUserProfile,
    selectedBoardId,
    visiblePosts,
    todayDate,
    normalizeText,
    isCalendarBoardId,
    isDeletedPost,
    buildPastelTone,
    toMillis,
    toDateKey,
    fromDateKey,
    normalizeDateKeyInput,
    normalizeWorkScheduleRows,
    buildWorkScheduleSummaryLines,
    workScheduleRowContainsPersonName,
    normalizeWorkScheduleMemberText,
    postCoverForDateEntries,
    normalizeCoverForStatus,
    normalizeTimeInput,
    normalizeCoverForVenue,
    COVER_FOR_BOARD_ID,
    WORK_SCHEDULE_BOARD_ID,
    COVER_FOR_STATUS,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_VENUE,
    COVER_CALENDAR_PREVIEW_LIMIT
  });
  const drawerItems = useMemo(() => {
    return [{ id: ALL_BOARD_ID, name: '전체 게시글', isDivider: false }, ...boardNavItems];
  }, [boardNavItems]);

  const composerFabHidden = isAllBoardSelected || !currentBoard || !canWriteBoard(currentBoard);
  const canAccessAdminSite = !!permissions?.canAccessAdminSite;

  const userDisplayName = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUser?.email || '사용자')
    : '사용자';

  const showCurrentBoardAudience = !isAllBoardSelected && !!currentBoard;
  const loadingText = ready ? '게시글을 불러오는 중...' : '초기화 중...';
  const isExcelDesktopMode = isExcel && !compactListMode;
  const composerIsCoverForBoard = normalizeText(currentBoard?.id) === COVER_FOR_BOARD_ID;
  const myPostsPage = MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts';
  const myCommentsPage = MENTOR_FORUM_CONFIG.app.myCommentsPage || '/me/comments';
  const composerDatePickerSelectedDate = useMemo(() => {
    const selectedKey = normalizeDateKeyInput(composerCoverDateKeys[composerDatePickerTargetIndex]);
    return selectedKey ? fromDateKey(selectedKey) : undefined;
  }, [composerCoverDateKeys, composerDatePickerTargetIndex, fromDateKey, normalizeDateKeyInput]);
  const composerDatePickerStartMonth = useMemo(() => {
    return new Date(todayDate.getFullYear() - 1, 0, 1);
  }, [todayDate]);
  const composerDatePickerEndMonth = useMemo(() => {
    return new Date(todayDate.getFullYear() + 2, 11, 1);
  }, [todayDate]);
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
    hasActivePushToken,
    hasUnreadNotifications,
    isMobilePushEnabled,
    loadingPosts,
    loadingText,
    paginationPages,
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

  // ---- auth/session effects ----------------------------------------------
  // Session expiry and auth bootstrap remain here because they coordinate
  // top-level navigation together with several sub-hook states.
  const handleTemporaryLoginExpiry = useCallback(async () => {
    clearExpiryTimer();
    clearCountdownTimer();
    setSessionRemainingMs(null);
    clearTemporaryLoginExpiry();
    try {
      await signOut(auth);
    } catch (_) {
      // ignore forced signout failure
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
    return () => {
      clearExpiryTimer();
      clearCountdownTimer();
      if (appliedPopupTimerRef.current != null) {
        window.clearTimeout(appliedPopupTimerRef.current);
      }
    };
  }, [clearCountdownTimer, clearExpiryTimer]);

  useEffect(() => {
    const handleResize = () => {
      setCompactListMode(detectCompactListMode());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
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
    return () => {
      closeComposerMentionMenu();
      editorRef.current = null;
    };
  }, [closeComposerMentionMenu, setComposerMessage, syncComposerMentionMenu]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setGuideModalOpen(params.get('guide') === '1');
  }, [location.search]);

  // ---- auth bootstrap -----------------------------------------------------
  useEffect(() => {
    const hasTemporarySession = sessionRemainingMs != null;
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
  }, [clearCountdownTimer, handleTemporaryLoginExpiry, sessionRemainingMs]);

  useEffect(() => {
    const hasTemporarySession = sessionRemainingMs != null;
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
  }, [scheduleTemporaryLoginExpiry, sessionRemainingMs]);

  useEffect(() => {
    let active = true;
    setPageMessage({ type: '', text: '' });
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        setPageMessage({ type: 'error', text: normalizeErrMessage(err, 'Firebase 설정 오류') });
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
        // keep current auth state if reload fails
      }
      if (!active) return;
      if (!user.emailVerified) {
        try {
          await signOut(auth);
        } catch (_) {
          // ignore signout failure
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
        setRoleDefinitions(loadedRoleDefinitions);
        setCurrentUserProfile(normalizedProfile);
        setPermissions(loadedPermissions);
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
  }, [clearCountdownTimer, clearExpiryTimer, navigate, normalizeErrMessage, scheduleTemporaryLoginExpiry]);

  // ---- board bootstrap ----------------------------------------------------
  // Board loading stays in the top-level controller because it determines the
  // initial board context before feed loading can safely begin.
  useEffect(() => {
    if (!currentUserProfile) {
      setBoardList([]);
      return () => {};
    }
    let active = true;
    loadBoards(currentUserProfile.role, roleDefMap, currentUserProfile.rawRole)
      .then((loadedBoards) => {
        if (!active) return;
        setBoardList(loadedBoards);
        const params = new URLSearchParams(location.search);
        const requestedBoardId = normalizeText(params.get('boardId') || pendingBoardIdRef.current || readRememberedBoardId());
        const hasRequestedBoard = requestedBoardId === ALL_BOARD_ID || loadedBoards.some((board) => normalizeText(board?.id) === requestedBoardId);
        setSelectedBoardId(hasRequestedBoard ? requestedBoardId : ALL_BOARD_ID);
      })
      .catch((err) => {
        if (!active) return;
        setBoardList([]);
        setPageMessage({ type: 'error', text: normalizeErrMessage(err, '게시판 목록 조회 실패') });
      });
    return () => {
      active = false;
    };
  }, [
    ALL_BOARD_ID,
    currentUserProfile,
    location.search,
    normalizeErrMessage,
    normalizeText,
    readRememberedBoardId,
    roleDefMap,
    setBoardList,
    setSelectedBoardId
  ]);

  // ---- flat VM contract ---------------------------------------------------
  // The returned object stays intentionally flat so `AppPageView` can keep its
  // legacy JSX identifier contract while the controller implementation becomes
  // more modular under the hood.
  return {
    navigate,
    theme,
    toggleTheme,
    isExcel,
    editorRef,
    editorElRef,
    fontSizeLabelRef,
    composerVenueInputRefs,
    pageMessage,
    appliedPopup,
    currentUserProfile,
    selectedBoardId,
    commentCountByPost,
    loadingPosts,
    setCurrentPage,
    postListViewMode,
    setPostListViewMode,
    compactListMode,
    excelActiveCellLabel,
    excelFormulaText,
    boardDrawerOpen,
    setBoardDrawerOpen,
    guideModalOpen,
    setGuideModalOpen,
    composerOpen,
    composerMessage,
    postTitle,
    setPostTitle,
    composerCoverDateKeys,
    composerCoverStartTimeValues,
    composerCoverEndTimeValues,
    composerCoverVenueValues,
    composerCoverVenueCustomModes,
    setComposerVenueInputFocusIndex,
    composerMentionMenu,
    composerMentionCandidates,
    composerMentionActiveIndex,
    submittingPost,
    sessionRemainingMs,
    setCoverCalendarCursor,
    setCoverCalendarSelectedDate,
    coverCalendarModalOpen,
    setCoverCalendarModalOpen,
    setCoverCalendarModalDateKey,
    composerDatePickerOpen,
    composerDatePickerTargetIndex,
    composerDatePickerCursor,
    setComposerDatePickerCursor,
    notificationCenterOpen,
    setNotificationCenterOpen,
    notificationFeedFilter,
    setNotificationFeedFilter,
    mobilePushModalOpen,
    setMobilePushModalOpen,
    mobilePushCapability,
    mobilePushWorking,
    mobilePushStatus,
    setMobilePushStatus,
    mobilePushTokens,
    recentComments,
    recentCommentsLoading,
    selectedPinPostIdMap,
    pinActionPending,
    roleDefMap,
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
    selectedPinPostCount,
    selectedPinMode,
    showPinToolbar,
    totalPostCount,
    recentUnreadPostIdSet,
    totalPageCount,
    safeCurrentPage,
    currentPageStartIndex,
    currentPagePosts,
    postListViewTabs,
    activeListMessage,
    isPostListEmptyState,
    desktopPostTableColSpan,
    paginationPages,
    isMobilePushEnabled,
    filteredNotifications,
    unreadNotificationCount,
    hasUnreadNotifications,
    notificationBoardItems,
    hasActivePushToken,
    notificationPermission,
    notificationPermissionText,
    applyComposerMentionCandidate,
    closeComposer,
    openComposer,
    addComposerCoverDate,
    removeComposerCoverDate,
    updateComposerCoverDate,
    updateComposerCoverStartTime,
    updateComposerCoverEndTime,
    updateComposerCoverVenue,
    updateComposerCoverVenueSelect,
    openComposerDatePicker,
    closeComposerDatePicker,
    submitPost,
    handleExtendSession,
    handleLogout,
    isBoardNotificationEnabled,
    isNotificationTypeEnabled,
    markAllNotificationsRead,
    markNotificationRead,
    toggleBoardNotification,
    toggleNotificationTypePreference,
    isMobilePushBoardEnabled,
    toggleMobilePushBoardPreference,
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
    composerDatePickerSelectedDate,
    composerDatePickerStartMonth,
    composerDatePickerEndMonth,
    coverCalendarModalItems,
    coverCalendarModalDateText,
    coverCalendarCells,
    loadingText,
    isExcelDesktopMode,
    excelSheetModel,
    handleExcelSelectCell,
    handleExcelOpenPost,
    handleExcelSortChange,
    handleExcelPageChange
  };
}
