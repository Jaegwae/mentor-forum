// PostPage presentation component.
// Receives controller-owned state/handlers via `vm` and focuses on rendering
// post detail UI, keeping mutation logic in the controller layer.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, FileText, LogOut, MessageSquare, ShieldCheck, Users2 } from 'lucide-react';
import { usePageMeta } from '../../hooks/usePageMeta.js';
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
  runTransaction,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  deleteDoc,
  toDateText
} from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { buildPermissions, getRoleBadgePalette } from '../../legacy/rbac.js';
import { createRichEditor, renderRichDeltaToHtml, renderRichPayloadToHtml } from '../../legacy/rich-editor.js';
import { pushRelayConfigured, sendPushRelayNotification } from '../../legacy/push-relay.js';
import { RichEditorToolbar } from '../../components/editor/RichEditorToolbar.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog.jsx';
import { ThemeToggle } from '../../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildPostDetailExcelSheetModel
} from '../../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../../hooks/useTheme.js';
import * as pageConstants from './constants.js';
import * as pageUtils from './utils.js';

const {
  NOTICE_BOARD_ID,
  ALL_BOARD_ID,
  COVER_FOR_BOARD_ID,
  COVER_FOR_STATUS,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  DEFAULT_COVER_FOR_VENUE_OPTIONS,
  COVER_FOR_DEFAULT_VENUE,
  AUTO_LOGOUT_MESSAGE,
  LAST_BOARD_STORAGE_KEY,
  NOTIFICATION_TYPE,
  NOTIFICATION_SUBTYPE,
  MENTION_ALL_TOKEN,
  MENTION_MAX_ITEMS,
  MENTION_MENU_ESTIMATED_WIDTH,
  MENTION_MENU_INITIAL,
  CORE_ROLE_LEVELS,
  ROLE_KEY_ALIASES,
  FALLBACK_ROLE_DEFINITIONS
} = pageConstants;

const {
  numberOrZero,
  normalizeText,
  detectCompactListMode,
  stripHtmlToText,
  isTruthyLegacyValue,
  isDeletedPost,
  normalizeErrMessage,
  isPermissionDeniedError,
  shouldLogDebugPayload,
  logErrorWithOptionalDebug,
  debugValueList,
  debugCodePoints,
  joinDebugParts,
  boardAccessDebugText,
  readLastBoardId,
  writeLastBoardId,
  isCoverForBoardId,
  toDateKey,
  fromDateKey,
  formatDateKeyLabel,
  normalizeDateKeyInput,
  notificationDocRef,
  viewedPostDocRef,
  normalizeNotificationType,
  normalizeNickname,
  buildNicknameKey,
  extractMentionNicknames,
  hasAllMentionCommand,
  detectMentionContext,
  notificationIdForEvent,
  toNotificationBodySnippet,
  normalizeCoverForVenue,
  normalizeTimeInput,
  timeValueToMinutes,
  isValidTimeRange,
  suggestEndTime,
  normalizeCoverForStatus,
  coverForStatusLabel,
  isClosedCoverForStatus,
  normalizeCoverForDateKeys,
  normalizeCoverForDateStatuses,
  normalizeCoverForTimeValues,
  normalizeCoverForVenueValues,
  coverForDateEntriesFromPost,
  summarizeCoverForDateEntries,
  formatTemporaryLoginRemaining,
  toMillis,
  commentAuthorName,
  plainRichPayload,
  renderStoredContentHtml,
  createRoleDefMap,
  normalizeRoleKey,
  isExplicitNewbieRole,
  roleMatchCandidates,
  isPrivilegedBoardRole,
  isNoticeBoardData,
  sortCommentsForDisplay
} = pageUtils;

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


