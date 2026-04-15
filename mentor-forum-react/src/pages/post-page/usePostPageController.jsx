// PostPage controller.
// Owns post-detail lifecycle: auth guard, post load, comments realtime sync,
// mention handling, write/edit/delete actions, and excel interaction bridge.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, FileText, LogOut, MessageSquare, ShieldCheck, Users2 } from 'lucide-react';
import { usePageMeta } from '../../hooks/usePageMeta.js';
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
  serverTimestamp,
  toDateText
} from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { buildPermissions, getRoleBadgePalette } from '../../legacy/rbac.js';
import { createRichEditor, renderRichDeltaToHtml, renderRichPayloadToHtml } from '../../legacy/rich-editor.js';
import * as postFirestore from '../../services/firestore/post-page.js';
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
import * as pageData from './data.js';
import { usePostComments } from './usePostComments.js';
import { usePostCommentMentions } from './usePostCommentMentions.js';
import { usePostEditModal } from './usePostEditModal.js';
import { usePostNotifications } from './usePostNotifications.js';

const {
  ALL_BOARD_ID,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  WORK_SCHEDULE_BOARD_NAME,
  WORK_SCHEDULE_WRITE_ROLES,
  COVER_FOR_STATUS,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  COVER_FOR_DEFAULT_VENUE,
  AUTO_LOGOUT_MESSAGE,
  NOTIFICATION_TYPE,
  MENTION_ALL_TOKEN,
  MENTION_MAX_ITEMS,
  MENTION_MENU_ESTIMATED_WIDTH,
  MENTION_MENU_INITIAL,
  FALLBACK_ROLE_DEFINITIONS,
  NOTIFICATION_SUBTYPE
} = pageConstants;

const {
  numberOrZero,
  normalizeText,
  detectCompactListMode,
  createRoleDefMap,
  normalizeErrMessage,
  logErrorWithOptionalDebug,
  boardAccessDebugText,
  readLastBoardId,
  writeLastBoardId,
  normalizeDateKeyInput,
  plainRichPayload,
  normalizeRoleKey,
  isExplicitNewbieRole,
  roleMatchCandidates,
  isPrivilegedBoardRole,
  isNoticeBoardData,
  isDeletedPost,
  normalizeNickname,
  buildNicknameKey,
  extractMentionNicknames,
  hasAllMentionCommand,
  detectMentionContext,
  normalizeNotificationType,
  notificationIdForEvent,
  toNotificationBodySnippet,
  coverForDateEntriesFromPost,
  summarizeCoverForDateEntries,
  formatDateKeyLabel,
  normalizeCoverForVenue,
  normalizeTimeInput,
  normalizeCoverForStatus,
  coverForStatusLabel,
  isClosedCoverForStatus,
  formatTemporaryLoginRemaining,
  commentAuthorName,
  stripHtmlToText,
  sanitizeStoredContentHtml,
  extractWorkScheduleRowsFromHtml,
  extractEditableTableGridFromHtml,
  normalizeEditableTableGrid,
  replaceFirstTableInHtml,
  renderStoredContentHtml,
  sortCommentsForDisplay
} = pageUtils;

const {
  loadRoleDefinitions,
  ensureUserProfile
} = pageData;

