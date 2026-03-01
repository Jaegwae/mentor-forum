// AppPage presentation component.
// Receives a flat `vm` object from the controller and renders without owning
// domain logic, so layout changes can be made with minimal behavior risk.
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  BellOff,
  BookOpen,
  CalendarDays,
  FileText,
  Inbox,
  LogOut,
  Menu,
  MessageSquare,
  Smartphone,
  Pin,
  PinOff,
  PencilLine,
  ShieldCheck,
  Users2
} from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { ko } from 'date-fns/locale';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { getRoleBadgePalette } from '../../legacy/rbac.js';
import { RichEditorToolbar } from '../../components/editor/RichEditorToolbar.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.jsx';
import { ThemeToggle } from '../../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../../components/excel/AppExcelWorkbook.jsx';
import {
  APP_EXCEL_COL_COUNT,
  APP_EXCEL_ROW_COUNT
} from '../../components/excel/app-excel-sheet-model.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.jsx';
import * as pageConstants from './constants.js';
import * as pageUtils from './utils.js';

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
  notificationMatchesFeedFilter,
  detectCompactListMode,
  toDateKey,
  fromDateKey,
  formatDateKeyLabel,
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
  buildAuthorName,
  normalizeWorkScheduleMemberText
} = pageUtils;

function ComposerDayPickerDropdown(props) {
  const {
    options = [],
    value,
    onChange,
    disabled,
    className,
    'aria-label': ariaLabel
  } = props || {};

  if (!Array.isArray(options) || options.length === 0) return null;

  const selectedValue = options.some((option) => String(option?.value) === String(value))
    ? String(value)
    : undefined;

  return (
    <Select
      value={selectedValue}
      disabled={Boolean(disabled)}
      onValueChange={(nextValue) => {
        if (typeof onChange !== 'function') return;
        onChange({
          target: { value: nextValue },
          currentTarget: { value: nextValue }
        });
      }}
    >
      <SelectTrigger className={`composer-day-picker-inline-select ${className || ''}`.trim()} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="composer-day-picker-select-content" position="popper">
        {options.map((option) => (
          <SelectItem
            key={`composer-day-picker-option-${option.value}`}
            value={String(option.value)}
            disabled={Boolean(option.disabled)}
            className="composer-day-picker-select-item"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function normalizeScheduleCellText(value) {
  return normalizeWorkScheduleMemberText(value);
}

function hasScheduleCellText(value) {
  const normalized = normalizeScheduleCellText(value);
  if (!normalized) return false;
  if (/^[-–—]+$/.test(normalized)) return false;
  return true;
}

function RoleBadge({ role, roleDefMap }) {
  const roleKey = normalizeText(role) || 'Newbie';
  const roleDef = roleDefMap.get(roleKey) || null;
  const palette = getRoleBadgePalette(roleKey, roleDef);
  const label = roleDef?.labelKo || roleKey;

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

function AuthorWithRole({ name, role, roleDefMap }) {
  return (
    <span className="author-role-wrap">
      <span className="author-name">{name || '-'}</span>
      <RoleBadge role={role} roleDefMap={roleDefMap} />
    </span>
  );
}


export function AppPageView({ vm }) {
  // Keep property names aligned with the controller return object.
  // This explicit destructuring makes accidental contract drift easy to detect.
  const {
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
  } = vm;

  // Keep mobile navigation accessible even when a browser reports desktop-like
  // viewport metrics (for example, iOS "request desktop site").
  const forumListLayoutStyle = compactListMode
    ? { marginTop: '10px', gridTemplateColumns: 'minmax(0, 1fr)', gap: '10px' }
    : { marginTop: '10px' };
  const mobileHamburgerStyle = compactListMode && !boardDrawerOpen
    ? { display: 'inline-flex' }
    : undefined;

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${totalPostCount}건`}
          activeCellLabel={isExcelDesktopMode ? excelActiveCellLabel : ''}
          formulaText={isExcelDesktopMode ? excelFormulaText : '='}
          compact={compactListMode}
          showHeaders
          rowCount={APP_EXCEL_ROW_COUNT}
          colCount={APP_EXCEL_COL_COUNT}
        />
      ) : null}
      <motion.main
        className={isExcel ? 'page stack forum-shell excel-chrome-offset' : 'page stack forum-shell'}
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
            onOpenPost={handleExcelOpenPost}
            onSelectBoard={handleSelectBoard}
            onOpenComposer={openComposer}
            onNavigateMyPosts={() => navigate(myPostsPage)}
            onNavigateMyComments={() => navigate(myCommentsPage)}
            onNavigateAdmin={() => navigate(MENTOR_FORUM_CONFIG.app.adminPage)}
            onOpenGuide={() => setGuideModalOpen(true)}
            onToggleTheme={toggleTheme}
            onLogout={() => handleLogout().catch(() => {})}
            onSortChange={handleExcelSortChange}
            onPageChange={handleExcelPageChange}
            onMoveHome={handleMoveHome}
            onOpenNotifications={() => setNotificationCenterOpen(true)}
            onOpenMobilePush={() => setMobilePushModalOpen(true)}
          />
        ) : null}
        <div className={isExcelDesktopMode ? 'hidden' : ''}>
        <section className="card hero-card">
          <div className="row space-between mobile-col">
            <div>
              <p className="hero-kicker"><Users2 size={15} /> Community Hub</p>
              <h1
                className="forum-brand-title is-link"
                role="button"
                tabIndex={0}
                onClick={handleMoveHome}
                onKeyDown={handleBrandTitleKeyDown}
              >
                멘토스
              </h1>
              <p className="hero-copy">멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!</p>
            </div>

            <div className="row top-action-row">
              <button
                type="button"
                className={boardDrawerOpen ? 'mobile-hamburger-btn hidden' : 'mobile-hamburger-btn'}
                aria-label="게시판 메뉴 열기"
                style={mobileHamburgerStyle}
                onClick={() => setBoardDrawerOpen(true)}
              >
                <Menu size={18} />
              </button>

              <button
                type="button"
                className="btn-muted guide-help-btn"
                aria-label="사용 설명서 열기"
                title="사용 설명서"
                onClick={() => setGuideModalOpen(true)}
              >
                <BookOpen size={16} />
                <span className="guide-help-btn-text">사용 설명서</span>
              </button>

              <ThemeToggle />
            </div>
          </div>

          <div
            id="userInfo"
            className={sessionRemainingMs != null ? 'notice session-only-notice' : 'hidden'}
            style={{ marginTop: '12px' }}
          >
            <div className="session-ttl-row">
              <span className="session-ttl-label">
                자동 로그아웃까지 <strong className="session-ttl-time">{formatTemporaryLoginRemaining(sessionRemainingMs)}</strong>
              </span>
              <button
                type="button"
                className="session-extend-btn"
                onClick={handleExtendSession}
              >
                연장
              </button>
            </div>
          </div>

          <div className={pageMessage.text ? (pageMessage.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '10px' }}>
            {pageMessage.text}
          </div>
        </section>

        <section className="forum-content-shell">
          <div className="forum-list-layout" style={forumListLayoutStyle}>
            <div className={compactListMode ? 'forum-side-column hidden' : 'forum-side-column'} aria-hidden={compactListMode}>
              <aside className="board-rail" aria-label="게시판 목록">
                <section className="board-rail-profile" aria-label="내 정보" style={profileSurface.cardStyle}>
                  <div className="board-profile-head-row">
                    <p className="board-rail-profile-kicker" style={profileSurface.kickerStyle}>내 정보</p>
                    <button
                      type="button"
                      className="board-notification-btn is-logout"
                      aria-label="로그아웃"
                      title="로그아웃"
                      onClick={() => handleLogout().catch(() => {})}
                    >
                      <LogOut size={15} />
                      <span className="board-top-logout-text">로그아웃</span>
                    </button>
                  </div>
                  <div className="board-rail-profile-user">
                    <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
                  </div>
                  <div className="board-rail-profile-actions">
                    <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myPostsPage)}>
                      <FileText size={14} />
                      내가 쓴 글
                    </button>
                    <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myCommentsPage)}>
                      <MessageSquare size={14} />
                      내가 쓴 댓글
                    </button>
                    {canAccessAdminSite ? (
                      <button
                        type="button"
                        className="board-rail-profile-btn"
                        onClick={() => navigate(MENTOR_FORUM_CONFIG.app.adminPage)}
                      >
                        <ShieldCheck size={14} />
                        관리자 사이트
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={hasUnreadNotifications ? 'board-rail-profile-btn has-unread' : 'board-rail-profile-btn'}
                      onClick={() => setNotificationCenterOpen(true)}
                    >
                      <Bell size={14} />
                      알림 센터
                      {hasUnreadNotifications ? <span className="board-notification-new">N</span> : null}
                    </button>
                    <button
                      type="button"
                      className="board-rail-profile-btn"
                      onClick={() => setMobilePushModalOpen(true)}
                    >
                      {isMobilePushEnabled && hasActivePushToken ? <Smartphone size={14} /> : <BellOff size={14} />}
                      모바일 알림
                      <span className={isMobilePushEnabled && hasActivePushToken ? 'board-mobile-push-state is-on' : 'board-mobile-push-state is-off'}>
                        {isMobilePushEnabled && hasActivePushToken ? '켜짐' : '꺼짐'}
                      </span>
                    </button>
                  </div>
                </section>
                <div className="board-rail-head">
                  <p className="meta" style={{ margin: 0 }}>게시판</p>
                </div>
                <div className="board-rail-list">
                  {drawerItems.map((item) => {
                    if (isDividerItem(item)) {
                      const label = normalizeText(item.dividerLabel);
                      return (
                        <div key={`rail-divider-${item.id}`} className="board-rail-divider" aria-hidden="true">
                          <span className="board-rail-divider-line" />
                          {label ? <span className="board-rail-divider-text">{label}</span> : null}
                        </div>
                      );
                    }

                    const active = item.id === selectedBoardId;
                    return (
                      <button
                        key={`rail-board-${item.id}`}
                        type="button"
                        className={active ? 'board-rail-item active' : 'board-rail-item'}
                        title={item.name || item.id}
                        onClick={() => handleSelectBoard(item.id)}
                      >
                        <span className="board-rail-item-text">{item.name || item.id}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="board-rail-recent board-rail-recent-detached" aria-label="최근 댓글">
                <div className="board-rail-recent-head">
                  <p className="meta" style={{ margin: 0 }}>최근 댓글</p>
                </div>
                <div className="board-rail-recent-list">
                  {recentCommentsLoading ? <p className="muted board-rail-recent-empty">불러오는 중...</p> : null}
                  {!recentCommentsLoading && !recentComments.length ? (
                    <p className="muted board-rail-recent-empty">표시할 댓글이 없습니다.</p>
                  ) : null}
                  {!recentCommentsLoading && recentComments.map((item, idx) => (
                    <button
                      key={item.key}
                      type="button"
                      className="board-rail-recent-item forum-enter-animate"
                      style={{ animationDelay: `${Math.min(idx, 10) * 34}ms` }}
                      onClick={() => handleMovePost(item.postId, item.boardId, item.commentId)}
                    >
                      <span className="board-rail-recent-content text-ellipsis-1" title={item.preview}>
                        {item.preview}
                      </span>
                      <span className="board-rail-recent-author text-ellipsis-1" title={item.authorName}>
                        {item.authorName}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="forum-list-main">
              <div id="coverForCalendarWrap" className={showCoverCalendar ? 'cover-calendar-wrap cover-calendar-in-main' : 'cover-calendar-wrap cover-calendar-in-main hidden'}>
                <div className="row space-between mobile-col">
                  <div>
                    <p className="meta" style={{ margin: 0 }}>월간 캘린더</p>
                    <h3 id="coverCalendarMonthLabel" style={{ marginTop: '4px' }}>{coverCalendarMonthLabel}</h3>
                  </div>

                  <div className="row cover-calendar-nav">
                    <button
                      id="coverCalendarPrevBtn"
                      type="button"
                      aria-label="이전 달"
                      onClick={() => {
                        setCoverCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
                      }}
                    >
                      이전
                    </button>

                    <button
                      id="coverCalendarTodayBtn"
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const picked = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        setCoverCalendarSelectedDate(picked);
                        setCoverCalendarCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                      }}
                    >
                      오늘
                    </button>

                    <button
                      id="coverCalendarNextBtn"
                      type="button"
                      aria-label="다음 달"
                      onClick={() => {
                        setCoverCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
                      }}
                    >
                      다음
                    </button>
                  </div>
                </div>

                <div id="coverCalendarGrid" className="cover-calendar-grid" style={{ marginTop: '10px' }}>
                  <div className="cover-calendar-weekdays">
                    {CALENDAR_WEEKDAYS.map((day, idx) => {
                      const extraClass = idx === 0 ? ' sun' : idx === 6 ? ' sat' : '';
                      return (
                        <div key={day} className={`cover-calendar-weekday${extraClass}`}>{day}</div>
                      );
                    })}
                  </div>

                  <div className="cover-calendar-days">
                    {coverCalendarCells.map((cell) => (
                      <button
                        key={cell.key}
                        type="button"
                        className={cell.classes}
                        onClick={() => {
                          const picked = fromDateKey(cell.key);
                          if (!picked) return;
                          setCoverCalendarSelectedDate(new Date(picked.getFullYear(), picked.getMonth(), picked.getDate()));
                          setCoverCalendarCursor(new Date(picked.getFullYear(), picked.getMonth(), 1));
                          setCoverCalendarModalDateKey(cell.key);
                          setCoverCalendarModalOpen(true);
                        }}
                      >
                        <span className="cover-calendar-day-num">{cell.day}</span>
                        <span className="cover-calendar-day-events" aria-hidden="true">
                          {normalizeText(currentBoard?.id) === WORK_SCHEDULE_BOARD_ID ? (
                            <>
                              {cell.previewEvents.map((event, idx) => (
                                event.label ? (
                                  <span
                                    key={`${cell.key}-${event.postId}-${idx}`}
                                    className="cover-calendar-event"
                                    title={event.label}
                                    style={pastelToneStyle(event.tone)}
                                  >
                                    {event.label}
                                  </span>
                                ) : null
                              ))}
                            </>
                          ) : (
                            compactListMode ? (
                              cell.eventCount > 0 ? (
                                <span className="cover-calendar-event-count">{cell.eventCount}건</span>
                              ) : null
                            ) : (
                              <>
                                {cell.previewEvents.map((event, idx) => (
                                  event.label ? (
                                    <span
                                      key={`${cell.key}-${event.postId}-${idx}`}
                                      className="cover-calendar-event"
                                      title={event.label}
                                      style={pastelToneStyle(event.tone)}
                                    >
                                      {event.label}
                                    </span>
                                  ) : null
                                ))}
                                {cell.hasMoreEvents ? (
                                  <span className="cover-calendar-event-more">+{cell.moreCount}건</span>
                                ) : null}
                              </>
                            )
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <p className="meta" style={{ marginTop: '8px' }}>
                  {normalizeText(currentBoard?.id) === WORK_SCHEDULE_BOARD_ID
                    ? '날짜를 누르면 해당 날짜의 근무일정 배치 목록이 모달로 열립니다.'
                    : '날짜를 누르면 해당 날짜의 구하는 중 요청 목록이 모달로 열립니다.'}
                </p>
              </div>

              <div className="row space-between mobile-col current-board-head">
                <div className="current-board-card">
                  <p className="current-board-label">현재 게시판</p>
                  <div className="row board-title-row current-board-title-row">
                    <h2 id="currentBoardTitle" className="break-anywhere">{currentBoardName}</h2>
                  </div>
                  <span
                    id="currentBoardAudienceBadges"
                    className={showCurrentBoardAudience ? 'audience-badge-row current-board-audience-row' : 'audience-badge-row current-board-audience-row hidden'}
                  >
                    {currentBoardRoles.map((role) => (
                      <RoleBadge key={`board-role-${role}`} role={role} roleDefMap={roleDefMap} />
                    ))}
                  </span>
                </div>
                <div className="row">
                  <span id="postCount" className="badge current-board-count">{totalPostCount}건</span>
                </div>
              </div>

              <div className="forum-category-bar">
                <div className="forum-category-tabs" role="tablist" aria-label="게시글 정렬">
                  {postListViewTabs.map((tab) => {
                    const active = postListViewMode === tab.key;
                    return (
                      <button
                        key={`post-list-view-${tab.key}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={active ? 'forum-category-tab active' : 'forum-category-tab'}
                        onClick={() => setPostListViewMode(tab.key)}
                      >
                        <span>{tab.label}</span>
                        {typeof tab.count === 'number' ? <span className="forum-category-tab-count">({tab.count})</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {showPinToolbar ? (
                <div className="forum-pin-toolbar" aria-label="상단 고정 관리">
                  <span className="forum-pin-toolbar-count">
                    선택 {selectedPinPostCount}건
                    {selectedPinMode === 'pinned' ? ' · 고정글' : selectedPinMode === 'unpinned' ? ' · 일반글' : ''}
                  </span>
                  <div className="forum-pin-toolbar-actions">
                    {selectedPinMode === 'pinned' ? (
                      <button
                        type="button"
                        className="forum-pin-action-btn is-unpin"
                        disabled={pinActionPending || selectedPinPostCount <= 0}
                        onClick={() => handleBulkPinUpdate(false)}
                      >
                        <PinOff size={14} />
                        고정 해제
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="forum-pin-action-btn"
                        disabled={pinActionPending || selectedPinPostCount <= 0}
                        onClick={() => handleBulkPinUpdate(true)}
                      >
                        <Pin size={14} />
                        상단 고정
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div id="postList" className="dc-list-wrap" style={{ marginTop: '10px' }}>
                {!compactListMode ? (
                  <table className="dc-list-table forum-post-table">
                    <thead>
                      <tr>
                        {canManagePinInCurrentBoard ? <th style={{ width: '56px' }}>선택</th> : null}
                        <th style={{ width: '70px' }}>번호</th>
                        <th>제목</th>
                        <th style={{ width: '140px' }}>작성자</th>
                        <th style={{ width: '150px' }}>작성일</th>
                        <th style={{ width: '84px' }}>조회</th>
                        <th
                          id="postListExtraHeader"
                          className={isAllBoardSelected ? '' : 'hidden'}
                          style={{ width: '140px' }}
                        >
                          게시판
                        </th>
                      </tr>
                    </thead>
                    <tbody id="postListTableBody">
                      {loadingPosts ? (
                        <tr>
                          <td colSpan={desktopPostTableColSpan} className="muted">{loadingText}</td>
                        </tr>
                      ) : currentPagePosts.map((post, idx) => {
                        const no = totalPostCount - (currentPageStartIndex + idx);
                        const board = boardLookup.get(normalizeText(post.boardId)) || null;
                        const boardLabel = board?.name || post.boardId || '-';
                        const boardTone = buildPastelTone(board?.id || boardLabel);
                        const commentCount = numberOrZero(commentCountByPost[post.id]);
                        const isRecentPost = recentUnreadPostIdSet.has(String(post.id));
                        const coverSummary = normalizeText(post.boardId) === COVER_FOR_BOARD_ID ? summarizeCoverForPost(post) : null;
                        const coverStatusClass = coverSummary?.statusClass || '';
                        const isCoverClosed = !!coverSummary?.isClosed;
                        const coverStatusTag = coverSummary?.label || '';
                        const isPinned = isPinnedPost(post);
                        const desktopTitleClass = [
                          commentCount > 0 ? 'dc-title with-comment text-ellipsis-1' : 'dc-title text-ellipsis-1',
                          isCoverClosed ? 'is-struck' : ''
                        ].join(' ');
                        const rowClassName = [
                          'dc-list-row',
                          isCoverClosed ? 'is-closed' : '',
                          isPinned ? 'is-pinned' : ''
                        ].filter(Boolean).join(' ');
                        const rowMotionStyle = {
                          animationDelay: `${Math.min(idx, 12) * 20}ms`
                        };

                        return (
                          <tr
                            key={post.id}
                            className={`${rowClassName} forum-enter-animate`}
                            style={rowMotionStyle}
                            onClick={() => handleMovePost(post.id, post.boardId)}
                          >
                            {canManagePinInCurrentBoard ? (
                              <td className="post-pin-select-cell" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="post-pin-select-checkbox"
                                  aria-label={`${post.title || '(제목 없음)'} 선택`}
                                  checked={!!selectedPinPostIdMap[post.id]}
                                  disabled={isPostPinSelectionDisabled(post)}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => handleTogglePinSelect(post, event.target.checked)}
                                />
                              </td>
                            ) : null}
                            <td>{no}</td>
                            <td>
                              <div className="dc-title-cell">
                                <span className="dc-title-row">
                                  {isPinned ? <span className="post-pin-badge" title="상단 고정">고정</span> : null}
                                  {isRecentPost ? <span className="post-new-badge" title="새 글">N</span> : null}
                                  {coverStatusTag ? <span className={`cover-status-chip status-${coverStatusClass}`}>[{coverStatusTag}]</span> : null}
                                  <span
                                    className={desktopTitleClass}
                                    title={post.title || '(제목 없음)'}
                                  >
                                    {post.title || '(제목 없음)'}
                                  </span>
                                  {commentCount > 0 ? <span className="dc-comment-count">[{commentCount}]</span> : null}
                                </span>
                                <span className="dc-title-sub">
                                  <span
                                    className="dc-title-sub-dot"
                                    aria-hidden="true"
                                    style={{ backgroundColor: boardTone.border }}
                                  />
                                  <span className="dc-title-sub-text text-ellipsis-1" title={boardLabel}>{boardLabel}</span>
                                </span>
                              </div>
                            </td>
                            <td>
                              <AuthorWithRole
                                name={post.authorName || post.authorUid || '-'}
                                role={post.authorRole || 'Newbie'}
                                roleDefMap={roleDefMap}
                              />
                            </td>
                            <td>{formatPostListDate(post.createdAt)}</td>
                            <td><span className="stat-chip">{numberOrZero(post.views)}</span></td>
                            {isAllBoardSelected ? <td><span className="text-ellipsis-1" title={boardLabel}>{boardLabel}</span></td> : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}

                <div className={compactListMode ? 'mobile-post-list' : 'mobile-post-list hidden'} aria-label="모바일 게시글 목록">
                  {loadingPosts ? (
                    <button type="button" className="mobile-post-item" disabled>
                      <span className="mobile-post-title">
                        <span className="mobile-post-title-text">{loadingText}</span>
                      </span>
                    </button>
                  ) : currentPagePosts.map((post, idx) => {
                    const no = totalPostCount - (currentPageStartIndex + idx);
                    const board = boardLookup.get(normalizeText(post.boardId)) || null;
                    const boardLabel = board?.name || post.boardId || '-';
                    const commentCount = numberOrZero(commentCountByPost[post.id]);
                    const isRecentPost = recentUnreadPostIdSet.has(String(post.id));
                    const coverSummary = normalizeText(post.boardId) === COVER_FOR_BOARD_ID ? summarizeCoverForPost(post) : null;
                    const coverStatusClass = coverSummary?.statusClass || '';
                    const isCoverClosed = !!coverSummary?.isClosed;
                    const coverStatusTag = coverSummary?.label || '';
                    const isPinned = isPinnedPost(post);

                    return (
                      <div key={`mobile-${post.id}`} className={canManagePinInCurrentBoard ? 'mobile-post-row with-select' : 'mobile-post-row'}>
                        {canManagePinInCurrentBoard ? (
                          <input
                            type="checkbox"
                            className="post-pin-select-checkbox mobile-post-pin-checkbox"
                            aria-label={`${post.title || '(제목 없음)'} 선택`}
                            checked={!!selectedPinPostIdMap[post.id]}
                            disabled={isPostPinSelectionDisabled(post)}
                            onChange={(event) => handleTogglePinSelect(post, event.target.checked)}
                          />
                        ) : null}
                        <button
                          type="button"
                          className={[
                            'mobile-post-item',
                            'forum-enter-animate',
                            isCoverClosed ? 'is-closed' : '',
                            isPinned ? 'is-pinned' : ''
                          ].filter(Boolean).join(' ')}
                          style={{ animationDelay: `${Math.min(idx, 12) * 18}ms` }}
                          onClick={() => handleMovePost(post.id, post.boardId)}
                        >
                          <div className="mobile-post-top">
                            <span className="mobile-post-no">#{no}</span>
                            {isAllBoardSelected ? (
                              <span className="mobile-post-board text-ellipsis-1" title={boardLabel}>{boardLabel}</span>
                            ) : null}
                          </div>
                          <div className="mobile-post-title-row">
                            <div className="mobile-post-title" title={post.title || '(제목 없음)'}>
                              {isPinned ? <span className="post-pin-badge" title="상단 고정">고정</span> : null}
                              {isRecentPost ? <span className="post-new-badge" title="새 글">N</span> : null}
                              {coverStatusTag ? <span className={`cover-status-chip status-${coverStatusClass}`}>[{coverStatusTag}]</span> : null}
                              <span className={isCoverClosed ? 'mobile-post-title-text is-struck' : 'mobile-post-title-text'}>
                                {post.title || '(제목 없음)'}
                              </span>
                              {commentCount > 0 ? <span className="mobile-comment-count">[{commentCount}]</span> : null}
                            </div>
                          </div>
                          <div className="mobile-post-meta-row">
                            <span className="mobile-post-author text-ellipsis-1" title={post.authorName || post.authorUid || '-'}>
                              <AuthorWithRole
                                name={post.authorName || post.authorUid || '-'}
                                role={post.authorRole || 'Newbie'}
                                roleDefMap={roleDefMap}
                              />
                            </span>
                            <span className="mobile-post-date">{formatPostListDateMobile(post.createdAt)}</span>
                            <span className="mobile-post-views">조회 {numberOrZero(post.views)}</span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div
                  id="postListEmpty"
                  className={
                    !activeListMessage.text
                      ? 'hidden'
                      : activeListMessage.type === 'error'
                        ? 'error'
                        : isPostListEmptyState
                          ? 'post-list-empty-state'
                          : 'notice'
                  }
                >
                  {isPostListEmptyState ? (
                    <div className="post-list-empty-inner">
                      <span className="post-list-empty-icon" aria-hidden="true">
                        <Inbox size={16} />
                      </span>
                      <p className="post-list-empty-title">{activeListMessage.text}</p>
                      <p className="post-list-empty-copy">
                        {postListViewMode === POST_LIST_VIEW_MODE.POPULAR
                          ? '조회수나 댓글이 쌓인 글이 생기면 이곳에 자동으로 표시됩니다.'
                          : '첫 게시글을 작성해서 게시판을 시작해보세요.'}
                      </p>
                    </div>
                  ) : activeListMessage.text}
                </div>
              </div>

              {!loadingPosts && totalPostCount > POSTS_PER_PAGE ? (
                <div className="post-pagination-wrap">
                  <button
                    type="button"
                    className="pagination-btn"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  >
                    이전
                  </button>
                  {paginationPages.map((pageNo) => (
                    <button
                      key={`post-page-${pageNo}`}
                      type="button"
                      className={pageNo === safeCurrentPage ? 'pagination-btn active' : 'pagination-btn'}
                      onClick={() => setCurrentPage(pageNo)}
                    >
                      {pageNo}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pagination-btn"
                    disabled={safeCurrentPage >= totalPageCount}
                    onClick={() => setCurrentPage((prev) => Math.min(totalPageCount, prev + 1))}
                  >
                    다음
                  </button>
                  <span className="pagination-status">{safeCurrentPage} / {totalPageCount}</span>
                </div>
              ) : null}

              <div className="row" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
                <button
                  id="openComposerFab"
                  type="button"
                  className={composerFabHidden ? 'btn-primary hidden' : 'btn-primary'}
                  disabled={composerFabHidden}
                  onClick={openComposer}
                >
                  <PencilLine size={16} />
                  글쓰기
                </button>
              </div>
            </div>
          </div>
        </section>
        </div>
      </motion.main>

      <AnimatePresence>
        {boardDrawerOpen ? (
          <>
            <motion.div
              id="boardDrawerBackdrop"
              className="drawer-backdrop"
              onClick={() => setBoardDrawerOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />

            <motion.aside
              id="boardDrawer"
              className="board-drawer"
              aria-hidden={!boardDrawerOpen}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 33, mass: 0.62 }}
            >
              <div className="row space-between">
                <h3>게시판 탐색</h3>
                <button
                  id="boardDrawerCloseBtn"
                  type="button"
                  className="panel-close-btn board-drawer-close-btn"
                  onClick={() => setBoardDrawerOpen(false)}
                >
                  닫기
                </button>
              </div>

              <div id="boardDrawerList" className="board-drawer-list" style={{ marginTop: '10px' }}>
                <section className="board-drawer-profile" aria-label="내 정보" style={profileSurface.cardStyle}>
                  <div className="board-profile-head-row">
                    <p className="board-drawer-profile-kicker" style={profileSurface.kickerStyle}>내 정보</p>
                    <button
                      type="button"
                      className="board-notification-btn is-logout"
                      aria-label="로그아웃"
                      title="로그아웃"
                      onClick={() => {
                        setBoardDrawerOpen(false);
                        handleLogout().catch(() => {});
                      }}
                    >
                      <LogOut size={15} />
                      <span className="board-top-logout-text">로그아웃</span>
                    </button>
                  </div>
                  <div className="board-drawer-profile-user">
                    <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
                  </div>
                  <div className="board-drawer-profile-actions">
                    <button
                      type="button"
                      className="board-drawer-profile-btn"
                      onClick={() => {
                        setBoardDrawerOpen(false);
                        navigate(myPostsPage);
                      }}
                    >
                      <FileText size={14} />
                      내가 쓴 글
                    </button>
                    <button
                      type="button"
                      className="board-drawer-profile-btn"
                      onClick={() => {
                        setBoardDrawerOpen(false);
                        navigate(myCommentsPage);
                      }}
                    >
                      <MessageSquare size={14} />
                      내가 쓴 댓글
                    </button>
                    {canAccessAdminSite ? (
                      <button
                        type="button"
                        className="board-drawer-profile-btn"
                        onClick={() => {
                          setBoardDrawerOpen(false);
                          navigate(MENTOR_FORUM_CONFIG.app.adminPage);
                        }}
                      >
                        <ShieldCheck size={14} />
                        관리자 사이트
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={hasUnreadNotifications ? 'board-drawer-profile-btn has-unread' : 'board-drawer-profile-btn'}
                      onClick={() => {
                        setBoardDrawerOpen(false);
                        setNotificationCenterOpen(true);
                      }}
                    >
                      <Bell size={14} />
                      알림 센터
                      {hasUnreadNotifications ? <span className="board-notification-new">N</span> : null}
                    </button>
                    <button
                      type="button"
                      className="board-drawer-profile-btn"
                      onClick={() => {
                        setBoardDrawerOpen(false);
                        setMobilePushModalOpen(true);
                      }}
                    >
                      {isMobilePushEnabled && hasActivePushToken ? <Smartphone size={14} /> : <BellOff size={14} />}
                      모바일 알림
                      <span className={isMobilePushEnabled && hasActivePushToken ? 'board-mobile-push-state is-on' : 'board-mobile-push-state is-off'}>
                        {isMobilePushEnabled && hasActivePushToken ? '켜짐' : '꺼짐'}
                      </span>
                    </button>
                  </div>
                </section>
                {drawerItems.map((item) => {
                  if (isDividerItem(item)) {
                    const label = normalizeText(item.dividerLabel);
                    return (
                      <div key={`divider-${item.id}`} className="board-drawer-divider" aria-hidden="true">
                        <span className="board-drawer-divider-line" />
                        {label ? <span className="board-drawer-divider-text">{label}</span> : null}
                      </div>
                    );
                  }

                  const active = item.id === selectedBoardId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={active ? 'board-drawer-item active' : 'board-drawer-item'}
                      title={item.name || item.id}
                      onClick={() => {
                        handleSelectBoard(item.id);
                        setBoardDrawerOpen(false);
                      }}
                    >
                      <span className="board-drawer-item-text">{item.name || item.id}</span>
                    </button>
                  );
                })}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <Dialog open={guideModalOpen} onOpenChange={setGuideModalOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-balance text-lg font-semibold">멘토스 사용 설명서</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              처음 방문한 분도 바로 사용할 수 있도록, 실제 사용 순서와 실제 버튼 모양 기준으로 정리했습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-1 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">0. 시작 전에</p>
              <p className="mt-2 text-sm text-muted-foreground">
                처음 사용할 때는 아래 순서대로 따라하면 됩니다.
                {' '}
                <strong>게시판 선택 → 글 읽기 → 필요하면 글/댓글 작성 → 알림 확인</strong>
                {' '}
                순서입니다.
              </p>
              <div className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">전체 게시글</span>
                  :
                  {' '}
                  여러 게시판 글을 모아보는 화면입니다.
                </p>
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">글쓰기</span>
                  :
                  {' '}
                  원하는 게시판을 먼저 선택해야 사용할 수 있습니다.
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">0-1. 테마 바꾸기 (라이트/다크/엑셀)</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  우측 상단
                  {' '}
                  <button type="button" className="btn-muted guide-static-btn" style={{ minHeight: '30px', padding: '0.2rem 0.55rem' }}>
                    라이트/다크/엑셀
                  </button>
                  {' '}
                  버튼(현재 테마 표시 + 테마 토글)을 눌러 화면 테마를 변경할 수 있습니다.
                </li>
                <li>
                  테마는
                  {' '}
                  <strong>라이트 → 다크 → 엑셀 → 라이트</strong>
                  {' '}
                  순서로 순환됩니다.
                </li>
                <li>선택한 테마는 저장되며, 새로고침하거나 다른 탭을 열어도 동일하게 유지/동기화됩니다.</li>
              </ol>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">1. 게시판 선택하고 글 읽기</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  왼쪽
                  {' '}
                  <button
                    type="button"
                    className="board-rail-item active guide-static-btn"
                    style={{ width: 'auto', padding: '0.25rem 0.6rem', borderRadius: '10px' }}
                  >
                    게시판
                  </button>
                  {' '}
                  목록에서 원하는 게시판을 선택합니다.
                </li>
                <li>목록에서 제목을 누르면 게시글 상세 화면으로 이동합니다.</li>
                <li>
                  상세 화면에서는
                  {' '}
                  <button type="button" className="btn-muted guide-static-btn" style={{ minHeight: '30px', padding: '0.2rem 0.55rem' }}>
                    목록으로
                  </button>
                  {' '}
                  버튼으로 다시 목록으로 돌아옵니다.
                </li>
              </ol>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">2. 글 작성하기</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>먼저 글을 올릴 게시판을 선택합니다.</li>
                <li>
                  화면에서
                  {' '}
                  <button type="button" className="btn-primary guide-static-btn" style={{ minHeight: '30px', padding: '0.22rem 0.58rem' }}>
                    <PencilLine size={14} />
                    글쓰기
                  </button>
                  {' '}
                  버튼을 눌러 작성창을 엽니다.
                </li>
                <li>
                  제목과 본문을 입력하고,
                  {' '}
                  <button type="button" className="btn-primary guide-static-btn" style={{ minHeight: '30px', padding: '0.22rem 0.58rem' }}>
                    글 등록
                  </button>
                  {' '}
                  을 누르면 완료됩니다.
                </li>
                <li>대체근무 게시판은 날짜/시간/체험관까지 입력해야 등록됩니다.</li>
              </ol>
              <div className="error" style={{ marginTop: '10px' }}>
                중요: 게시글 작성은 각 게시판 화면에서만 가능합니다. <strong>전체 게시글</strong> 화면에서는 글을 작성할 수 없습니다.
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                작성을 취소할 때는
                {' '}
                <button type="button" className="btn-muted guide-static-btn" style={{ minHeight: '30px', padding: '0.2rem 0.55rem' }}>
                  취소
                </button>
                {' '}
                버튼을 누르면 됩니다.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">3. 댓글 쓰기와 멘션</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>게시글 상세 하단에서 댓글을 작성하고 등록합니다.</li>
                <li>
                  댓글/글 본문에서
                  {' '}
                  <span className="inline-flex items-center rounded-lg border border-border bg-background px-2 py-1 text-xs font-bold text-foreground">@닉네임</span>
                  {' '}
                  을 입력하면 해당 사용자에게 멘션 알림이 전달됩니다.
                </li>
                <li>
                  {' '}
                  <span className="inline-flex items-center rounded-lg border border-border bg-background px-2 py-1 text-xs font-bold text-foreground">@all</span>
                  {' '}
                  은 관리자 전용 기능이며, 사용 시 전체 멘션 알림을 보낼 수 있습니다.
                </li>
              </ol>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">4. 알림 확인하기</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>내 정보에서 알림 센터 버튼을 눌러 알림 창을 엽니다.</li>
                <li>새 글/댓글/멘션 알림을 확인하고 바로 해당 글로 이동할 수 있습니다.</li>
                <li>필요하면 댓글 알림, 멘션 알림, 게시판별 알림을 켜고 끌 수 있습니다.</li>
              </ol>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">5. 내 활동 바로가기</p>
              <div className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">내가 쓴 글</span>
                  :
                  {' '}
                  내가 작성한 게시글을 최신순으로 확인할 수 있습니다.
                </p>
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">내가 쓴 댓글</span>
                  :
                  {' '}
                  내가 작성한 댓글 목록에서 원본 게시글로 바로 이동할 수 있습니다.
                </p>
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">최근 댓글</span>
                  :
                  {' '}
                  왼쪽 패널에서 전체 댓글 기준 최신 5개를 빠르게 확인할 수 있습니다.
                </p>
                <p className="m-0 rounded-lg border border-border bg-background px-3 py-2">
                  <span className="font-bold text-foreground">고정 배지</span>
                  :
                  {' '}
                  목록에서
                  {' '}
                  <strong>고정</strong>
                  {' '}
                  표시가 있는 글은 상단에 유지되는 중요 글입니다.
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">6. 모바일에서 사용하기</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>오른쪽 위 메뉴(☰)를 엽니다.</li>
                <li>게시판 선택, 내가 쓴 글/댓글, 알림 센터를 동일하게 사용할 수 있습니다.</li>
                <li>글 읽기/댓글 작성 흐름은 PC와 동일합니다.</li>
              </ol>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">7. iPhone(iOS) 알림 받기 - 처음부터 끝까지</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  iPhone
                  {' '}
                  <strong>Safari</strong>
                  {' '}
                  에서 포럼 주소를 엽니다.
                </li>
                <li>
                  Safari 하단
                  {' '}
                  <strong>공유 버튼</strong>
                  {' '}
                  →
                  {' '}
                  <strong>홈 화면에 추가</strong>
                  {' '}
                  를 눌러 앱 아이콘을 만듭니다.
                </li>
                <li>
                  Safari 탭이 아니라
                  {' '}
                  <strong>홈 화면 아이콘으로 포럼을 실행</strong>
                  {' '}
                  합니다. (iOS 웹푸시는 이 방식에서만 수신됩니다)
                </li>
                <li>
                  로그인 후 왼쪽
                  {' '}
                  <strong>내 정보 → 모바일 알림</strong>
                  {' '}
                  버튼을 눌러 설정 창을 엽니다.
                </li>
                <li>
                  <strong>모바일 알림 켜기</strong>
                  {' '}
                  버튼을 누르고, iOS 권한 팝업이 뜨면
                  {' '}
                  <strong>허용</strong>
                  {' '}
                  을 선택합니다.
                </li>
                <li>
                  같은 창에서 아래 3가지를 확인합니다:
                  {' '}
                  <strong>기기 지원=지원됨 / 알림 권한=허용 / 활성 기기=1대 이상</strong>
                  .
                </li>
                <li>
                  바로 아래
                  {' '}
                  <strong>게시판별 모바일 알림</strong>
                  {' '}
                  에서 받고 싶은 게시판만 켭니다.
                </li>
                <li>
                  테스트:
                  {' '}
                  다른 계정에서 글/댓글/멘션을 보내고, 잠금 화면 또는 상단 배너로 알림이 오는지 확인합니다.
                </li>
              </ol>
              <div className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                iOS에서 알림이 안 오면:
                {' '}
                <strong>홈 화면 앱 완전 종료 후 재실행</strong>
                ,
                {' '}
                <strong>설정 &gt; 알림에서 포럼 앱 허용</strong>
                ,
                {' '}
                <strong>집중 모드/방해금지 해제</strong>
                ,
                {' '}
                <strong>저전력 모드 해제</strong>
                {' '}
                순서로 점검하세요.
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">8. Android 알림 받기 - 처음부터 끝까지</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Android
                  {' '}
                  <strong>Chrome</strong>
                  {' '}
                  에서 포럼 주소를 엽니다.
                </li>
                <li>
                  로그인 후
                  {' '}
                  <strong>내 정보 → 모바일 알림</strong>
                  {' '}
                  설정 창으로 이동합니다.
                </li>
                <li>
                  <strong>모바일 알림 켜기</strong>
                  {' '}
                  를 누르고, 브라우저 알림 권한 요청이 뜨면
                  {' '}
                  <strong>허용</strong>
                  {' '}
                  을 선택합니다.
                </li>
                <li>
                  상태 영역에서
                  {' '}
                  <strong>기기 지원=지원됨 / 알림 권한=허용 / 활성 기기=1대 이상</strong>
                  {' '}
                  을 확인합니다.
                </li>
                <li>
                  <strong>게시판별 모바일 알림</strong>
                  {' '}
                  에서 받고 싶은 게시판만 켭니다.
                </li>
                <li>
                  테스트:
                  {' '}
                  다른 계정으로 글/댓글/멘션을 보내서 알림이 도착하는지 확인합니다.
                </li>
                <li>
                  안정성을 높이려면
                  {' '}
                  <strong>홈 화면에 추가(PWA)</strong>
                  {' '}
                  후 아이콘 실행 방식으로 사용하세요.
                </li>
              </ol>
              <div className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                Android에서 알림이 안 오면:
                {' '}
                <strong>Chrome 사이트 권한(알림 허용)</strong>
                ,
                {' '}
                <strong>OS 앱 알림 허용</strong>
                ,
                {' '}
                <strong>배터리 최적화 예외</strong>
                {' '}
                순서로 확인하세요.
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">9. 막힐 때 빠른 확인</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center rounded-lg border border-border bg-background px-2 py-1 font-bold text-foreground">게시판이 안 보임 → 권한 게시판일 수 있음</span>
                <span className="inline-flex items-center rounded-lg border border-border bg-background px-2 py-1 font-bold text-foreground">알림이 안 옴 → 알림 센터 설정 확인</span>
                <span className="inline-flex items-center rounded-lg border border-border bg-background px-2 py-1 font-bold text-foreground">문제 지속 → 로그아웃 후 재로그인</span>
              </div>
            </section>
          </div>

          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-muted" onClick={() => setGuideModalOpen(false)}>
              닫기
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mobilePushModalOpen} onOpenChange={setMobilePushModalOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-semibold">모바일 알림 설정</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              내 정보에서 모바일 푸시 알림을 켜고, 받고 싶은 게시판만 따로 선택할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-1 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">현재 상태</p>
              <div className="mobile-push-status-grid">
                <div className="mobile-push-status-item">
                  <span className="mobile-push-status-label">기기 지원</span>
                  <strong className={mobilePushCapability.supported ? 'mobile-push-status-value is-on' : 'mobile-push-status-value is-off'}>
                    {mobilePushCapability.supported ? '지원됨' : '미지원'}
                  </strong>
                </div>
                <div className="mobile-push-status-item">
                  <span className="mobile-push-status-label">알림 권한</span>
                  <strong className={notificationPermission === 'granted' ? 'mobile-push-status-value is-on' : 'mobile-push-status-value is-off'}>
                    {notificationPermissionText}
                  </strong>
                </div>
                <div className="mobile-push-status-item">
                  <span className="mobile-push-status-label">활성 기기</span>
                  <strong className={hasActivePushToken ? 'mobile-push-status-value is-on' : 'mobile-push-status-value is-off'}>
                    {hasActivePushToken ? `${mobilePushTokens.filter((item) => item.enabled !== false).length}대` : '없음'}
                  </strong>
                </div>
              </div>

              {mobilePushCapability.reason && !mobilePushCapability.supported ? (
                <p className="meta mobile-push-note" style={{ marginTop: '8px' }}>{mobilePushCapability.reason}</p>
              ) : null}
              <p className="meta mobile-push-note" style={{ marginTop: '8px' }}>
                iPhone은 Safari에서 홈 화면에 추가한 웹앱(PWA)에서만 웹 푸시를 받을 수 있습니다.
              </p>

              {mobilePushStatus.text ? (
                <div className={mobilePushStatus.type === 'error' ? 'error' : 'notice'} style={{ marginTop: '10px' }}>
                  {mobilePushStatus.text}
                </div>
              ) : null}

              <div className="row mobile-wrap" style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={mobilePushWorking || !mobilePushCapability.supported}
                  onClick={enableMobilePush}
                >
                  <Smartphone size={15} />
                  모바일 알림 켜기
                </button>
                <button
                  type="button"
                  className="btn-muted"
                  disabled={mobilePushWorking}
                  onClick={disableMobilePush}
                >
                  <BellOff size={15} />
                  모바일 알림 끄기
                </button>
                <button
                  type="button"
                  className="btn-muted"
                  disabled={mobilePushWorking}
                  onClick={() => refreshMobilePushCapability().catch((err) => {
                    setMobilePushStatus({ type: 'error', text: normalizeErrMessage(err, '모바일 알림 상태를 확인하지 못했습니다.') });
                  })}
                >
                  상태 새로고침
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">게시판별 모바일 알림</p>
              <p className="meta mobile-push-note" style={{ marginTop: '6px' }}>
                모바일 알림을 켠 뒤, 원하는 게시판만 선택해서 받을 수 있습니다.
              </p>
              <div className="mobile-push-board-list">
                {notificationBoardItems.length ? notificationBoardItems.map((board) => {
                  const boardId = normalizeText(board?.id);
                  const boardName = normalizeText(board?.name) || boardId;
                  const enabled = isMobilePushBoardEnabled(boardId);
                  return (
                    <button
                      key={`mobile-push-board-${boardId}`}
                      type="button"
                      className={enabled ? 'notification-pref-item is-on' : 'notification-pref-item is-off'}
                      disabled={mobilePushWorking || !isMobilePushEnabled || !hasActivePushToken}
                      onClick={() => toggleMobilePushBoardPreference(boardId)}
                    >
                      <span className="notification-pref-main">
                        <span className="notification-pref-name">{boardName}</span>
                        <span className="notification-pref-state">{enabled ? '켜짐' : '꺼짐'}</span>
                      </span>
                      {enabled ? <Bell size={14} /> : <BellOff size={14} />}
                    </button>
                  );
                }) : (
                  <p className="muted" style={{ margin: 0 }}>표시할 게시판이 없습니다.</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-bold text-foreground">근무일정 푸시 알림</p>
              <p className="meta mobile-push-note" style={{ marginTop: '6px' }}>
                근무일정 캘린더에서 본인 이름이 매칭된 전날/당일 알림을 푸시로 받습니다.
              </p>
              {(() => {
                const enabled = isNotificationTypeEnabled(NOTIFICATION_PREF_KEY.WORK_SCHEDULE_SHIFT_ALERT);
                return (
                  <button
                    type="button"
                    className={enabled ? 'notification-pref-item is-on' : 'notification-pref-item is-off'}
                    disabled={mobilePushWorking || !isMobilePushEnabled || !hasActivePushToken}
                    onClick={() => toggleNotificationTypePreference(NOTIFICATION_PREF_KEY.WORK_SCHEDULE_SHIFT_ALERT)}
                  >
                    <span className="notification-pref-main">
                      <span className="notification-pref-name">근무일정 전날/당일 푸시</span>
                      <span className="notification-pref-state">{enabled ? '켜짐' : '꺼짐'}</span>
                    </span>
                    {enabled ? <Bell size={14} /> : <BellOff size={14} />}
                  </button>
                );
              })()}
            </section>
          </div>

          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-muted" onClick={() => setMobilePushModalOpen(false)}>
              닫기
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {notificationCenterOpen ? (
          <div className="notification-center-modal" aria-hidden={!notificationCenterOpen}>
            <motion.div
              className="notification-center-backdrop"
              onClick={() => setNotificationCenterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />
            <motion.section
              className="card notification-center-panel"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="row space-between mobile-col">
                <div>
                  <h3 style={{ margin: 0 }}>알림 센터</h3>
                  <p className="meta" style={{ margin: '6px 0 0' }}>
                    미확인 알림 {unreadNotificationCount}건
                  </p>
                </div>
                <div className="row notification-center-actions">
                  <button
                    type="button"
                    className="btn-muted notification-mark-read-btn"
                    onClick={markAllNotificationsRead}
                  >
                    모두 읽음
                  </button>
                  <button
                    type="button"
                    className="panel-close-btn notification-close-btn"
                    onClick={() => setNotificationCenterOpen(false)}
                  >
                    닫기
                  </button>
                </div>
              </div>

              <div className="notification-center-layout">
                <section className="notification-pref-panel">
                  <div className="notification-pref-group">
                    <p className="meta" style={{ margin: 0, fontWeight: 700 }}>댓글 알림 설정</p>
                    <div className="notification-pref-list notification-pref-list-compact">
                      {[
                        { key: NOTIFICATION_PREF_KEY.COMMENT, label: '댓글 알림' },
                        { key: NOTIFICATION_PREF_KEY.MENTION, label: '멘션 알림' }
                      ].map((entry) => {
                        const enabled = isNotificationTypeEnabled(entry.key);
                        return (
                          <button
                            key={`notification-pref-type-${entry.key}`}
                            type="button"
                            className={enabled ? 'notification-pref-item is-on' : 'notification-pref-item is-off'}
                            onClick={() => toggleNotificationTypePreference(entry.key)}
                          >
                            <span className="notification-pref-main">
                              <span className="notification-pref-name">{entry.label}</span>
                              <span className="notification-pref-state">{enabled ? '켜짐' : '꺼짐'}</span>
                            </span>
                            {enabled ? <Bell size={14} /> : <BellOff size={14} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="notification-pref-group">
                    <p className="meta" style={{ margin: 0, fontWeight: 700 }}>게시판 알림 설정</p>
                    <div className="notification-pref-list">
                      {notificationBoardItems.length ? notificationBoardItems.map((board) => {
                        const boardId = normalizeText(board?.id);
                        const boardName = normalizeText(board?.name) || boardId;
                        const enabled = isBoardNotificationEnabled(boardId);
                        return (
                          <button
                            key={`notification-pref-${boardId}`}
                            type="button"
                            className={enabled ? 'notification-pref-item is-on' : 'notification-pref-item is-off'}
                            onClick={() => toggleBoardNotification(boardId)}
                          >
                            <span className="notification-pref-main">
                              <span className="notification-pref-name">{boardName}</span>
                              <span className="notification-pref-state">{enabled ? '켜짐' : '꺼짐'}</span>
                            </span>
                            {enabled ? <Bell size={14} /> : <BellOff size={14} />}
                          </button>
                        );
                      }) : (
                        <p className="muted" style={{ margin: 0 }}>표시할 게시판이 없습니다.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="notification-feed-panel">
                  <p className="meta" style={{ margin: 0, fontWeight: 700 }}>최근 알림</p>
                  <div className="notification-feed-filter-row">
                    {[
                      { key: NOTIFICATION_FEED_FILTER.ALL, label: '전체' },
                      { key: NOTIFICATION_FEED_FILTER.POST, label: '새 글' },
                      { key: NOTIFICATION_FEED_FILTER.MENTION, label: '멘션' },
                      { key: NOTIFICATION_FEED_FILTER.COMMENT, label: '댓글' }
                    ].map((entry) => (
                      <button
                        key={`notification-filter-${entry.key}`}
                        type="button"
                        className={notificationFeedFilter === entry.key ? 'notification-filter-btn is-active' : 'notification-filter-btn'}
                        onClick={() => setNotificationFeedFilter(entry.key)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <div className="notification-feed-list">
                    {filteredNotifications.length ? filteredNotifications.map((item) => {
                      const isUnread = !(Number(item?.readAtMs) > 0);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={isUnread ? 'notification-feed-item unread' : 'notification-feed-item'}
                          onClick={() => {
                            markNotificationRead(item.id);
                            setNotificationCenterOpen(false);
                            handleMovePost(item.postId, item.boardId, item.commentId);
                          }}
                        >
                          <div className="notification-feed-head">
                            <span className="notification-feed-board">[{item.boardName || item.boardId}]</span>
                            <span className="notification-feed-date">{formatNotificationDate(item.createdAtMs)}</span>
                          </div>
                          <p className="notification-feed-title text-ellipsis-1">
                            {notificationHeadline(item)}
                          </p>
                          <p className="notification-feed-meta">
                            {notificationCategoryLabel(item)}
                            {isUnread ? <span className="notification-feed-new">New</span> : null}
                          </p>
                        </button>
                      );
                    }) : (
                      <p className="muted" style={{ margin: 0 }}>최근 2주 내 알림이 없습니다.</p>
                    )}
                  </div>
                </section>
              </div>
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {coverCalendarModalOpen ? (
          <div className="cover-calendar-modal" aria-hidden={!coverCalendarModalOpen}>
            <motion.div
              className="cover-calendar-modal-backdrop"
              onClick={() => setCoverCalendarModalOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />
            <motion.section
              className="card cover-calendar-modal-panel"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="row space-between">
                <h3 style={{ margin: 0 }}>{coverCalendarModalDateText}</h3>
                <button type="button" className="panel-close-btn" onClick={() => setCoverCalendarModalOpen(false)}>닫기</button>
              </div>
              <p className="meta" style={{ margin: '8px 0 0' }}>총 {coverCalendarModalItems.length}건</p>
              <div className="cover-calendar-modal-list" style={{ marginTop: '10px' }}>
                {coverCalendarModalItems.length ? coverCalendarModalItems.map((item) => {
                  const isWorkScheduleItem = item.kind === 'work_schedule';
                  const isDarkTheme = normalizeText(theme).toLowerCase() === 'dark';
                  const itemStyle = isWorkScheduleItem && isDarkTheme
                    ? {
                      backgroundColor: 'rgba(19, 54, 44, 0.9)',
                      borderColor: 'rgba(52, 211, 153, 0.45)'
                    }
                    : pastelToneCardStyle(item.tone);

                  return (
                    <button
                      key={`cover-calendar-modal-item-${item.eventId || item.postId}`}
                      type="button"
                      className="cover-calendar-modal-item"
                      style={itemStyle}
                      onClick={() => {
                        setCoverCalendarModalOpen(false);
                        handleMovePost(item.postId, item.boardId);
                      }}
                    >
                      {isWorkScheduleItem ? (() => {
                        const fullTime = normalizeScheduleCellText(item.fullTime);
                        const part1 = normalizeScheduleCellText(item.part1);
                        const part2 = normalizeScheduleCellText(item.part2);
                        const part3 = normalizeScheduleCellText(item.part3);
                        const education = normalizeScheduleCellText(item.education);
                        const segments = [
                          { key: 'fulltime', label: '풀타임', value: fullTime },
                          { key: 'part1', label: '파트1', value: part1 },
                          { key: 'part2', label: '파트2', value: part2 },
                          { key: 'part3', label: '파트3', value: part3 },
                          { key: 'education', label: '교육', value: education }
                        ].filter((segment) => hasScheduleCellText(segment.value));

                        return (
                          <div className="work-schedule-role-list">
                            {segments.length ? segments.map((segment) => (
                              <span
                                key={`work-schedule-segment-${item.eventId || item.postId}-${segment.key}`}
                                className={`work-schedule-role-chip is-${segment.key}`}
                              >
                                <span className="work-schedule-role-label">{segment.label}</span>
                                <span className="work-schedule-role-value">{segment.value}</span>
                              </span>
                            )) : (
                              <span className="work-schedule-role-chip is-empty">배정 정보 없음</span>
                            )}
                          </div>
                        );
                      })() : (
                        <span className="cover-calendar-modal-item-author" style={pastelToneStyle(item.tone)}>
                          [{item.startTimeValue || COVER_FOR_DEFAULT_START_TIME}~{item.endTimeValue || COVER_FOR_DEFAULT_END_TIME}] [{item.venue || COVER_FOR_DEFAULT_VENUE}]
                        </span>
                      )}
                      {isWorkScheduleItem ? null : (
                        <>
                          <span className="cover-calendar-modal-item-title">{item.title || '(제목 없음)'}</span>
                          <span className="cover-calendar-modal-item-meta">작성자: {item.authorName || '익명'}</span>
                        </>
                      )}
                    </button>
                  );
                }) : (
                  <p className="muted" style={{ margin: 0 }}>
                    {normalizeText(currentBoard?.id) === WORK_SCHEDULE_BOARD_ID
                      ? '해당 날짜에 등록된 근무일정이 없습니다.'
                      : '해당 날짜에 구하는 중인 요청이 없습니다.'}
                  </p>
                )}
              </div>
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {composerDatePickerOpen ? (
          <div className="cover-calendar-modal composer-date-picker-modal" aria-hidden={!composerDatePickerOpen}>
            <motion.div
              className="cover-calendar-modal-backdrop"
              onClick={closeComposerDatePicker}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />
            <motion.section
              className="card cover-calendar-modal-panel composer-date-picker-panel"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="row space-between">
                <h3 style={{ margin: 0 }}>요청 날짜 선택</h3>
                <button type="button" className="panel-close-btn" onClick={closeComposerDatePicker}>닫기</button>
              </div>

              <div className="composer-day-picker-wrap">
                <DayPicker
                  mode="single"
                  locale={ko}
                  month={composerDatePickerCursor}
                  onMonthChange={(nextMonth) => {
                    if (!(nextMonth instanceof Date) || Number.isNaN(nextMonth.getTime())) return;
                    setComposerDatePickerCursor(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
                  }}
                  selected={composerDatePickerSelectedDate}
                  captionLayout="dropdown"
                  navLayout="around"
                  showOutsideDays
                  fixedWeeks
                  startMonth={composerDatePickerStartMonth}
                  endMonth={composerDatePickerEndMonth}
                  components={{
                    Dropdown: ComposerDayPickerDropdown
                  }}
                  className="composer-day-picker"
                  onSelect={(nextDate) => {
                    if (!(nextDate instanceof Date) || Number.isNaN(nextDate.getTime())) return;
                    if (composerDatePickerTargetIndex < 0) return;
                    updateComposerCoverDate(composerDatePickerTargetIndex, toDateKey(nextDate));
                    closeComposerDatePicker();
                  }}
                />
              </div>
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {composerOpen ? (
          <motion.div
            id="composerModal"
            className="composer-modal"
            aria-hidden={!composerOpen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <motion.div
              id="composerBackdrop"
              className="composer-backdrop"
              onClick={closeComposer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />

            <motion.section
              id="postComposerCard"
              className="card composer-panel"
              initial={{ opacity: 0, y: 30, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.985 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.68 }}
            >
              <div className="row">
                <h2>글 작성</h2>
              </div>

              <p id="composerBoardTarget" className="meta" style={{ marginTop: '6px', fontWeight: 700 }}>
                작성 게시판: {currentBoardName}
              </p>

              <div
                id="composerMessage"
                className={composerMessage.text ? (composerMessage.type === 'error' ? 'error' : 'notice') : 'hidden'}
                style={{ marginTop: '10px' }}
              >
                {composerMessage.text}
              </div>

              <form id="postForm" className="stack" style={{ marginTop: '12px' }} onSubmit={submitPost}>
                <label>
                  제목
                  <input
                    id="postTitle"
                    type="text"
                    maxLength={120}
                    required
                    value={postTitle}
                    onChange={(event) => setPostTitle(event.target.value)}
                  />
                </label>

                {composerIsCoverForBoard ? (
                  <div className="cover-for-date-box">
                    <p className="meta" style={{ margin: 0, fontWeight: 700 }}>{`${currentBoard?.name || '캘린더'} 날짜/시간 (필수)`}</p>
                    <div className="cover-for-date-list" style={{ marginTop: '8px' }}>
                      {composerCoverDateKeys.map((dateKey, idx) => {
                        const currentVenueRaw = sanitizeCoverForVenueInput(composerCoverVenueValues[idx]);
                        const currentVenue = normalizeCoverForVenue(currentVenueRaw);
                        const isCustomMode = Boolean(composerCoverVenueCustomModes[idx]);
                        const usingCustom = isCustomMode || (currentVenue && !coverVenueOptions.includes(currentVenue));
                        const venueSelectValue = usingCustom
                          ? COVER_FOR_CUSTOM_VENUE_VALUE
                          : (coverVenueOptions.includes(currentVenue) ? currentVenue : coverVenueDefault);

                        return (
                          <div key={`cover-date-${idx}`} className="cover-for-date-row composer-date-row">
                            <button
                              type="button"
                              className="cover-for-date-select-btn"
                              onClick={() => openComposerDatePicker(idx)}
                            >
                              <span>{formatDateKeyLabel(dateKey)}</span>
                              <CalendarDays size={15} />
                            </button>

                            <Select
                              value={venueSelectValue}
                              onValueChange={(nextValue) => updateComposerCoverVenueSelect(idx, nextValue)}
                              onOpenChange={(open) => {
                                logCoverVenueDebug('select-open-change', {
                                  index: idx,
                                  open
                                });
                              }}
                            >
                              <SelectTrigger
                                className="cover-for-venue-select"
                                aria-label={`체험관 선택 ${idx + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent
                                className="cover-for-time-select-content"
                                position="popper"
                                onCloseAutoFocus={(event) => event.preventDefault()}
                              >
                                {coverVenueOptions.map((venue) => (
                                  <SelectItem
                                    key={`cover-venue-option-${idx}-${venue}`}
                                    value={venue}
                                    className="cover-for-time-select-item"
                                  >
                                    {venue}
                                  </SelectItem>
                                ))}
                                <SelectItem
                                  key={`cover-venue-option-${idx}-custom`}
                                  value={COVER_FOR_CUSTOM_VENUE_VALUE}
                                  className="cover-for-time-select-item"
                                >
                                  직접작성
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            {usingCustom ? (
                              <input
                                type="text"
                                className="cover-for-venue-custom-input"
                                placeholder="체험관 직접 입력"
                                maxLength={30}
                                value={currentVenueRaw}
                                ref={(node) => {
                                  composerVenueInputRefs.current[idx] = node;
                                }}
                                onFocus={() => {
                                  setComposerVenueInputFocusIndex(idx);
                                  logCoverVenueDebug('input-focus', {
                                    index: idx,
                                    value: currentVenueRaw
                                  });
                                }}
                                onBlur={(event) => {
                                  const relatedTag = String(event.relatedTarget?.tagName || '');
                                  const relatedRole = String(event.relatedTarget?.getAttribute?.('role') || '');
                                  const relatedClass = String(event.relatedTarget?.className || '');
                                  const activeTag = String(document?.activeElement?.tagName || '');
                                  const activeRole = String(document?.activeElement?.getAttribute?.('role') || '');
                                  const activeClass = String(document?.activeElement?.className || '');
                                  logCoverVenueDebug('input-blur', {
                                    index: idx,
                                    value: sanitizeCoverForVenueInput(composerCoverVenueValues[idx]),
                                    relatedTag,
                                    relatedRole,
                                    relatedClass,
                                    activeTag,
                                    activeRole,
                                    activeClass
                                  });
                                  setComposerVenueInputFocusIndex(-1);
                                }}
                                onChange={(event) => {
                                  const nextRaw = event.target.value;
                                  logCoverVenueDebug('input-change', {
                                    index: idx,
                                    value: sanitizeCoverForVenueInput(nextRaw)
                                  });
                                  updateComposerCoverVenue(idx, nextRaw, { keepRaw: true });
                                }}
                              />
                            ) : null}

                            <Select
                              value={normalizeTimeInput(composerCoverStartTimeValues[idx]) || COVER_FOR_DEFAULT_START_TIME}
                              onValueChange={(nextValue) => updateComposerCoverStartTime(idx, nextValue)}
                            >
                              <SelectTrigger
                                className="cover-for-time-select"
                                aria-label={`요청 시작 시간 ${idx + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="cover-for-time-select-content" position="popper">
                                {COVER_FOR_START_TIME_OPTIONS.map((timeValue) => (
                                  <SelectItem
                                    key={`cover-start-time-option-${idx}-${timeValue}`}
                                    value={timeValue}
                                    className="cover-for-time-select-item"
                                  >
                                    {timeValue}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className="cover-for-time-range-sep" aria-hidden="true">~</span>
                            <Select
                              value={(() => {
                                const startTimeValue = normalizeTimeInput(composerCoverStartTimeValues[idx]) || COVER_FOR_DEFAULT_START_TIME;
                                const startMinutes = timeValueToMinutes(startTimeValue);
                                const options = COVER_FOR_TIME_OPTIONS.filter((timeValue) => timeValueToMinutes(timeValue) > startMinutes);
                                const selected = normalizeTimeInput(composerCoverEndTimeValues[idx]) || COVER_FOR_DEFAULT_END_TIME;
                                return options.includes(selected) ? selected : (options[0] || suggestEndTime(startTimeValue));
                              })()}
                              onValueChange={(nextValue) => updateComposerCoverEndTime(idx, nextValue)}
                            >
                              <SelectTrigger
                                className="cover-for-time-select"
                                aria-label={`요청 종료 시간 ${idx + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="cover-for-time-select-content" position="popper">
                                {(() => {
                                  const startTimeValue = normalizeTimeInput(composerCoverStartTimeValues[idx]) || COVER_FOR_DEFAULT_START_TIME;
                                  const startMinutes = timeValueToMinutes(startTimeValue);
                                  return COVER_FOR_TIME_OPTIONS.filter((timeValue) => timeValueToMinutes(timeValue) > startMinutes);
                                })().map((timeValue) => (
                                  <SelectItem
                                    key={`cover-end-time-option-${idx}-${timeValue}`}
                                    value={timeValue}
                                    className="cover-for-time-select-item"
                                  >
                                    {timeValue}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              className={composerCoverDateKeys.length > 1 ? 'cover-for-date-remove-btn' : 'cover-for-date-remove-btn hidden'}
                              onClick={() => removeComposerCoverDate(idx)}
                            >
                              삭제
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="cover-for-add-date-btn"
                      onClick={addComposerCoverDate}
                      disabled={composerCoverDateKeys.length >= COVER_FOR_MAX_DATES}
                      style={{ marginTop: '8px' }}
                      aria-label="날짜 추가"
                    >
                      +
                    </button>
                    <p className="meta" style={{ margin: '8px 0 0' }}>
                      날짜/시간은 최대 {COVER_FOR_MAX_DATES}개까지 등록할 수 있으며, 같은 날짜도 시간/체험관이 다르면 여러 건 등록됩니다. 캘린더에는 [시간~시간] [체험관] 형식으로 표시됩니다.
                    </p>
                  </div>
                ) : null}

                <div className="composer-audience-box">
                  <p className="meta" style={{ margin: '0 0 6px', fontWeight: 700 }}>열람 가능 등급</p>
                  <div id="postAudienceBadges" className="audience-badge-row">
                    {currentBoard ? (
                      currentBoardRoles.length ? (
                        currentBoardRoles.map((role) => (
                          <RoleBadge key={`composer-role-${role}`} role={role} roleDefMap={roleDefMap} />
                        ))
                      ) : <span className="muted">-</span>
                    ) : <span className="muted">게시판을 먼저 선택하세요.</span>}
                  </div>
                  <p id="postAudienceHint" className="meta" style={{ margin: '8px 0 0' }}>
                    {!currentBoard
                      ? '게시판 선택 후 자동으로 표시됩니다.'
                      : currentBoardVisibility === 'public'
                        ? '이 게시판 글은 전체공개 규칙으로 저장됩니다.'
                        : '이 게시판 글은 멘토공개 규칙으로 저장됩니다.'}
                  </p>
                </div>

                <div className="editor-shell with-mention-menu">
                  <RichEditorToolbar
                    editorRef={editorRef}
                    fontSizeLabelRef={fontSizeLabelRef}
                    ids={{
                      fontSizeLabelId: 'fontSizeLabel',
                      fontDownId: 'fontDownBtn',
                      fontUpId: 'fontUpBtn',
                      colorId: 'fontColor',
                      linkId: 'linkBtn',
                      unlinkId: 'unlinkBtn'
                    }}
                  />

                  <div className="editor-mention-wrap">
                    <div
                      id="postEditor"
                      ref={editorElRef}
                      className="editor-content"
                    />
                    <div
                      className={composerMentionMenu.open ? 'mention-menu mention-menu-anchor' : 'mention-menu mention-menu-anchor hidden'}
                      style={{ left: `${composerMentionMenu.anchorLeft}px`, top: `${composerMentionMenu.anchorTop}px` }}
                    >
                      {composerMentionCandidates.length ? composerMentionCandidates.map((candidate, idx) => (
                        <button
                          key={`composer-mention-candidate-${candidate.uid}`}
                          type="button"
                          className={idx === composerMentionActiveIndex ? 'mention-menu-item is-active' : 'mention-menu-item'}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyComposerMentionCandidate(candidate);
                          }}
                        >
                          <span className="mention-menu-nickname">@{candidate.nickname}</span>
                        </button>
                      )) : (
                        <p className="mention-menu-empty">일치하는 닉네임이 없습니다.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    id="cancelPostBtn"
                    className="btn-muted"
                    type="button"
                    disabled={submittingPost}
                    onClick={closeComposer}
                  >
                    취소
                  </button>
                  <button id="submitPostBtn" className="btn-primary" type="submit" disabled={submittingPost}>
                    {submittingPost ? '등록 중...' : '글 등록'}
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {appliedPopup.open ? (
          <motion.div
            id="appliedPopup"
            className="applied-popup show"
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
