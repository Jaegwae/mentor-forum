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
import { pushRelayConfigured, sendPushRelayNotification } from '../../legacy/push-relay.js';
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

const {
  NOTICE_BOARD_ID,
  ALL_BOARD_ID,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  WORK_SCHEDULE_BOARD_NAME,
  WORK_SCHEDULE_WRITE_ROLES,
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
  toDateKey,
  fromDateKey,
  formatDateKeyLabel,
  normalizeDateKeyInput,
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
  sanitizeStoredContentHtml,
  extractWorkScheduleRowsFromHtml,
  extractEditableTableGridFromHtml,
  normalizeEditableTableGrid,
  replaceFirstTableInHtml,
  renderStoredContentHtml,
  createRoleDefMap,
  normalizeRoleKey,
  isExplicitNewbieRole,
  roleMatchCandidates,
  isPrivilegedBoardRole,
  isNoticeBoardData,
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
  const focusCommentTimerRef = useRef(null);
  const mentionRequestIdRef = useRef({ comment: 0, edit: 0 });
  const mentionCacheRef = useRef(new Map());
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
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Comment composer/mention/edit modal state.
  const [replyTarget, setReplyTarget] = useState(null);
  const [commentMentionMenu, setCommentMentionMenu] = useState(MENTION_MENU_INITIAL);
  const [commentMentionCandidates, setCommentMentionCandidates] = useState([]);
  const [commentMentionActiveIndex, setCommentMentionActiveIndex] = useState(0);
  const [editMentionMenu, setEditMentionMenu] = useState(MENTION_MENU_INITIAL);
  const [editMentionCandidates, setEditMentionCandidates] = useState([]);
  const [editMentionActiveIndex, setEditMentionActiveIndex] = useState(0);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [excelCommentModalOpen, setExcelCommentModalOpen] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  // Work-schedule edit keeps the original HTML snapshot so non-table sections
  // (intro paragraphs, notices, links) survive table-only edits.
  const [editHtmlContent, setEditHtmlContent] = useState('');
  // Generic 2D grid model used by the work-schedule table editor.
  // row[0] is treated as the header row in the view layer.
  const [editWorkScheduleTableRows, setEditWorkScheduleTableRows] = useState([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editMessage, setEditMessage] = useState({ type: '', text: '' });
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

  // Board/debug labels used for permission diagnostics.
  const [boardLabel, setBoardLabel] = useState(boardIdFromQuery || '-');
  const [currentBoardAccessDebug, setCurrentBoardAccessDebug] = useState(null);

  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);

  useEffect(() => {
    setBoardLabel(boardIdFromQuery || '-');
  }, [boardIdFromQuery]);

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
  const isAdminOrSuper = normalizeText(currentUserProfile?.role) === 'Admin' || normalizeText(currentUserProfile?.role) === 'Super_Admin';
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
  const currentUserUid = normalizeText(currentUser?.uid);

  const fetchMentionCandidates = useCallback(async (queryText = '') => {
    const normalizedQuery = normalizeNickname(queryText);
    const keyPrefix = buildNicknameKey(normalizedQuery);
    const snap = await postFirestore.fetchMentionIndexDocs({
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
      const lowerQuery = normalizedQuery.toLowerCase();
      if (!lowerQuery || MENTION_ALL_TOKEN.toLowerCase().startsWith(lowerQuery)) {
        next.unshift({ uid: '__all__', nickname: MENTION_ALL_TOKEN });
      }
    }
    return next.slice(0, MENTION_MAX_ITEMS);
  }, [currentUserUid, isAdminOrSuper]);

  const readMentionAnchor = useCallback((editor, mentionStart) => {
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

  const closeMentionMenu = useCallback((target = 'comment') => {
    if (target === 'edit') {
      setEditMentionMenu(MENTION_MENU_INITIAL);
      setEditMentionCandidates([]);
      setEditMentionActiveIndex(0);
      return;
    }

    setCommentMentionMenu(MENTION_MENU_INITIAL);
    setCommentMentionCandidates([]);
    setCommentMentionActiveIndex(0);
  }, []);

  const syncMentionMenu = useCallback((target = 'comment') => {
    const isEditTarget = target === 'edit';
    const editor = isEditTarget ? editEditorRef.current : editorRef.current;
    if (!editor) {
      closeMentionMenu(target);
      return;
    }

    const selection = editor.getSelection?.() || { index: 0 };
    const rawText = editor.getRawText?.() || editor.getPayload?.()?.text || '';
    const context = detectMentionContext(rawText, selection.index);

    if (!context) {
      closeMentionMenu(target);
      return;
    }

    const anchor = readMentionAnchor(editor, context.start);
    const nextMenu = {
      open: true,
      query: context.query,
      start: context.start,
      end: context.end,
      anchorLeft: anchor.anchorLeft,
      anchorTop: anchor.anchorTop
    };
    if (isEditTarget) {
      setEditMentionMenu(nextMenu);
      setEditMentionActiveIndex(0);
    } else {
      setCommentMentionMenu(nextMenu);
      setCommentMentionActiveIndex(0);
    }

    const cacheKey = `${currentUserUid || '-'}:${context.query.toLowerCase()}`;
    const cached = mentionCacheRef.current.get(cacheKey);
    if (cached) {
      if (isEditTarget) {
        setEditMentionCandidates(cached);
      } else {
        setCommentMentionCandidates(cached);
      }
      return;
    }

    const currentRequest = mentionRequestIdRef.current || {};
    const requestId = Number(currentRequest[target] || 0) + 1;
    mentionRequestIdRef.current = { ...currentRequest, [target]: requestId };
    fetchMentionCandidates(context.query)
      .then((rows) => {
        if (Number((mentionRequestIdRef.current || {})[target] || 0) !== requestId) return;
        mentionCacheRef.current.set(cacheKey, rows);
        if (isEditTarget) {
          setEditMentionCandidates(rows);
        } else {
          setCommentMentionCandidates(rows);
        }
      })
      .catch(() => {
        if (Number((mentionRequestIdRef.current || {})[target] || 0) !== requestId) return;
        if (isEditTarget) {
          setEditMentionCandidates([]);
        } else {
          setCommentMentionCandidates([]);
        }
      });
  }, [closeMentionMenu, currentUserUid, fetchMentionCandidates, readMentionAnchor]);

  const applyMentionCandidate = useCallback((target, candidate) => {
    const isEditTarget = target === 'edit';
    const editor = isEditTarget ? editEditorRef.current : editorRef.current;
    const mentionMenu = isEditTarget ? editMentionMenu : commentMentionMenu;
    const nickname = normalizeNickname(candidate?.nickname);
    if (!editor || !nickname) return;

    const start = Number.isFinite(Number(mentionMenu.start)) ? Number(mentionMenu.start) : -1;
    const end = Number.isFinite(Number(mentionMenu.end)) ? Number(mentionMenu.end) : -1;
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
    closeMentionMenu(target);
    editor.focus?.();
  }, [closeMentionMenu, commentMentionMenu, editMentionMenu]);

  const insertReplyMention = useCallback((target) => {
    const editor = editorRef.current;
    const nickname = normalizeNickname(target?.authorName);
    if (!editor || !nickname) return;

    const payloadText = String(editor.getPayload?.()?.text || '');
    const mentionToken = `@${nickname}`;
    if (payloadText.includes(mentionToken)) {
      editor.focus?.();
      return;
    }

    const selection = editor.getSelection?.() || { index: payloadText.length, length: 0 };
    const index = Math.max(0, Number(selection.index) || 0);
    const length = Math.max(0, Number(selection.length) || 0);
    const inserted = editor.insertMention?.(index, length, {
      uid: normalizeText(target?.authorUid),
      nickname
    });
    if (!inserted) {
      editor.replaceRange?.(index, length, `${mentionToken} `);
    }
    editor.focus?.();
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
    if (!currentPost?.id) {
      setComments([]);
      setCommentsLoading(false);
      return () => {};
    }

    setCommentsLoading(true);
    const unsubscribe = postFirestore.subscribeCommentsForPost({
      postId: currentPost.id,
      onNext: (snap) => {
      const ordered = sortCommentsForDisplay(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      );
      setComments(ordered);
      setCommentsLoading(false);
    },
      onError: (err) => {
      logErrorWithOptionalDebug('[comment-realtime-subscribe-failed]', err, {
        error: err,
        postId: currentPost.id
      });
      setComments([]);
      setCommentsLoading(false);
      setMessage((prev) => (
        prev?.type === 'error' && prev?.text
          ? prev
          : { type: 'error', text: normalizeErrMessage(err, '댓글 조회 실패') }
      ));
    }
    });

    return () => {
      unsubscribe();
    };
  }, [currentPost?.id]);

  useEffect(() => {
    if (!replyTarget) return;
    if (comments.some((comment) => comment.id === replyTarget.id)) return;
    setReplyTarget(null);
  }, [comments, replyTarget]);

  useEffect(() => {
    if (!replyTarget) return () => {};

    let cancelled = false;
    let retries = 0;
    const attemptInsert = () => {
      if (cancelled) return;
      if (editorRef.current) {
        insertReplyMention(replyTarget);
        syncMentionMenu('comment');
        return;
      }
      retries += 1;
      if (retries > 18) return;
      window.setTimeout(attemptInsert, 18);
    };

    window.setTimeout(attemptInsert, 0);
    return () => {
      cancelled = true;
    };
  }, [insertReplyMention, replyTarget, syncMentionMenu]);

  useEffect(() => {
    return () => {
      if (focusCommentTimerRef.current) {
        window.clearTimeout(focusCommentTimerRef.current);
        focusCommentTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!focusCommentId || commentsLoading || !comments.length) return;
    if (!comments.some((comment) => String(comment.id) === focusCommentId)) return;

    const targets = Array.from(document.querySelectorAll('[data-comment-id]'));
    const targetEl = targets.find((node) => String(node.getAttribute('data-comment-id') || '') === focusCommentId);
    if (!targetEl) return;

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.remove('comment-focus-highlight');
    void targetEl.offsetWidth;
    targetEl.classList.add('comment-focus-highlight');

    if (focusCommentTimerRef.current) {
      window.clearTimeout(focusCommentTimerRef.current);
      focusCommentTimerRef.current = null;
    }
    focusCommentTimerRef.current = window.setTimeout(() => {
      targetEl.classList.remove('comment-focus-highlight');
      focusCommentTimerRef.current = null;
    }, 2200);
  }, [comments, commentsLoading, focusCommentId]);

  useEffect(() => {
    const mentionTarget = editMentionMenu.open ? 'edit' : (commentMentionMenu.open ? 'comment' : '');
    if (!mentionTarget) return () => {};

    const onKeyDown = (event) => {
      const candidates = mentionTarget === 'edit' ? editMentionCandidates : commentMentionCandidates;
      const activeIndex = mentionTarget === 'edit' ? editMentionActiveIndex : commentMentionActiveIndex;
      const setActiveIndex = mentionTarget === 'edit' ? setEditMentionActiveIndex : setCommentMentionActiveIndex;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMentionMenu(mentionTarget);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => {
          if (!candidates.length) return 0;
          return (prev + 1) % candidates.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => {
          if (!candidates.length) return 0;
          return (prev - 1 + candidates.length) % candidates.length;
        });
        return;
      }

      if (event.key === 'Enter' && candidates.length) {
        event.preventDefault();
        event.stopPropagation();
        const targetCandidate = candidates[activeIndex] || candidates[0];
        applyMentionCandidate(mentionTarget, targetCandidate);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [
    applyMentionCandidate,
    closeMentionMenu,
    commentMentionActiveIndex,
    commentMentionCandidates,
    commentMentionMenu.open,
    editMentionActiveIndex,
    editMentionCandidates,
    editMentionMenu.open
  ]);

  useEffect(() => {
    if (canAttemptCommentWrite) return;
    closeMentionMenu('comment');
  }, [canAttemptCommentWrite, closeMentionMenu]);

  useEffect(() => {
    if (editModalOpen) return;
    closeMentionMenu('edit');
  }, [closeMentionMenu, editModalOpen]);

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
    setComments([]);
    setReplyTarget(null);
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
  }, [currentUserProfile, postId, resolveBoardAccess]);

  useEffect(() => {
    let active = true;
    setMessage({ type: '', text: '' });
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        setMessage({ type: 'error', text: err.message || 'Firebase 설정 오류' });
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

  const resolveMentionTargets = useCallback(async (sourceText) => {
    const nicknames = extractMentionNicknames(sourceText).filter(
      (nickname) => normalizeText(nickname).toUpperCase() !== MENTION_ALL_TOKEN
    );
    if (!nicknames.length) return [];

    const resolved = await Promise.all(
      nicknames.map(async (nickname) => {
        const key = buildNicknameKey(nickname);
        if (!key) return null;
        const snap = await postFirestore.fetchNicknameIndexDoc(key);
        if (!snap.exists()) return null;
        const data = snap.data() || {};
        const uid = normalizeText(data.uid);
        const resolvedNickname = normalizeNickname(data.nickname || nickname);
        if (!uid || !resolvedNickname) return null;
        return { uid, nickname: resolvedNickname };
      })
    );

    const byUid = new Map();
    resolved.forEach((item) => {
      if (!item || !item.uid) return;
      byUid.set(item.uid, item);
    });
    return [...byUid.values()];
  }, []);

  const resolveAllMentionTargets = useCallback(async () => {
    const usersSnap = await postFirestore.fetchUsersDocs();
    const rows = usersSnap.docs
      .map((row) => {
        const data = row.data() || {};
        const uid = normalizeText(row.id || data.uid);
        const nickname = normalizeNickname(data.nickname || data.realName || data.email || uid);
        if (!uid || !nickname) return null;
        return { uid, nickname };
      })
      .filter(Boolean);

    const byUid = new Map();
    rows.forEach((item) => {
      if (!item || !item.uid) return;
      byUid.set(item.uid, item);
    });
    return [...byUid.values()];
  }, []);

  const writeUserNotification = useCallback(async ({
    targetUid,
    type,
    subtype = '',
    postId: targetPostId,
    boardId,
    boardName,
    title,
    body = '',
    actorUid,
    actorName,
    commentId = ''
  }) => {
    const userUid = normalizeText(targetUid);
    const safePostId = normalizeText(targetPostId);
    const safeBoardId = normalizeText(boardId);
    if (!userUid || !safePostId || !safeBoardId) return null;

    const safeType = normalizeNotificationType(type);
    const safeSubtype = normalizeText(subtype);
    const safeCommentId = normalizeText(commentId);
    const safeActorUid = normalizeText(actorUid);
    const safeActorName = normalizeText(actorName) || '익명';
    const notificationId = notificationIdForEvent(
      `${safeType}${safeSubtype ? `-${safeSubtype}` : ''}`,
      safePostId,
      safeCommentId,
      userUid
    );
    const createdAtMs = Date.now();

    await postFirestore.upsertNotificationDoc(userUid, notificationId, {
      userUid,
      actorUid: safeActorUid,
      actorName: safeActorName,
      type: safeType,
      subtype: safeSubtype,
      postId: safePostId,
      commentId: safeCommentId,
      boardId: safeBoardId,
      boardName: normalizeText(boardName) || safeBoardId,
      title: normalizeText(title) || '(제목 없음)',
      body: toNotificationBodySnippet(body),
      createdAtMs,
      readAtMs: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    return {
      targetUid: userUid,
      notificationId
    };
  }, []);

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
      const actorUid = normalizeText(currentUser.uid);
      const postIdValue = normalizeText(currentPost.id);
      const boardIdValue = normalizeText(currentPost.boardId);
      const boardNameValue = normalizeText(currentBoardAccessDebug?.boardName || boardLabel || boardIdValue) || boardIdValue;
      const postTitle = normalizeText(currentPost.title) || '(제목 없음)';
      const postAuthorUid = normalizeText(currentPost.authorUid);
      const mentionTargets = await resolveMentionTargets(payload.text);
      // @all notification fan-out is intentionally restricted to admin/super-admin accounts.
      const canUseAllMentionCommand = isAdminOrSuper;
      const hasAllMention = canUseAllMentionCommand && hasAllMentionCommand(payload.text);
      const allMentionTargets = hasAllMention
        ? await resolveAllMentionTargets()
        : [];
      const mentionTargetUidSet = new Set(
        mentionTargets
          .map((item) => normalizeText(item?.uid))
          .filter(Boolean)
      );
      const allMentionTargetUidSet = new Set(
        allMentionTargets
          .map((item) => normalizeText(item?.uid))
          .filter(Boolean)
      );

      const parentAuthorUid = parentId
        ? normalizeText(
          replyTarget?.authorUid
          || comments.find((item) => normalizeText(item?.id) === normalizeText(parentId))?.authorUid
        )
        : '';

      const events = [];

      if (postAuthorUid && postAuthorUid !== actorUid) {
        events.push({
          targetUid: postAuthorUid,
          type: NOTIFICATION_TYPE.COMMENT,
          subtype: NOTIFICATION_SUBTYPE.POST_COMMENT,
          body: `${commentAuthorName}님이 내 게시글에 댓글을 남겼습니다.`
        });
      }

      if (
        parentId
        && parentAuthorUid
        && parentAuthorUid !== actorUid
        && parentAuthorUid !== postAuthorUid
        && !mentionTargetUidSet.has(parentAuthorUid)
        && !allMentionTargetUidSet.has(parentAuthorUid)
      ) {
        events.push({
          targetUid: parentAuthorUid,
          type: NOTIFICATION_TYPE.COMMENT,
          subtype: NOTIFICATION_SUBTYPE.REPLY_COMMENT,
          body: `${commentAuthorName}님이 내 댓글에 답글을 남겼습니다.`
        });
      }

      mentionTargets.forEach((target) => {
        const targetUid = normalizeText(target?.uid);
        if (!targetUid || targetUid === actorUid) return;
        events.push({
          targetUid,
          type: NOTIFICATION_TYPE.MENTION,
          subtype: NOTIFICATION_SUBTYPE.MENTION,
          body: `${commentAuthorName}님이 댓글에서 회원님을 언급했습니다.`
        });
      });

      allMentionTargets.forEach((target) => {
        const targetUid = normalizeText(target?.uid);
        if (!targetUid || targetUid === actorUid) return;
        events.push({
          targetUid,
          type: NOTIFICATION_TYPE.MENTION,
          subtype: NOTIFICATION_SUBTYPE.MENTION_ALL,
          body: `${commentAuthorName}님이 댓글에서 @ALL로 전체 멘션을 보냈습니다.`
        });
      });

      const dedupedByKey = new Map();
      events.forEach((eventItem) => {
        const targetUid = normalizeText(eventItem?.targetUid);
        const type = normalizeNotificationType(eventItem?.type);
        const subtype = normalizeText(eventItem?.subtype);
        if (!targetUid) return;
        const key = `${targetUid}|${type}`;
        const existing = dedupedByKey.get(key);
        if (!existing) {
          dedupedByKey.set(key, eventItem);
          return;
        }
        if (
          subtype === NOTIFICATION_SUBTYPE.MENTION_ALL
          && normalizeText(existing?.subtype) !== NOTIFICATION_SUBTYPE.MENTION_ALL
        ) {
          dedupedByKey.set(key, eventItem);
        }
      });

      const createdNotifications = await Promise.all(
        [...dedupedByKey.values()].map(async (eventItem) => {
          return writeUserNotification({
            targetUid: eventItem.targetUid,
            type: eventItem.type,
            subtype: eventItem.subtype,
            postId: postIdValue,
            commentId: createdCommentId,
            boardId: boardIdValue,
            boardName: boardNameValue,
            title: postTitle,
            body: eventItem.body,
            actorUid,
            actorName: commentAuthorName
          });
        })
      );

      const relayTargets = createdNotifications.filter((item) => item && item.targetUid && item.notificationId);
      if (relayTargets.length && pushRelayConfigured() && typeof currentUser?.getIdToken === 'function') {
        void (async () => {
          try {
            const idToken = normalizeText(await currentUser.getIdToken());
            if (!idToken) return;
            await Promise.allSettled(
              relayTargets.map((target) => sendPushRelayNotification({
                idToken,
                targetUid: target.targetUid,
                notificationId: target.notificationId
              }))
            );
          } catch (err) {
            logErrorWithOptionalDebug('[push-relay-dispatch-failed]', err, {
              error: err,
              postId: postIdValue,
              commentId: createdCommentId
            });
          }
        })();
      }
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
    currentBoardAccessDebug,
    currentPost,
    currentPostCanWrite,
    currentUser,
    currentUserProfile,
    hasPotentialWriteRole,
    isAdminOrSuper,
    resolveAllMentionTargets,
    resolveMentionTargets,
    replyTarget,
    writeUserNotification
  ]);

  // Generic table editor actions for work_schedule posts.
  const addEditWorkScheduleRow = useCallback(() => {
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const columnCount = Math.max(1, source[0]?.length || 1);
      return [...source, new Array(columnCount).fill('')];
    });
  }, []);

  const addEditWorkScheduleColumn = useCallback(() => {
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      return source.map((row) => [...row, '']);
    });
  }, []);

  const updateEditWorkScheduleCell = useCallback((rowIndex, columnIndex, value) => {
    const safeRowIndex = Number(rowIndex);
    const safeColumnIndex = Number(columnIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;
    if (!Number.isFinite(safeColumnIndex) || safeColumnIndex < 0) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      if (!source[safeRowIndex]) return source;
      return source.map((row, rowIdx) => {
        if (rowIdx !== safeRowIndex) return row;
        const nextRow = [...row];
        if (safeColumnIndex >= nextRow.length) {
          while (nextRow.length <= safeColumnIndex) nextRow.push('');
        }
        nextRow[safeColumnIndex] = String(value ?? '');
        return nextRow;
      });
    });
  }, []);

  const removeEditWorkScheduleRow = useCallback((rowIndex) => {
    const safeRowIndex = Number(rowIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const next = source.filter((_, idx) => idx !== safeRowIndex);
      return normalizeEditableTableGrid(next);
    });
  }, []);

  const moveEditWorkScheduleRow = useCallback((rowIndex, direction) => {
    const safeRowIndex = Number(rowIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      if (!source[safeRowIndex]) return source;

      const maxIndex = Math.max(0, source.length - 1);
      let targetIndex = safeRowIndex;
      if (direction === 'up') targetIndex = safeRowIndex - 1;
      else if (direction === 'down') targetIndex = safeRowIndex + 1;
      else if (direction === 'up5') targetIndex = safeRowIndex - 5;
      else if (direction === 'down5') targetIndex = safeRowIndex + 5;
      else if (direction === 'top') targetIndex = 0;
      else if (direction === 'bottom') targetIndex = maxIndex;
      else return source;

      targetIndex = Math.max(0, Math.min(maxIndex, targetIndex));
      if (targetIndex === safeRowIndex) return source;

      const next = [...source];
      const [picked] = next.splice(safeRowIndex, 1);
      next.splice(targetIndex, 0, picked);
      return next;
    });
  }, []);

  const reorderEditWorkScheduleRow = useCallback((fromIndexRaw, toIndexRaw) => {
    const fromIndex = Number(fromIndexRaw);
    const toIndex = Number(toIndexRaw);
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const maxIndex = source.length - 1;
      if (maxIndex < 1) return source;

      // Keep header row(0) fixed and reorder data rows only.
      const safeFrom = Math.max(1, Math.min(maxIndex, Math.floor(fromIndex)));
      const safeTo = Math.max(1, Math.min(maxIndex, Math.floor(toIndex)));
      if (safeFrom === safeTo) return source;

      const next = [...source];
      const [picked] = next.splice(safeFrom, 1);
      next.splice(safeTo, 0, picked);
      return next;
    });
  }, []);

  const removeEditWorkScheduleColumn = useCallback((columnIndex) => {
    const safeColumnIndex = Number(columnIndex);
    if (!Number.isFinite(safeColumnIndex) || safeColumnIndex < 0) return;
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const columnCount = source[0]?.length || 1;
      if (columnCount <= 1) return source;
      const next = source.map((row) => row.filter((_, idx) => idx !== safeColumnIndex));
      return normalizeEditableTableGrid(next);
    });
  }, []);

  const openEditModal = useCallback(() => {
    if (!currentPost || !canModerateCurrentPost) return;

    setEditTitle(currentPost.title || '');
    if (normalizeText(currentPost.boardId) === WORK_SCHEDULE_BOARD_ID) {
      const storedHtml = sanitizeStoredContentHtml(currentPost.contentHtml || '');
      const parsedTable = extractEditableTableGridFromHtml(storedHtml);
      const fallbackRows = Array.isArray(currentPost?.workScheduleRows) ? currentPost.workScheduleRows : [];
      let nextTableRows = parsedTable.rows;
      // Migration fallback: old documents may have parsed rows but missing/invalid HTML table.
      if (!nextTableRows.length && fallbackRows.length) {
        nextTableRows = [
          ['날짜', '요일', '풀타임', '파트1', '파트2', '파트3', '교육'],
          ...fallbackRows.map((row) => ([
            normalizeText(row?.dateLabel || row?.dateKey),
            normalizeText(row?.weekday),
            normalizeText(row?.fullTime),
            normalizeText(row?.part1),
            normalizeText(row?.part2),
            normalizeText(row?.part3),
            normalizeText(row?.education)
          ]))
        ];
      }
      if (!nextTableRows.length) {
        // Last-resort starter table for first-time edits.
        nextTableRows = [
          ['날짜', '요일', '풀타임', '파트1', '파트2', '파트3', '교육'],
          ['', '', '', '', '', '', '']
        ];
      }
      setEditHtmlContent(storedHtml);
      setEditWorkScheduleTableRows(normalizeEditableTableGrid(nextTableRows));
    } else {
      setEditHtmlContent('');
      setEditWorkScheduleTableRows([]);
    }
    setEditMessage({ type: '', text: '' });
    setEditModalOpen(true);
  }, [canModerateCurrentPost, currentPost]);

  const submitEditPost = useCallback(async (event) => {
    event.preventDefault();
    if (!currentPost || !canModerateCurrentPost) return;

    const title = normalizeText(editTitle);
    const useTableHtmlEditor = normalizeText(currentPost.boardId) === WORK_SCHEDULE_BOARD_ID;

    let body = '';
    let rich = plainRichPayload('');
    let delta = { ops: [{ insert: '\n' }] };
    let contentHtml = '';
    let workScheduleRows = Array.isArray(currentPost?.workScheduleRows) ? currentPost.workScheduleRows : [];
    let workScheduleDateKeys = Array.isArray(currentPost?.workScheduleDateKeys) ? currentPost.workScheduleDateKeys : [];
    let workScheduleCalendarNotice = '';

    if (useTableHtmlEditor) {
      const normalizedTableRows = normalizeEditableTableGrid(editWorkScheduleTableRows);
      const hasAnyCellText = normalizedTableRows.some((row) => row.some((cell) => normalizeText(cell)));
      if (!hasAnyCellText) {
        setEditMessage({ type: 'error', text: '표가 비어 있습니다. 최소 한 칸 이상 입력해주세요.' });
        return;
      }
      // Replace only the first table in the original content HTML so narrative
      // blocks around the table are preserved.
      const mergedHtml = replaceFirstTableInHtml(editHtmlContent || currentPost.contentHtml || '', normalizedTableRows);
      contentHtml = sanitizeStoredContentHtml(mergedHtml);
      body = normalizeText(stripHtmlToText(contentHtml));
      // Calendar derives from semantic columns. If users renamed headers beyond
      // recognition, save still succeeds but we surface a clear notice.
      const parsedSchedule = extractWorkScheduleRowsFromHtml(contentHtml, title);
      workScheduleRows = parsedSchedule.rows;
      workScheduleDateKeys = parsedSchedule.rows.map((row) => row.dateKey);
      if (parsedSchedule.hasTable && !parsedSchedule.rows.length) {
        workScheduleCalendarNotice = '표는 저장됐지만 캘린더 반영용 열(날짜/풀타임/파트)이 감지되지 않았습니다.';
      }
      rich = plainRichPayload(body);
      delta = { ops: [{ insert: body ? `${body}\n` : '\n' }] };
    } else {
      rich = editEditorRef.current?.getPayload() || plainRichPayload('');
      delta = editEditorRef.current?.getDelta?.() || { ops: [{ insert: '\n' }] };
      body = normalizeText(rich.text);
      // Quill 편집 저장 시에는 기존 외부 HTML 스냅샷을 제거해 stale 렌더를 막는다.
      contentHtml = '';
    }

    if (!title || !body) {
      setEditMessage({ type: 'error', text: '제목과 본문을 모두 입력해주세요.' });
      return;
    }

    setEditSubmitting(true);
    setEditMessage({ type: '', text: '' });
    try {
      await postFirestore.updatePostDoc(currentPost.id, {
        title,
        contentDelta: delta,
        contentText: rich.text,
        contentRich: rich,
        contentHtml,
        workScheduleRows,
        workScheduleDateKeys,
        updatedAt: serverTimestamp()
      });

      setCurrentPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title,
          contentDelta: delta,
          contentText: rich.text,
          contentRich: rich,
          contentHtml,
          workScheduleRows,
          workScheduleDateKeys
        };
      });

      setMessage({
        type: 'notice',
        text: workScheduleCalendarNotice
          ? `게시글을 수정했습니다. ${workScheduleCalendarNotice}`
          : '게시글을 수정했습니다.'
      });
      setEditModalOpen(false);
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
          'action=post-update',
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
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[post-update-permission-debug]', err, {
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
          boardAccess: currentBoardAccessDebug,
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          debugText
        });
        setEditMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 수정 실패') });
        return;
      }
      setEditMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 수정 실패') });
    } finally {
      setEditSubmitting(false);
    }
  }, [
    canModerateCurrentPost,
    currentBoardAccessDebug,
    currentPost,
    currentUser,
    currentUserProfile,
    editHtmlContent,
    editWorkScheduleTableRows,
    editTitle,
    permissions
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
    backHref,
    canModerateCurrentPost,
    currentBoardAccessDebug,
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

  const deleteComment = useCallback(async (commentIdRaw) => {
    const targetCommentId = normalizeText(commentIdRaw);
    if (!targetCommentId || !currentPost) return;
    if (!window.confirm('댓글을 삭제할까요?')) return;

    try {
      await postFirestore.deleteCommentDoc(currentPost.id, targetCommentId);
      if (replyTarget && replyTarget.id === targetCommentId) {
        setReplyTarget(null);
      }
    } catch (err) {
      setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 삭제 실패') });
    }
  }, [currentPost, replyTarget]);

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
    currentBoardAccessDebug,
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
      userRoleLabel,
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
    excelCommentRows,
    isCoverForPost,
    postMetaLine,
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


  return {
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
    isWorkSchedulePost,
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
  };
}