export function usePostPageController() {
  usePageMeta('게시글 상세', 'app-page');

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isExcel = theme === 'excel';

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeState = (location && typeof location.state === 'object' && location.state) ? location.state : {};
  const postId = normalizeText(searchParams.get('postId'));
  const focusCommentId = normalizeText(searchParams.get('commentId'));
  const boardIdFromQuery = normalizeText(searchParams.get('boardId'));
  const fromBoardIdFromQuery = normalizeText(searchParams.get('fromBoardId'));
  const boardIdFromState = normalizeText(routeState.postBoardId || '');
  const fromBoardIdFromState = normalizeText(routeState.preferredBoardId || routeState.fromBoardId || '');

  // ---- ref bucket ---------------------------------------------------------
  // Refs hold editor instances, timer handles, and the comment draft payload
  // that should survive editor remounts.
  // Refs for editor instances, timers, and request ordering guards.
  const editorRef = useRef(null);
  const editorElRef = useRef(null);
  const [editorElMounted, setEditorElMounted] = useState(0);
  const editorElCallbackRef = useCallback((node) => {
    editorElRef.current = node;
    if (node) setEditorElMounted((c) => c + 1);
  }, []);
  const fontSizeLabelRef = useRef(null);
  const editEditorRef = useRef(null);
  const editEditorElRef = useRef(null);
  const editFontSizeLabelRef = useRef(null);
  const expiryTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const lastActivityRefreshAtRef = useRef(0);
  const commentDraftPayloadRef = useRef({ text: '', runs: [] });

  // Global page readiness and message channels.
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Auth + profile + permission snapshot for the current viewer.
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);

  // Primary post payload and comment thread state.
  const [currentPost, setCurrentPost] = useState(null);
  const [currentPostCanWrite, setCurrentPostCanWrite] = useState(false);

  // Comment composer/mention/edit modal state.
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [excelCommentModalOpen, setExcelCommentModalOpen] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

  // Board/debug labels used for permission diagnostics.
  const [boardLabel, setBoardLabel] = useState(boardIdFromQuery || '-');
  const [currentBoardAccessDebug, setCurrentBoardAccessDebug] = useState(null);

  // ---- split sub-hooks ----------------------------------------------------
  // Post detail delegates thread, mention, edit-modal, and notification
  // behavior into smaller hooks. This controller stitches them together.
  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const currentUserUid = normalizeText(currentUser?.uid);
  const isAdminOrSuper = normalizeText(currentUserProfile?.role) === 'Admin' || normalizeText(currentUserProfile?.role) === 'Super_Admin';

  const {
    editModalOpen,
    setEditModalOpen,
    editTitle,
    setEditTitle,
    editHtmlContent,
    setEditHtmlContent,
    editWorkScheduleTableRows,
    setEditWorkScheduleTableRows,
    addEditWorkScheduleRow,
    addEditWorkScheduleColumn,
    updateEditWorkScheduleCell,
    removeEditWorkScheduleRow,
    moveEditWorkScheduleRow,
    reorderEditWorkScheduleRow,
    removeEditWorkScheduleColumn,
    editSubmitting,
    editMessage,
    openEditModal,
    submitEditPost
  } = usePostEditModal({
    currentPost,
    canModerateCurrentPost: !!(
      currentPost
      && currentUser
      && permissions
      && (permissions.canModerate || currentPost.authorUid === currentUser.uid)
    ),
    currentUser,
    currentUserProfile,
    permissions,
    editEditorRef,
    postFirestore,
    normalizeText,
    normalizeEditableTableGrid,
    sanitizeStoredContentHtml,
    extractEditableTableGridFromHtml,
    extractWorkScheduleRowsFromHtml,
    replaceFirstTableInHtml,
    serverTimestamp,
    WORK_SCHEDULE_BOARD_ID
  });

  const {
    dispatchCommentNotifications
  } = usePostNotifications({
    postFirestore,
    normalizeText,
    normalizeNickname,
    buildNicknameKey,
    extractMentionNicknames,
    hasAllMentionCommand,
    normalizeNotificationType,
    notificationIdForEvent,
    toNotificationBodySnippet,
    MENTION_ALL_TOKEN,
    NOTIFICATION_TYPE,
    NOTIFICATION_SUBTYPE,
    isAdminOrSuper,
    serverTimestamp,
    logErrorWithOptionalDebug
  });

  useEffect(() => {
    setBoardLabel(boardIdFromQuery || '-');
  }, [boardIdFromQuery]);

  // ---- navigation context -------------------------------------------------
  // The "back to list" logic prefers the actual post board, then explicit
  // fromBoard hints, then the remembered board from session storage.
  useEffect(() => {
    // Persist the most reliable board target for "back to list".
    // Once post data is loaded, post.boardId becomes the highest-confidence source.
    const rememberedTarget = normalizeText(currentPost?.boardId)
      || fromBoardIdFromState
      || fromBoardIdFromQuery
      || boardIdFromQuery
      || boardIdFromState;
    if (!rememberedTarget || rememberedTarget === ALL_BOARD_ID) return;
    writeLastBoardId(rememberedTarget);
  }, [boardIdFromQuery, boardIdFromState, currentPost?.boardId, fromBoardIdFromQuery, fromBoardIdFromState]);

  const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';
  const backBoardId = useMemo(() => {
    // Back-navigation priority:
    // 1) actual post.boardId
    // 2) explicit fromBoardId (state/query)
    // 3) session remembered board
    // 4) query/state fallback boardId
    const postBoardId = normalizeText(currentPost?.boardId);
    if (postBoardId && postBoardId !== ALL_BOARD_ID) return postBoardId;

    const stateFromBoardId = fromBoardIdFromState !== ALL_BOARD_ID ? fromBoardIdFromState : '';
    if (stateFromBoardId) return stateFromBoardId;

    const fromBoardId = fromBoardIdFromQuery !== ALL_BOARD_ID ? fromBoardIdFromQuery : '';
    if (fromBoardId) return fromBoardId;

    const remembered = readLastBoardId();
    if (remembered) return remembered;

    const queryBoardId = boardIdFromQuery !== ALL_BOARD_ID ? boardIdFromQuery : '';
    if (queryBoardId) return queryBoardId;

    const stateBoardId = boardIdFromState !== ALL_BOARD_ID ? boardIdFromState : '';
    return stateBoardId;
  }, [boardIdFromQuery, boardIdFromState, currentPost?.boardId, fromBoardIdFromQuery, fromBoardIdFromState]);
  const resolvedBackBoardId = useMemo(() => {
    return backBoardId || normalizeText(currentPost?.boardId) || '';
  }, [backBoardId, currentPost?.boardId]);
  const backHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (resolvedBackBoardId) qs.set('boardId', resolvedBackBoardId);
    return qs.toString() ? `${appPage}?${qs.toString()}` : appPage;
  }, [appPage, resolvedBackBoardId]);

  const canAccessAdminSite = !!permissions?.canAccessAdminSite;
  const canModerateCurrentPost = !!(
    currentPost
    && currentUser
    && permissions
    && (permissions.canModerate || currentPost.authorUid === currentUser.uid)
  );
  const normalizedRoleForWrite = normalizeRoleKey(currentUserProfile?.role, roleDefMap);
  const rawRoleForWrite = normalizeText(currentUserProfile?.rawRole || currentUserProfile?.role);
  const hasPotentialWriteRole = normalizedRoleForWrite !== 'Newbie' || !isExplicitNewbieRole(rawRoleForWrite);
  const canAttemptCommentWrite = !!currentPost && (currentPostCanWrite || hasPotentialWriteRole);
  const isCoverForPost = !!currentPost && normalizeText(currentPost.boardId) === COVER_FOR_BOARD_ID;
  const isWorkSchedulePost = !!currentPost && normalizeText(currentPost.boardId) === WORK_SCHEDULE_BOARD_ID;
  const canChangeCoverStatus = isCoverForPost && canModerateCurrentPost;
  const canResetCoverToSeeking = isCoverForPost && isAdminOrSuper;
  const currentPostCoverDateEntries = useMemo(() => {
    return isCoverForPost ? coverForDateEntriesFromPost(currentPost) : [];
  }, [currentPost, isCoverForPost]);
  const currentPostCoverSummary = useMemo(() => {
    if (!isCoverForPost) {
      return {
        statusClass: '',
        label: '',
        isClosed: false
      };
    }
    return summarizeCoverForDateEntries(currentPostCoverDateEntries);
  }, [currentPostCoverDateEntries, isCoverForPost]);
  const currentPostCoverStatus = currentPostCoverSummary.statusClass;
  const isCoverForClosed = !!currentPostCoverSummary.isClosed;

  const userDisplayName = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUser?.email || '사용자')
    : '사용자';

  const {
    commentMentionMenu,
    commentMentionCandidates,
    commentMentionActiveIndex,
    editMentionMenu,
    editMentionCandidates,
    editMentionActiveIndex,
    closeMentionMenu,
    syncMentionMenu,
    applyMentionCandidate,
    insertReplyMention
  } = usePostCommentMentions({
    editorRef,
    editEditorRef,
    currentUserUid,
    isAdminOrSuper,
    postFirestore,
    normalizeNickname,
    buildNicknameKey,
    normalizeText,
    detectMentionContext,
    canAttemptCommentWrite,
    editModalOpen,
    MENTION_MAX_ITEMS,
    MENTION_ALL_TOKEN,
    MENTION_MENU_ESTIMATED_WIDTH,
    MENTION_MENU_INITIAL
  });

  const {
    comments,
    commentsLoading,
    replyTarget,
    setReplyTarget,
    resetCommentsState,
    deleteComment
  } = usePostComments({
    currentPost,
    editorRef,
    insertReplyMention,
    syncMentionMenu,
    normalizeText,
    sortCommentsForDisplay,
    postFirestore,
    setMessage
  });

  // ---- session handling ---------------------------------------------------
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
  const commentComposerMountKey = replyTarget ? `reply:${normalizeText(replyTarget.id)}` : 'root';

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
    if (!editorElRef.current || !fontSizeLabelRef.current) return;

    editorRef.current = createRichEditor({
      editorEl: editorElRef.current,
      fontSizeLabelEl: fontSizeLabelRef.current,
      onChange: () => {
        setMessage((prev) => (prev.text ? { type: '', text: '' } : prev));
        syncMentionMenu('comment');
      },
      onSelectionChange: () => {
        syncMentionMenu('comment');
      }
    });

    const draftPayload = commentDraftPayloadRef.current
      && typeof commentDraftPayloadRef.current === 'object'
      ? commentDraftPayloadRef.current
      : { text: '', runs: [] };
    editorRef.current.setPayload(draftPayload);

    return () => {
      const payload = editorRef.current?.getPayload?.();
      if (payload && typeof payload === 'object') {
        commentDraftPayloadRef.current = payload;
      }
      closeMentionMenu('comment');
      editorRef.current = null;
    };
  }, [closeMentionMenu, commentComposerMountKey, editorElMounted, syncMentionMenu]);

  useEffect(() => {
    if (!editModalOpen || isWorkSchedulePost || !editEditorElRef.current || !editFontSizeLabelRef.current) {
      editEditorRef.current = null;
      return undefined;
    }

    editEditorRef.current = createRichEditor({
      editorEl: editEditorElRef.current,
      fontSizeLabelEl: editFontSizeLabelRef.current,
      onChange: () => {
        setEditMessage((prev) => (prev.text ? { type: '', text: '' } : prev));
        syncMentionMenu('edit');
      },
      onSelectionChange: () => {
        syncMentionMenu('edit');
      }
    });

    const payload = currentPost?.contentDelta || currentPost?.contentRich || plainRichPayload(currentPost?.contentText || '');
    editEditorRef.current.setPayload(payload);

    return () => {
      closeMentionMenu('edit');
      editEditorRef.current = null;
    };
  }, [closeMentionMenu, currentPost, editModalOpen, isWorkSchedulePost, syncMentionMenu]);

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

  const handleOpenGuide = useCallback(() => {
    const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';
    navigate(`${appPage}?guide=1`);
  }, [navigate]);

  // ---- board access + post loading ---------------------------------------
  // Firestore rules remain authoritative, but these client-side helpers keep
  // the detail screen's read/write affordances and error messages coherent.
  const canUseBoardData = useCallback((boardId, boardData) => {
    if (!currentUserProfile) return false;

    const normalizedBoardId = normalizeText(boardId);
    const roleKey = normalizeRoleKey(currentUserProfile.role, roleDefMap);
    const rawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);

    if (normalizedBoardId === WORK_SCHEDULE_BOARD_ID) {
      return roleKey !== 'Newbie' && !isExplicitNewbieRole(rawRole);
    }

    if (!boardData) return false;
    if (isPrivilegedBoardRole(roleKey)) return true;

    const allowedRoles = Array.isArray(boardData.allowedRoles) ? boardData.allowedRoles : [];

    if (roleKey === 'Newbie') {
      if (isNoticeBoardData(boardId, boardData)) return true;
      if (isExplicitNewbieRole(rawRole)) return false;
      const rawRoleCandidates = roleMatchCandidates(rawRole, roleDefMap);
      return rawRoleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
    }

    const roleCandidates = roleMatchCandidates(roleKey, roleDefMap);
    return roleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
  }, [currentUserProfile, roleDefMap]);

  const canWriteBoardData = useCallback((boardId, boardData) => {
    if (!currentUserProfile) return false;

    const normalizedBoardId = normalizeText(boardId);
    const roleKey = normalizeRoleKey(currentUserProfile.role, roleDefMap);
    const rawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);

    if (normalizedBoardId === WORK_SCHEDULE_BOARD_ID) {
      return WORK_SCHEDULE_WRITE_ROLES.includes(roleKey);
    }

    if (!boardData) return false;

    if (roleKey === 'Newbie') {
      if (isExplicitNewbieRole(rawRole)) return false;
      const allowedRoles = Array.isArray(boardData?.allowedRoles) ? boardData.allowedRoles : [];
      const rawRoleCandidates = roleMatchCandidates(rawRole, roleDefMap);
      return rawRoleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
    }

    return canUseBoardData(boardId, boardData);
  }, [canUseBoardData, currentUserProfile, roleDefMap]);

  const resolveBoardAccess = useCallback(async (boardId) => {
    const fallback = {
      boardId: normalizeText(boardId),
      boardName: normalizeText(boardId),
      boardExists: false,
      isDivider: false,
      allowedRoles: [],
      allowed: false,
      canWrite: false
    };

    if (!boardId) {
      return { ...fallback, boardName: '' };
    }

    try {
      const snap = await postFirestore.fetchBoardDoc(boardId);
      if (!snap.exists()) {
        const allowed = canUseBoardData(boardId, null);
        const canWrite = canWriteBoardData(boardId, null);
        if (normalizeText(boardId) === WORK_SCHEDULE_BOARD_ID) {
          return {
            ...fallback,
            boardName: WORK_SCHEDULE_BOARD_NAME,
            allowed,
            canWrite
          };
        }
        return fallback;
      }

      const data = snap.data() || {};
      const allowedRoles = Array.isArray(data.allowedRoles) ? data.allowedRoles : [];
      const allowed = canUseBoardData(boardId, data);
      const canWrite = canWriteBoardData(boardId, data);
      return {
        boardId: normalizeText(boardId),
        boardName: data.name || boardId,
        boardExists: true,
        isDivider: data.isDivider === true,
        allowedRoles,
        allowed,
        canWrite
      };
    } catch (err) {
      console.error('[resolve-board-access-error]', err);
      return fallback;
    }
  }, [canUseBoardData, canWriteBoardData]);

  useEffect(() => {
    if (editModalOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }

    document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [editModalOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (!editModalOpen || editSubmitting) return;
      setEditModalOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [editModalOpen, editSubmitting]);

  const loadPost = useCallback(async () => {
    setCurrentPostCanWrite(false);
    setCurrentPost(null);
    setCurrentBoardAccessDebug(null);
    resetCommentsState();
    setMessage({ type: '', text: '' });

    if (!postId) {
      setMessage({ type: 'error', text: '잘못된 접근입니다. postId가 없습니다.' });
      return;
    }

    let snap;
    try {
      snap = await postFirestore.fetchPostDoc(postId);
    } catch (err) {
      setMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 조회 실패') });
      return;
    }

    if (!snap.exists()) {
      setMessage({ type: 'error', text: '게시글이 존재하지 않습니다.' });
      return;
    }

    const loadedPost = { id: snap.id, ...snap.data(), views: numberOrZero(snap.data().views) };

    if (isDeletedPost(loadedPost)) {
      setMessage({ type: 'error', text: '삭제된 게시글입니다.' });
      return;
    }

    const boardAccess = await resolveBoardAccess(loadedPost.boardId);
    setCurrentBoardAccessDebug(boardAccess);
    setBoardLabel(boardAccess.boardName || loadedPost.boardId || '-');

    if (!boardAccess.allowed) {
      setMessage({ type: 'error', text: '이 게시판을 읽을 권한이 없습니다.' });
      return;
    }

    setCurrentPost(loadedPost);
    setCurrentPostCanWrite(!!boardAccess.canWrite);
    writeLastBoardId(loadedPost.boardId);

    try {
      await postFirestore.incrementPostViews(loadedPost.id, numberOrZero);
      setCurrentPost((prev) => (prev ? { ...prev, views: numberOrZero(prev.views) + 1 } : prev));
    } catch (_) {
      // Ignore view count failure.
    }

    setMessage({ type: '', text: '' });
  }, [currentUserProfile, postId, resetCommentsState, resolveBoardAccess]);

  useEffect(() => {
    let active = true;
    setMessage({ type: '', text: '' });
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        setMessage({ type: 'error', text: normalizeErrMessage(err, 'Firebase 설정 오류') });
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

        setRoleDefinitions(loadedRoleDefinitions);
        setCurrentUserProfile(normalizedProfile);
        setPermissions(loadedPermissions);
        setMessage({ type: '', text: '' });
      } catch (err) {
        if (!active) return;
        setMessage({ type: 'error', text: normalizeErrMessage(err, '초기화 실패') });
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
    if (!ready || !currentUserProfile) return;
    loadPost().catch(() => {});
  }, [ready, currentUserProfile, loadPost]);

  useEffect(() => {
    const uid = normalizeText(currentUser?.uid);
    const currentPostId = normalizeText(currentPost?.id);
    if (!uid || !currentPostId) return;

    const viewedAtMs = Date.now();
    postFirestore.upsertViewedPost(uid, currentPostId, {
      userUid: uid,
      postId: currentPostId,
      viewedAtMs,
      viewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((err) => {
      logErrorWithOptionalDebug('[post-view-mark-failed]', err, {
        error: err,
        uid,
        postId: currentPostId
      });
    });
  }, [currentPost?.id, currentUser?.uid]);

  const submitComment = useCallback(async (event) => {
    event.preventDefault();

    if (!currentPost || !currentUser || !currentUserProfile) return;
    if (!canAttemptCommentWrite) {
      setMessage({ type: 'error', text: '댓글 작성 권한이 없습니다.' });
      return;
    }

    const payload = editorRef.current?.getPayload() || { text: '', runs: [] };
    const delta = editorRef.current?.getDelta?.() || { ops: [{ insert: '\n' }] };
    if (!normalizeText(payload.text)) {
      setMessage({ type: 'error', text: '댓글 내용을 입력해주세요.' });
      return;
    }

    closeMentionMenu();
    setCommentSubmitting(true);

    let createdCommentId = '';
    const parentId = replyTarget ? replyTarget.id : null;
    const depth = parentId ? (Number(replyTarget.depth) || 0) + 1 : 0;
    const commentAuthorName = currentUserProfile.nickname || currentUserProfile.realName || currentUser.email || '익명';

    try {
      const createdRef = await postFirestore.createComment(currentPost.id, {
        parentId,
        depth,
        replyToAuthorName: parentId ? replyTarget.authorName : '',
        contentDelta: delta,
        contentRich: payload,
        contentText: payload.text,
        authorUid: currentUser.uid,
        authorName: commentAuthorName,
        authorRole: currentUserProfile.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      createdCommentId = normalizeText(createdRef?.id);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        const debugText = joinDebugParts([
          'action=comment-create',
          'errorStage=comment-add',
          boardAccessDebugText(currentBoardAccessDebug, currentUserProfile),
          `postId=${normalizeText(currentPost?.id) || '-'}`,
          `postBoardId=${normalizeText(currentPost?.boardId) || '-'}`,
          `postAuthorUid=${normalizeText(currentPost?.authorUid) || '-'}`,
          `myUid=${normalizeText(currentUser?.uid) || '-'}`,
          `myRawRoleHex=${debugCodePoints(currentUserProfile?.rawRole || currentUserProfile?.role || '')}`,
          `parentId=${normalizeText(parentId) || '-'}`,
          `depth=${Number.isFinite(depth) ? String(depth) : '-'}`,
          `createdCommentId=${createdCommentId || '-'}`,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[comment-create-permission-debug]', err, {
          error: err,
          postId: currentPost?.id || '',
          postBoardId: currentPost?.boardId || '',
          boardAccess: currentBoardAccessDebug,
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          userRawRoleHex: debugCodePoints(currentUserProfile?.rawRole || currentUserProfile?.role || ''),
          userUid: currentUser?.uid || '',
          parentId,
          depth,
          createdCommentId,
          debugText
        });
        setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 등록 실패') });
        setCommentSubmitting(false);
        return;
      }
      setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 등록 실패') });
      setCommentSubmitting(false);
      return;
    }

    try {
      await dispatchCommentNotifications({
        payloadText: payload.text,
        currentPost,
        boardLabel,
        currentUser,
        currentUserProfile,
        replyTarget,
        comments,
        createdCommentId
      });
    } catch (err) {
      logErrorWithOptionalDebug('[comment-notification-write-failed]', err, {
        error: err,
        postId: currentPost?.id || '',
        commentId: createdCommentId
      });
    }

    setReplyTarget(null);
    setExcelCommentModalOpen(false);
    commentDraftPayloadRef.current = { text: '', runs: [] };
    editorRef.current?.setPayload({ text: '', runs: [] });
    closeMentionMenu();
    setMessage({ type: '', text: '' });
    setCommentSubmitting(false);
  }, [
    boardLabel,
    canAttemptCommentWrite,
    closeMentionMenu,
    comments,
    currentPost,
    currentUser,
    currentUserProfile,
    dispatchCommentNotifications,
    replyTarget,
    normalizeErrMessage
  ]);

  const deletePost = useCallback(async () => {
    if (!currentPost || !canModerateCurrentPost) return;
    if (!window.confirm('게시글을 삭제할까요?')) return;

    try {
      await postFirestore.deletePostDoc(currentPost.id);
      if (resolvedBackBoardId) {
        navigate(backHref, { replace: true, state: { preferredBoardId: resolvedBackBoardId } });
      } else {
        navigate(backHref, { replace: true });
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        const debugText = joinDebugParts([
          'action=post-delete',
          boardAccessDebugText(currentBoardAccessDebug, currentUserProfile),
          `postId=${normalizeText(currentPost?.id) || '-'}`,
          `postAuthorUid=${normalizeText(currentPost?.authorUid) || '-'}`,
          `postAuthorUidHex=${debugCodePoints(currentPost?.authorUid || '')}`,
          `postAuthorId=${normalizeText(currentPost?.authorId) || '-'}`,
          `postUid=${normalizeText(currentPost?.uid) || '-'}`,
          `postAuthorNestedUid=${normalizeText(currentPost?.author?.uid) || '-'}`,
          `postCreatedByUid=${normalizeText(currentPost?.createdByUid || currentPost?.createdBy?.uid) || '-'}`,
          `myUid=${normalizeText(currentUser?.uid) || '-'}`,
          `myUidHex=${debugCodePoints(currentUser?.uid || '')}`,
          `canModerate=${permissions?.canModerate ? 'Y' : 'N'}`,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[post-delete-permission-debug]', err, {
          error: err,
          postId: currentPost?.id || '',
          postAuthorUid: currentPost?.authorUid || '',
          postAuthorUidHex: debugCodePoints(currentPost?.authorUid || ''),
          postAuthorId: currentPost?.authorId || '',
          postUid: currentPost?.uid || '',
          postAuthorNestedUid: currentPost?.author?.uid || '',
          postCreatedByUid: currentPost?.createdByUid || currentPost?.createdBy?.uid || '',
          myUid: currentUser?.uid || '',
          myUidHex: debugCodePoints(currentUser?.uid || ''),
          canModerate: !!permissions?.canModerate,
          boardAccess: currentBoardAccessDebug,
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          debugText
        });
        setMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 삭제 실패') });
        return;
      }
      setMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 삭제 실패') });
    }
  }, [
    canModerateCurrentPost,
    currentPost,
    currentUser,
    currentUserProfile,
    navigate,
    permissions,
    resolvedBackBoardId
  ]);

  const handleBackToList = useCallback(() => {
    if (resolvedBackBoardId) {
      navigate(backHref, { state: { preferredBoardId: resolvedBackBoardId } });
      return;
    }
    navigate(backHref);
  }, [backHref, navigate, resolvedBackBoardId]);

  const updateCoverForDateStatus = useCallback(async (targetIndexRaw, nextStatusRaw) => {
    if (!currentPost || !canChangeCoverStatus) return;
    if (normalizeText(currentPost.boardId) !== COVER_FOR_BOARD_ID) return;

    const entries = coverForDateEntriesFromPost(currentPost);
    const targetIndex = Number.isFinite(Number(targetIndexRaw)) ? Number(targetIndexRaw) : -1;
    if (targetIndex < 0) return;
    if (targetIndex >= entries.length) return;

    const targetDateKey = normalizeDateKeyInput(entries[targetIndex]?.dateKey);
    if (!targetDateKey) return;

    const nextStatus = normalizeCoverForStatus(nextStatusRaw);
    const prevStatus = normalizeCoverForStatus(entries[targetIndex].status);
    if (nextStatus === prevStatus) return;

    if (nextStatus === COVER_FOR_STATUS.SEEKING && !canResetCoverToSeeking) {
      setMessage({ type: 'error', text: '구하는 중 복구는 관리자/개발자만 가능합니다.' });
      return;
    }

    const nextEntries = entries.map((entry, idx) => (
      idx === targetIndex ? { ...entry, status: nextStatus } : entry
    ));
    const nextSummary = summarizeCoverForDateEntries(nextEntries);
    const nextDateKeys = nextEntries.map((entry) => entry.dateKey);
    const nextDateStatuses = nextEntries.map((entry) => normalizeCoverForStatus(entry.status));
    const nextCoverForStatus = nextSummary.statusClass === 'closed'
      ? COVER_FOR_STATUS.COMPLETED
      : normalizeCoverForStatus(nextSummary.statusClass);

    setStatusUpdating(true);
    try {
      await postFirestore.updatePostDoc(currentPost.id, {
        coverForDateKeys: nextDateKeys,
        coverForDateStatuses: nextDateStatuses,
        coverForStatus: nextCoverForStatus,
        updatedAt: serverTimestamp()
      });

      setCurrentPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          coverForDateKeys: nextDateKeys,
          coverForDateStatuses: nextDateStatuses,
          coverForStatus: nextCoverForStatus
        };
      });

      setMessage({ type: 'notice', text: `${targetDateKey} 상태를 [${coverForStatusLabel(nextStatus)}]로 변경했습니다.` });
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestPostDocExists = false;
        let latestPostAuthorUid = '';
        let latestPostAuthorId = '';
        let latestPostUid = '';
        let latestPostCreatedByUid = '';
        try {
          const latestPostSnap = await postFirestore.fetchPostDoc(currentPost.id);
          latestPostDocExists = !!latestPostSnap?.exists?.() && latestPostSnap.exists();
          if (latestPostDocExists) {
            const latestPostData = latestPostSnap.data() || {};
            latestPostAuthorUid = normalizeText(latestPostData.authorUid);
            latestPostAuthorId = normalizeText(latestPostData.authorId);
            latestPostUid = normalizeText(latestPostData.uid);
            latestPostCreatedByUid = normalizeText(
              latestPostData.createdByUid
              || latestPostData?.createdBy?.uid
            );
          }
        } catch (_) {
          // Keep original permission error when extra debug reads fail.
        }

        const debugText = joinDebugParts([
          'action=cover-status-update',
          boardAccessDebugText(currentBoardAccessDebug, currentUserProfile),
          `runtimeProjectId=${normalizeText(postFirestore.getRuntimeProjectId()) || '-'}`,
          `postId=${normalizeText(currentPost?.id) || '-'}`,
          `postAuthorUid=${normalizeText(currentPost?.authorUid) || '-'}`,
          `postAuthorUidHex=${debugCodePoints(currentPost?.authorUid || '')}`,
          `postAuthorId=${normalizeText(currentPost?.authorId) || '-'}`,
          `postUid=${normalizeText(currentPost?.uid) || '-'}`,
          `postAuthorNestedUid=${normalizeText(currentPost?.author?.uid) || '-'}`,
          `postCreatedByUid=${normalizeText(currentPost?.createdByUid || currentPost?.createdBy?.uid) || '-'}`,
          `myUid=${normalizeText(currentUser?.uid) || '-'}`,
          `myUidHex=${debugCodePoints(currentUser?.uid || '')}`,
          `latestPostDoc=${latestPostDocExists ? 'exists' : 'missing'}`,
          `latestPostAuthorUid=${latestPostAuthorUid || '-'}`,
          `latestPostAuthorUidHex=${debugCodePoints(latestPostAuthorUid || '')}`,
          `latestPostAuthorId=${latestPostAuthorId || '-'}`,
          `latestPostUid=${latestPostUid || '-'}`,
          `latestPostCreatedByUid=${latestPostCreatedByUid || '-'}`,
          `latestOwnerMatch=${latestPostAuthorUid && normalizeText(latestPostAuthorUid) === normalizeText(currentUser?.uid) ? 'Y' : 'N'}`,
          `canModerate=${permissions?.canModerate ? 'Y' : 'N'}`,
          `canChangeCoverStatus=${canChangeCoverStatus ? 'Y' : 'N'}`,
          `canResetCoverToSeeking=${canResetCoverToSeeking ? 'Y' : 'N'}`,
          `targetIndex=${targetIndex}`,
          `targetDate=${targetDateKey}`,
          `nextStatus=${nextStatus}`,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[cover-status-update-permission-debug]', err, {
          error: err,
          runtimeProjectId: normalizeText(postFirestore.getRuntimeProjectId()),
          postId: currentPost?.id || '',
          postAuthorUid: currentPost?.authorUid || '',
          postAuthorUidHex: debugCodePoints(currentPost?.authorUid || ''),
          postAuthorId: currentPost?.authorId || '',
          postUid: currentPost?.uid || '',
          postAuthorNestedUid: currentPost?.author?.uid || '',
          postCreatedByUid: currentPost?.createdByUid || currentPost?.createdBy?.uid || '',
          myUid: currentUser?.uid || '',
          myUidHex: debugCodePoints(currentUser?.uid || ''),
          latestPostDocExists,
          latestPostAuthorUid,
          latestPostAuthorUidHex: debugCodePoints(latestPostAuthorUid || ''),
          latestPostAuthorId,
          latestPostUid,
          latestPostCreatedByUid,
          latestOwnerMatch: latestPostAuthorUid && normalizeText(latestPostAuthorUid) === normalizeText(currentUser?.uid),
          canModerate: !!permissions?.canModerate,
          canChangeCoverStatus,
          canResetCoverToSeeking,
          targetIndex,
          targetDateKey,
          nextStatus,
          boardAccess: currentBoardAccessDebug,
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          debugText
        });
        setMessage({ type: 'error', text: normalizeErrMessage(err, '상태 변경 실패') });
        return;
      }
      setMessage({ type: 'error', text: normalizeErrMessage(err, '상태 변경 실패') });
    } finally {
      setStatusUpdating(false);
    }
  }, [
    canChangeCoverStatus,
    canResetCoverToSeeking,
    currentPost,
    currentUser,
    currentUserProfile,
    permissions
  ]);

  const renderedPostBody = useMemo(() => {
    if (!currentPost) return '';
    return renderStoredContentHtml(currentPost);
  }, [currentPost]);

  const renderCommentComposer = (inline = false) => (
    <form
      id="commentForm"
      className={canAttemptCommentWrite ? `stack${inline ? ' comment-inline-composer' : ''}` : `stack${inline ? ' comment-inline-composer' : ''} hidden`}
      style={inline ? undefined : { marginTop: '12px' }}
      onSubmit={submitComment}
    >
      <div id="replyTargetBar" className={replyTarget ? `reply-target-bar${inline ? ' reply-inline-bar' : ''}` : 'reply-target-bar hidden'}>
        <span id="replyTargetText">
          {replyTarget ? `↳ ${replyTarget.authorName}에게 답장` : ''}
        </span>
        <button
          id="cancelReplyBtn"
          type="button"
          className="comment-action-btn"
          onClick={() => {
            setReplyTarget(null);
            closeMentionMenu('comment');
            editorRef.current?.focus();
          }}
        >
          답글 취소
        </button>
      </div>

      <div className="editor-shell with-mention-menu">
        <RichEditorToolbar
          editorRef={editorRef}
          fontSizeLabelRef={fontSizeLabelRef}
          ids={{
            fontSizeLabelId: 'commentFontSizeLabel',
            fontDownId: 'commentFontDownBtn',
            fontUpId: 'commentFontUpBtn',
            colorId: 'commentFontColor'
          }}
        />

        <div className="editor-mention-wrap">
          <div
            id="commentEditor"
            className="editor-content"
            ref={editorElCallbackRef}
          />
          <div
            className={commentMentionMenu.open ? 'mention-menu mention-menu-anchor' : 'mention-menu mention-menu-anchor hidden'}
            style={{ left: `${commentMentionMenu.anchorLeft}px`, top: `${commentMentionMenu.anchorTop}px` }}
          >
            {commentMentionCandidates.length ? commentMentionCandidates.map((candidate, idx) => (
              <button
                key={`mention-candidate-${candidate.uid}`}
                type="button"
                className={idx === commentMentionActiveIndex ? 'mention-menu-item is-active' : 'mention-menu-item'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMentionCandidate('comment', candidate);
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

      <div className="row comment-action-row">
        <button id="submitCommentBtn" type="submit" className="btn-primary comment-action-btn" disabled={commentSubmitting}>
          {commentSubmitting ? '등록 중...' : '댓글 등록'}
        </button>
      </div>
    </form>
  );

  const forumPage = MENTOR_FORUM_CONFIG.app.appPage;
  const myPostsPage = MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts';
  const myCommentsPage = MENTOR_FORUM_CONFIG.app.myCommentsPage || '/me/comments';
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

  const handleMoveHome = useCallback(() => {
    navigate(forumPage);
  }, [forumPage, navigate]);
  const handleBrandTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleMoveHome();
  }, [handleMoveHome]);

  const userRoleLabel = useMemo(() => {
    const roleKey = normalizeText(currentUserProfile?.role);
    if (!roleKey) return '-';
    return roleDefMap.get(roleKey)?.labelKo || roleKey;
  }, [currentUserProfile?.role, roleDefMap]);

  const excelCommentRows = useMemo(() => {
    return comments.map((comment) => ({
      commentId: comment.id,
      author: commentAuthorName(comment),
      dateText: toDateText(comment.createdAt),
      contentText: stripHtmlToText(renderStoredContentHtml(comment)),
      depth: Number(comment._threadDepth) || 0,
      canDelete: !!(permissions?.canModerate || (currentUser && comment.authorUid === currentUser.uid)),
      canReply: canAttemptCommentWrite
    }));
  }, [comments, commentAuthorName, permissions, currentUser, canAttemptCommentWrite]);

  const postMetaLine = useMemo(() => {
    if (!currentPost) return '-';
    return `${currentPost.authorName || currentPost.authorUid || '-'} · ${toDateText(currentPost.createdAt)} · 조회 ${numberOrZero(currentPost.views)}`;
  }, [currentPost]);

  const excelSheetModel = useMemo(() => {
    return buildPostDetailExcelSheetModel({
      userDisplayName,
      canAccessAdminSite,
      boardLabel,
      title: currentPost?.title || '(제목 없음)',
      metaLine: postMetaLine,
      bodyText: stripHtmlToText(renderedPostBody),
      commentCount: comments.length,
      comments: excelCommentRows,
      canModerate: canModerateCurrentPost,
      canWriteComment: canAttemptCommentWrite,
      isCoverForPost,
      canChangeCoverStatus,
      canResetCoverToSeeking,
      coverDateEntries: currentPostCoverDateEntries.map((entry) => ({
        dateKey: entry.dateKey,
        startTime: normalizeTimeInput(entry.startTimeValue) || COVER_FOR_DEFAULT_START_TIME,
        endTime: normalizeTimeInput(entry.endTimeValue) || COVER_FOR_DEFAULT_END_TIME,
        venue: normalizeCoverForVenue(entry.venue) || COVER_FOR_DEFAULT_VENUE,
        status: normalizeCoverForStatus(entry.status),
        statusLabel: coverForStatusLabel(normalizeCoverForStatus(entry.status))
      }))
    });
  }, [
    boardLabel,
    canAccessAdminSite,
    canAttemptCommentWrite,
    canChangeCoverStatus,
    canModerateCurrentPost,
    canResetCoverToSeeking,
    comments.length,
    currentPostCoverDateEntries,
    currentPost?.title,
    isCoverForPost,
    renderedPostBody,
    userDisplayName,
    userRoleLabel
  ]);

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
    if (actionType === 'backToList') {
      handleBackToList();
      return;
    }
    if (actionType === 'openEdit') {
      openEditModal();
      return;
    }
    if (actionType === 'deletePost') {
      deletePost().catch(() => {});
      return;
    }
    if (actionType === 'focusComment') {
      const targetId = normalizeText(payload?.commentId);
      if (!targetId) return;
      const nextParams = new URLSearchParams(location.search);
      nextParams.set('commentId', targetId);
      navigate(`${MENTOR_FORUM_CONFIG.app.postPage || '/post'}?${nextParams.toString()}`, {
        state: location.state
      });
      return;
    }
    if (actionType === 'replyToComment') {
      const targetCommentId = normalizeText(payload?.commentId);
      const targetAuthorName = String(payload?.authorName || '');
      const targetDepth = Number(payload?.depth) || 0;
      if (!targetCommentId) return;
      setReplyTarget({
        id: targetCommentId,
        authorName: targetAuthorName,
        authorUid: '',
        depth: targetDepth
      });
      closeMentionMenu('comment');
      setExcelCommentModalOpen(true);
      return;
    }
    if (actionType === 'deleteComment') {
      const targetCommentId = normalizeText(payload?.commentId);
      if (!targetCommentId) return;
      deleteComment(targetCommentId).catch(() => {});
      return;
    }
    if (actionType === 'updateCoverStatus') {
      const targetIndex = payload?.index;
      const nextStatus = payload?.nextStatus;
      if (targetIndex == null || !nextStatus) return;
      updateCoverForDateStatus(targetIndex, nextStatus).catch(() => {});
      return;
    }
    if (actionType === 'openCommentComposer') {
      setReplyTarget(null);
      closeMentionMenu('comment');
      setExcelCommentModalOpen(true);
    }
  }, [
    deleteComment,
    deletePost,
    handleBackToList,
    location.search,
    location.state,
    navigate,
    openEditModal,
    updateCoverForDateStatus
  ]);

  // ---- flat VM contract ---------------------------------------------------
  // The view still consumes a broad flat VM because the JSX historically
  // referenced controller-owned identifiers directly. Keeping that contract
  // stable makes the refactor incremental and reviewable.

  return {
    navigate,
    toggleTheme,
    isExcel,
    editorRef,
    fontSizeLabelRef,
    editEditorRef,
    editEditorElRef,
    editFontSizeLabelRef,
    ready,
    message,
    currentUser,
    currentUserProfile,
    permissions,
    currentPost,
    comments,
    commentsLoading,
    replyTarget,
    setReplyTarget,
    editMentionMenu,
    editMentionCandidates,
    editMentionActiveIndex,
    excelCommentModalOpen,
    setExcelCommentModalOpen,
    statusUpdating,
    editModalOpen,
    setEditModalOpen,
    editTitle,
    setEditTitle,
    editHtmlContent,
    setEditHtmlContent,
    editWorkScheduleTableRows,
    setEditWorkScheduleTableRows,
    addEditWorkScheduleRow,
    addEditWorkScheduleColumn,
    updateEditWorkScheduleCell,
    removeEditWorkScheduleRow,
    moveEditWorkScheduleRow,
    reorderEditWorkScheduleRow,
    removeEditWorkScheduleColumn,
    editSubmitting,
    editMessage,
    sessionRemainingMs,
    compactListMode,
    boardLabel,
    roleDefMap,
    canAccessAdminSite,
    canModerateCurrentPost,
    canAttemptCommentWrite,
    isCoverForPost,
    isWorkSchedulePost,
    canChangeCoverStatus,
    canResetCoverToSeeking,
    currentPostCoverDateEntries,
    currentPostCoverSummary,
    currentPostCoverStatus,
    isCoverForClosed,
    userDisplayName,
    closeMentionMenu,
    syncMentionMenu,
    applyMentionCandidate,
    handleExtendSession,
    handleLogout,
    handleOpenGuide,
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
    excelSheetModel,
    isExcelDesktopMode,
    excelActiveCellLabel,
    excelFormulaText,
    handleExcelSelectCell,
    handleExcelAction
  };
}