export function PostPageView({ vm }) {
  // Flat destructuring is intentional to preserve the legacy JSX naming
  // contract during large refactors.
  const {
    navigate,
    location,
    theme,
    toggleTheme,
    isExcel,
    searchParams,
    routeState,
    postId,
    focusCommentId,
    boardIdFromQuery,
    fromBoardIdFromQuery,
    boardIdFromState,
    fromBoardIdFromState,
    editorRef,
    editorElRef,
    editorElMounted,
    setEditorElMounted,
    editorElCallbackRef,
    fontSizeLabelRef,
    editEditorRef,
    editEditorElRef,
    editFontSizeLabelRef,
    expiryTimerRef,
    countdownTimerRef,
    lastActivityRefreshAtRef,
    focusCommentTimerRef,
    mentionRequestIdRef,
    mentionCacheRef,
    commentDraftPayloadRef,
    ready,
    setReady,
    message,
    setMessage,
    currentUser,
    setCurrentUser,
    currentUserProfile,
    setCurrentUserProfile,
    permissions,
    setPermissions,
    roleDefinitions,
    setRoleDefinitions,
    currentPost,
    setCurrentPost,
    currentPostCanWrite,
    setCurrentPostCanWrite,
    comments,
    setComments,
    commentsLoading,
    setCommentsLoading,
    replyTarget,
    setReplyTarget,
    commentMentionMenu,
    setCommentMentionMenu,
    commentMentionCandidates,
    setCommentMentionCandidates,
    commentMentionActiveIndex,
    setCommentMentionActiveIndex,
    editMentionMenu,
    setEditMentionMenu,
    editMentionCandidates,
    setEditMentionCandidates,
    editMentionActiveIndex,
    setEditMentionActiveIndex,
    commentSubmitting,
    setCommentSubmitting,
    excelCommentModalOpen,
    setExcelCommentModalOpen,
    statusUpdating,
    setStatusUpdating,
    editModalOpen,
    setEditModalOpen,
    editTitle,
    setEditTitle,
    editSubmitting,
    setEditSubmitting,
    editMessage,
    setEditMessage,
    sessionRemainingMs,
    setSessionRemainingMs,
    compactListMode,
    setCompactListMode,
    boardLabel,
    setBoardLabel,
    currentBoardAccessDebug,
    setCurrentBoardAccessDebug,
    roleDefMap,
    appPage,
    backBoardId,
    resolvedBackBoardId,
    backHref,
    canAccessAdminSite,
    canModerateCurrentPost,
    normalizedRoleForWrite,
    rawRoleForWrite,
    hasPotentialWriteRole,
    canAttemptCommentWrite,
    isCoverForPost,
    isAdminOrSuper,
    canChangeCoverStatus,
    canResetCoverToSeeking,
    currentPostCoverDateEntries,
    currentPostCoverSummary,
    currentPostCoverStatus,
    isCoverForClosed,
    userDisplayName,
    currentUserUid,
    fetchMentionCandidates,
    readMentionAnchor,
    closeMentionMenu,
    syncMentionMenu,
    applyMentionCandidate,
    insertReplyMention,
    clearExpiryTimer,
    clearCountdownTimer,
    handleTemporaryLoginExpiry,
    scheduleTemporaryLoginExpiry,
    hasTemporarySession,
    commentComposerMountKey,
    handleExtendSession,
    handleLogout,
    handleOpenGuide,
    canUseBoardData,
    canWriteBoardData,
    resolveBoardAccess,
    loadPost,
    resolveMentionTargets,
    resolveAllMentionTargets,
    writeUserNotification,
    submitComment,
    openEditModal,
    submitEditPost,
    deletePost,
    deleteComment,
    handleBackToList,
    updateCoverForDateStatus,
    renderedPostBody,
    renderCommentComposer,
    forumPage,
    myPostsPage,
    myCommentsPage,
    handleMoveHome,
    handleBrandTitleKeyDown,
    userRoleLabel,
    excelCommentRows,
    postMetaLine,
    excelSheetModel,
    isExcelDesktopMode,
    excelActiveCellLabel,
    setExcelActiveCellLabel,
    excelFormulaText,
    setExcelFormulaText,
    handleExcelSelectCell,
    handleExcelAction
  } = vm;

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${comments.length}건`}
          activeCellLabel={isExcelDesktopMode ? excelActiveCellLabel : ''}
          formulaText={isExcelDesktopMode ? excelFormulaText : '='}
          showHeaders
          rowCount={EXCEL_STANDARD_ROW_COUNT}
          colCount={EXCEL_STANDARD_COL_COUNT}
          compact={compactListMode}
        />
      ) : null}
      <motion.main
        className={isExcel ? 'page stack post-detail-shell excel-chrome-offset' : 'page stack post-detail-shell'}
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
            onNavigateMyPosts={() => navigate(myPostsPage)}
            onNavigateMyComments={() => navigate(myCommentsPage)}
            onNavigateAdmin={() => navigate(MENTOR_FORUM_CONFIG.app.adminPage)}
            onOpenGuide={handleOpenGuide}
            onToggleTheme={toggleTheme}
            onLogout={() => handleLogout().catch(() => {})}
            onMoveHome={handleMoveHome}
            onAction={handleExcelAction}
          />
        ) : null}
        {isExcelDesktopMode && excelCommentModalOpen ? (
          <Dialog open={excelCommentModalOpen} onOpenChange={setExcelCommentModalOpen}>
            <DialogContent className="max-w-[560px]">
              <DialogHeader>
                <DialogTitle>댓글 작성</DialogTitle>
              </DialogHeader>
              <div className="mt-2">
                {renderCommentComposer()}
              </div>
            </DialogContent>
          </Dialog>
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
              className="btn-muted guide-help-btn"
              aria-label="사용 설명서 열기"
              title="사용 설명서"
              onClick={handleOpenGuide}
            >
              <BookOpen size={16} />
              <span className="guide-help-btn-text">사용 설명서</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div
          id="userInfo"
          className={sessionRemainingMs != null ? 'notice post-detail-account-row' : 'hidden'}
          style={{ marginTop: '12px' }}
        >
          <div className="session-ttl-row" style={{ marginTop: 0 }}>
            <span className="session-ttl-label">
              자동 로그아웃까지 <strong className="session-ttl-time">{formatTemporaryLoginRemaining(sessionRemainingMs)}</strong>
            </span>
            <button type="button" className="session-extend-btn" onClick={handleExtendSession}>연장</button>
          </div>
        </div>

        <div id="message" className={message.text ? (message.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '12px' }}>
          {message.text}
        </div>
        </section>

        <section className="post-detail-content-layout">
          <aside className="board-rail post-detail-side-rail" aria-label="게시글 상세 내 정보">
            <section className="board-rail-profile post-detail-side-profile">
            <div className="board-profile-head-row">
              <p className="board-rail-profile-kicker">내 정보</p>
              <button
                type="button"
                className="board-notification-btn is-logout post-detail-side-logout"
                onClick={() => handleLogout().catch(() => {})}
              >
                <LogOut size={13} />
                <span className="board-top-logout-text">로그아웃</span>
              </button>
            </div>
            <div className="board-rail-profile-user">
              <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
            </div>
            <div className="board-rail-profile-actions">
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(forumPage)}>
                <ArrowLeft size={14} />
                포럼으로
              </button>
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myPostsPage)}>
                <FileText size={14} />
                내가 쓴 글
              </button>
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myCommentsPage)}>
                <MessageSquare size={14} />
                내가 쓴 댓글
              </button>
              {canAccessAdminSite ? (
                <button type="button" className="board-rail-profile-btn" onClick={() => navigate(MENTOR_FORUM_CONFIG.app.adminPage)}>
                  <ShieldCheck size={14} />
                  관리자 사이트
                </button>
              ) : null}
            </div>
            </section>
          </aside>

          <div className="post-detail-main-column">
            <section className="card post-detail-card">
        <div className="row space-between mobile-col post-detail-nav-row">
          <button id="backToListLink" className="btn-muted" type="button" onClick={handleBackToList}>
            <ArrowLeft size={16} />
            목록으로
          </button>

          <div className="row mobile-wrap" style={{ marginLeft: 'auto' }}>
            <button
              id="editPostBtn"
              type="button"
              className={canModerateCurrentPost ? 'btn-muted post-action-btn' : 'btn-muted post-action-btn hidden'}
              onClick={openEditModal}
            >
              수정
            </button>
            <button
              id="deletePostBtn"
              type="button"
              className={canModerateCurrentPost ? 'btn-danger post-action-btn' : 'btn-danger post-action-btn hidden'}
              onClick={() => deletePost().catch(() => {})}
            >
              삭제
            </button>
          </div>
        </div>

        <div className="post-title-block" style={{ marginTop: '10px' }}>
          <p className="post-section-label">제목</p>
          <div className="row mobile-wrap post-title-head">
            <h2 id="postTitle" className={isCoverForClosed ? 'is-struck' : ''} style={{ margin: 0 }}>
              {currentPost?.title || '게시글'}
            </h2>
            <span id="postBoardBadge" className="badge board-pill">{boardLabel}</span>
            <span
              id="postVisibilityBadge"
              className="badge"
              style={{
                background: currentPost?.visibility === 'mentor' ? '#f3e8ff' : '#dbeafe',
                color: currentPost?.visibility === 'mentor' ? '#6b21a8' : '#1d4ed8'
              }}
            >
              {currentPost?.visibility === 'mentor' ? '멘토공개' : '전체공개'}
            </span>
            {isCoverForPost ? (
              <span className={`cover-status-chip status-${currentPostCoverStatus}`}>
                [{currentPostCoverSummary.label}]
              </span>
            ) : null}
          </div>
        </div>

        <div className="post-author-block" style={{ marginTop: '10px' }}>
          <p className="post-section-label">작성자</p>
          <div id="postMeta" className="post-author-main" style={{ marginTop: '8px' }}>
            {currentPost ? (
              <>
                <span className="meta-role-line">
                  <AuthorWithRole
                    name={currentPost.authorName || currentPost.authorUid || '-'}
                    role={currentPost.authorRole || 'Newbie'}
                    roleDefMap={roleDefMap}
                  />
                </span>
                <span className="meta"> · {toDateText(currentPost.createdAt)} · 조회 {numberOrZero(currentPost.views)}</span>
              </>
            ) : (ready ? '게시글 정보를 불러오지 못했습니다.' : '불러오는 중...')}
          </div>
        </div>

        <div className="post-content-block" style={{ marginTop: '12px' }}>
          <p className="post-section-label">내용</p>
          <div
            id="postBody"
            className={isCoverForClosed ? 'post-body is-struck' : 'post-body'}
            style={{ marginTop: '6px' }}
            dangerouslySetInnerHTML={{ __html: renderedPostBody }}
          />
        </div>

        {isCoverForPost ? (
          <div className="cover-date-status-box" style={{ marginTop: '14px' }}>
            <div className="row space-between mobile-col">
              <h3 style={{ margin: 0 }}>요청 날짜 상태</h3>
              <span className="meta">
                모든 날짜가 완료/취소면 글이 자동으로 완료 상태(취소선)로 표시됩니다.
              </span>
            </div>
            <div className="cover-date-status-list" style={{ marginTop: '8px' }}>
              {currentPostCoverDateEntries.map((entry, entryIndex) => {
                const dateStatus = normalizeCoverForStatus(entry.status);
                const isDateClosed = isClosedCoverForStatus(dateStatus);
                const canResetThisDate = canResetCoverToSeeking && dateStatus !== COVER_FOR_STATUS.SEEKING;
                const displayDate = formatDateKeyLabel(entry.dateKey);
                const safeStart = normalizeTimeInput(entry.startTimeValue) || COVER_FOR_DEFAULT_START_TIME;
                const safeEnd = normalizeTimeInput(entry.endTimeValue) || COVER_FOR_DEFAULT_END_TIME;
                const venue = normalizeCoverForVenue(entry.venue) || COVER_FOR_DEFAULT_VENUE;
                const displayTime = `[${safeStart}~${safeEnd}]`;
                const entryKey = [
                  'cover-date-status',
                  entry.dateKey,
                  safeStart,
                  safeEnd,
                  venue,
                  String(entryIndex)
                ].join('|');
                const leftAction = dateStatus === COVER_FOR_STATUS.COMPLETED
                  ? (canResetThisDate ? {
                    label: '구하는 중',
                    targetStatus: COVER_FOR_STATUS.SEEKING,
                    tone: 'seeking'
                  } : null)
                  : {
                    label: '완료',
                    targetStatus: COVER_FOR_STATUS.COMPLETED,
                    tone: 'complete'
                  };
                const rightAction = dateStatus === COVER_FOR_STATUS.CANCELLED
                  ? (canResetThisDate ? {
                    label: '구하는 중',
                    targetStatus: COVER_FOR_STATUS.SEEKING,
                    tone: 'seeking'
                  } : null)
                  : {
                    label: '취소',
                    targetStatus: COVER_FOR_STATUS.CANCELLED,
                    tone: 'cancelled'
                  };

                return (
                  <div
                    key={entryKey}
                    className={`cover-date-status-row status-${dateStatus}`}
                  >
                    <div className="cover-date-status-meta">
                      <span className={isDateClosed ? 'cover-date-status-date is-struck' : 'cover-date-status-date'}>
                        {displayDate}
                      </span>
                      <span className={isDateClosed ? 'cover-date-status-sub is-struck' : 'cover-date-status-sub'}>
                        {displayTime}
                      </span>
                      <span className="cover-venue-chip">[{venue}]</span>
                      <span className={`cover-status-chip status-${dateStatus}`}>[{coverForStatusLabel(dateStatus)}]</span>
                    </div>
                    {canChangeCoverStatus ? (
                      <div className="cover-date-status-actions">
                        {leftAction ? (
                          <button
                            type="button"
                            className={`cover-date-action-btn cover-date-action-${leftAction.tone}`}
                            disabled={statusUpdating}
                            onClick={() => updateCoverForDateStatus(entryIndex, leftAction.targetStatus).catch(() => {})}
                          >
                            {leftAction.label}
                          </button>
                        ) : <span className="cover-date-action-placeholder" aria-hidden="true" />}

                        {rightAction ? (
                          <button
                            type="button"
                            className={`cover-date-action-btn cover-date-action-${rightAction.tone}`}
                            disabled={statusUpdating}
                            onClick={() => updateCoverForDateStatus(entryIndex, rightAction.targetStatus).catch(() => {})}
                          >
                            {rightAction.label}
                          </button>
                        ) : <span className="cover-date-action-placeholder" aria-hidden="true" />}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card post-comment-card">
        <h3>댓글</h3>

        <div id="commentList" className="stack" style={{ marginTop: '10px' }}>
          {commentsLoading ? <div className="muted">댓글을 불러오는 중...</div> : null}

          {!commentsLoading && !comments.length ? (
            <div className="muted">아직 댓글이 없습니다.</div>
          ) : null}

          {!commentsLoading && comments.map((comment) => {
            const threadDepth = Number(comment._threadDepth) || 0;
            const canDelete = !!(permissions?.canModerate || (currentUser && comment.authorUid === currentUser.uid));
            const canReply = canAttemptCommentWrite;
            const commentHtml = renderStoredContentHtml(comment);
            const replyClass = threadDepth > 0 ? ' reply' : '';
            const replyToName = threadDepth > 0 ? normalizeText(comment.replyToAuthorName) : '';
            const indent = Math.min(threadDepth, 6) * 18;
            const isReplyComposerOpen = !!(
              canReply
              && replyTarget
              && normalizeText(replyTarget.id) === normalizeText(comment.id)
            );

            return (
              <React.Fragment key={comment.id}>
                <div
                  className={`comment-item${replyClass}`}
                  data-comment-id={comment.id}
                  data-depth={threadDepth}
                  style={indent ? { marginLeft: `${indent}px` } : undefined}
                >
                  {threadDepth > 0 ? <span className="reply-branch-marker" aria-hidden="true">↳</span> : null}
                  <p className="meta">
                    <AuthorWithRole name={commentAuthorName(comment)} role={comment.authorRole || 'Newbie'} roleDefMap={roleDefMap} />
                    {replyToName ? <span className="reply-to-chip">{replyToName}에게 답장</span> : null}
                    {' · '}{toDateText(comment.createdAt)}
                  </p>

                  <div className="comment-body" dangerouslySetInnerHTML={{ __html: commentHtml }} />

                  <div className="row comment-action-row">
                    {canReply ? (
                      <button
                        type="button"
                        data-action="reply-comment"
                        className="comment-action-btn"
                        onClick={() => {
                          const nextTarget = {
                            id: String(comment.id || ''),
                            authorName: String(commentAuthorName(comment)),
                            authorUid: String(comment.authorUid || ''),
                            depth: threadDepth
                          };

                          if (replyTarget && normalizeText(replyTarget.id) === normalizeText(nextTarget.id)) {
                            setReplyTarget(null);
                            closeMentionMenu('comment');
                            editorRef.current?.focus();
                            return;
                          }

                          setReplyTarget({
                            ...nextTarget
                          });
                        }}
                      >
                        답글
                      </button>
                    ) : null}

                    {canDelete ? (
                      <button
                        type="button"
                        data-action="delete-comment"
                        className="btn-danger comment-action-btn"
                        onClick={() => deleteComment(comment.id).catch(() => {})}
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>
                </div>

                {!isExcelDesktopMode && isReplyComposerOpen ? renderCommentComposer(true) : null}
              </React.Fragment>
            );
          })}
        </div>

        {!isExcelDesktopMode && !replyTarget ? renderCommentComposer(false) : null}
            </section>
          </div>
        </section>
        </div>
      </motion.main>

      <AnimatePresence>
        {editModalOpen ? (
          <div id="postEditModal" className="composer-modal" aria-hidden={!editModalOpen}>
            <motion.div
              className="composer-backdrop"
              onClick={() => {
                if (editSubmitting) return;
                setEditModalOpen(false);
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            />

            <motion.section
              className="card composer-panel post-edit-panel"
              initial={{ opacity: 0, y: 20, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.985 }}
              transition={{ type: 'spring', stiffness: 320, damping: 31, mass: 0.68 }}
            >
              <div className="row space-between">
                <div>
                  <h2 style={{ margin: 0 }}>게시글 수정</h2>
                  <p className="meta" style={{ margin: '6px 0 0' }}>제목과 내용을 수정할 수 있습니다.</p>
                </div>
              </div>

              <div className={editMessage.text ? (editMessage.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '12px' }}>
                {editMessage.text}
              </div>

              <form className="stack" style={{ marginTop: '12px' }} onSubmit={submitEditPost}>
                <label>
                  제목
                  <input
                    type="text"
                    maxLength={120}
                    required
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                  />
                </label>

                {isCoverForPost ? (
                  <div className="cover-for-date-box cover-for-date-readonly-box">
                    <p className="meta" style={{ margin: 0, fontWeight: 700 }}>대체근무 요청 날짜</p>
                    <div className="cover-for-date-list" style={{ marginTop: '8px' }}>
                      {currentPostCoverDateEntries.map((entry) => (
                        <div key={`edit-cover-date-${entry.dateKey}`} className="cover-for-date-row">
                          <div className="cover-for-date-readonly-chip">{formatDateKeyLabel(entry.dateKey)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="cover-date-readonly-note">날짜는 수정할 수 없습니다.</p>
                  </div>
                ) : null}

                <div>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>내용</p>
                  <div className="editor-shell with-mention-menu">
                    <RichEditorToolbar editorRef={editEditorRef} fontSizeLabelRef={editFontSizeLabelRef} />
                    <div className="editor-mention-wrap">
                      <div
                        id="editPostEditor"
                        className="editor-content post-edit-content"
                        ref={editEditorElRef}
                      />
                      <div
                        className={editMentionMenu.open ? 'mention-menu mention-menu-anchor' : 'mention-menu mention-menu-anchor hidden'}
                        style={{ left: `${editMentionMenu.anchorLeft}px`, top: `${editMentionMenu.anchorTop}px` }}
                      >
                        {editMentionCandidates.length ? editMentionCandidates.map((candidate, idx) => (
                          <button
                            key={`edit-mention-candidate-${candidate.uid}`}
                            type="button"
                            className={idx === editMentionActiveIndex ? 'mention-menu-item is-active' : 'mention-menu-item'}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyMentionCandidate('edit', candidate);
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
                </div>

                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-muted"
                    disabled={editSubmitting}
                    onClick={() => setEditModalOpen(false)}
                  >
                    취소
                  </button>
                  <button type="submit" className="btn-primary" disabled={editSubmitting}>
                    {editSubmitting ? '수정 중...' : '수정 완료'}
                  </button>
                </div>
              </form>
            </motion.section>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
