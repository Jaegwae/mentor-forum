// Post detail page with comment creation/editing and moderation actions.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, FileText, LogOut, MessageSquare, ShieldCheck, Users2 } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
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
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { buildPermissions, getRoleBadgePalette } from '../legacy/rbac.js';
import { createRichEditor, renderRichDeltaToHtml, renderRichPayloadToHtml } from '../legacy/rich-editor.js';
import { pushRelayConfigured, sendPushRelayNotification } from '../legacy/push-relay.js';
import { RichEditorToolbar } from '../components/editor/RichEditorToolbar.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildPostDetailExcelSheetModel
} from '../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../hooks/useTheme.js';

const NOTICE_BOARD_ID = MENTOR_FORUM_CONFIG.app.noticeBoardId || 'Notice';
const ALL_BOARD_ID = '__all__';
const COVER_FOR_BOARD_ID = 'cover_for';
const COVER_FOR_STATUS = {
  SEEKING: 'seeking',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};
const COVER_FOR_DEFAULT_START_TIME = '09:00';
const COVER_FOR_DEFAULT_END_TIME = '18:00';
const DEFAULT_COVER_FOR_VENUE_OPTIONS = ['구로', '경기도서관'];
const COVER_FOR_DEFAULT_VENUE = DEFAULT_COVER_FOR_VENUE_OPTIONS[0];
const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
const LAST_BOARD_STORAGE_KEY = 'mentor_forum_last_board_id';
const NOTIFICATION_TYPE = {
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
const NOTIFICATION_SUBTYPE = {
  POST_COMMENT: 'post_comment',
  REPLY_COMMENT: 'reply_comment',
  MENTION: 'mention',
  MENTION_ALL: 'mention_all'
};
const MENTION_ALL_TOKEN = 'ALL';
const MENTION_MAX_ITEMS = 8;
const MENTION_MENU_ESTIMATED_WIDTH = 248;
const MENTION_MENU_INITIAL = {
  open: false,
  query: '',
  start: -1,
  end: -1,
  anchorLeft: 8,
  anchorTop: 8
};

const CORE_ROLE_LEVELS = {
  Super_Admin: 100,
  Admin: 80,
  Staff: 60,
  Mentor: 40,
  Newbie: 10
};

const ROLE_KEY_ALIASES = {
  '개발자': 'Super_Admin',
  '관리자': 'Admin',
  '멘토': 'Mentor',
  '새싹': 'Newbie',
  '토': 'Mentor',
  '운영진': 'Staff'
};

const FALLBACK_ROLE_DEFINITIONS = [
  { role: 'Newbie', labelKo: '새싹', level: 10, badgeBgColor: '#ffffff', badgeTextColor: '#334155' },
  { role: 'Mentor', labelKo: '멘토', level: 40, badgeBgColor: '#dcfce7', badgeTextColor: '#166534' },
  { role: 'Staff', labelKo: '운영진', level: 60, badgeBgColor: '#fde68a', badgeTextColor: '#92400e' },
  { role: 'Admin', labelKo: '관리자', level: 80, badgeBgColor: '#dbeafe', badgeTextColor: '#1d4ed8' },
  { role: 'Super_Admin', labelKo: '개발자', level: 100, badgeBgColor: '#f3e8ff', badgeTextColor: '#7e22ce' }
];

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

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

function stripHtmlToText(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\s+/g, ' ')
    .trim();
  return text;
}

function isTruthyLegacyValue(value) {
  if (value === true || value === 1) return true;
  const text = normalizeText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'y' || text === 'yes';
}

function isDeletedPost(post) {
  return !!post && isTruthyLegacyValue(post.deleted);
}

function normalizeErrMessage(err, fallback) {
  const code = err && err.code ? String(err.code) : '';
  if (code.includes('permission-denied')) {
    return '권한 오류입니다. 현재 등급에서 허용되지 않은 작업입니다.';
  }
  return (err && err.message) ? err.message : fallback;
}

function isPermissionDeniedError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.includes('permission-denied');
}

function shouldLogDebugPayload() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return window.__MENTOR_DEBUG__ === true;
}

function logErrorWithOptionalDebug(tag, error, debugPayload) {
  if (shouldLogDebugPayload() && debugPayload) {
    console.error(tag, debugPayload);
    return;
  }
  console.error(tag, error);
}

function debugValueList(values) {
  if (!Array.isArray(values)) return '-';
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length ? normalized.join(',') : '-';
}

function debugCodePoints(value) {
  const raw = String(value ?? '');
  if (!raw) return '-';
  return Array.from(raw)
    .map((char) => `U+${(char.codePointAt(0) || 0).toString(16).toUpperCase()}`)
    .join(',');
}

function joinDebugParts(parts) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' | ');
}

function boardAccessDebugText(boardAccess, profile) {
  return joinDebugParts([
    `boardId=${normalizeText(boardAccess?.boardId) || '-'}`,
    `boardName=${normalizeText(boardAccess?.boardName) || '-'}`,
    `boardExists=${boardAccess?.boardExists ? 'Y' : 'N'}`,
    `isDivider=${boardAccess?.isDivider ? 'Y' : 'N'}`,
    `allowedRoles=${debugValueList(boardAccess?.allowedRoles)}`,
    `boardCanRead=${boardAccess?.allowed ? 'Y' : 'N'}`,
    `boardCanWrite=${boardAccess?.canWrite ? 'Y' : 'N'}`,
    `myRole=${normalizeText(profile?.role) || '-'}`,
    `myRawRole=${normalizeText(profile?.rawRole || profile?.role) || '-'}`
  ]);
}

function readLastBoardId() {
  try {
    const value = normalizeText(window.sessionStorage.getItem(LAST_BOARD_STORAGE_KEY));
    return value === ALL_BOARD_ID ? '' : value;
  } catch (_) {
    return '';
  }
}

function writeLastBoardId(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized || normalized === ALL_BOARD_ID) return;
  try {
    window.sessionStorage.setItem(LAST_BOARD_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage failure.
  }
}

function isCoverForBoardId(boardId) {
  return normalizeText(boardId) === COVER_FOR_BOARD_ID;
}

function toDateKey(value) {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

function formatDateKeyLabel(key) {
  const date = fromDateKey(key);
  if (!date) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}. ${m}. ${d}.`;
}

function normalizeDateKeyInput(value) {
  const key = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const parsed = fromDateKey(key);
  if (!parsed) return '';
  return toDateKey(parsed);
}

function notificationDocRef(uid, notificationId) {
  return doc(db, 'users', normalizeText(uid), 'notifications', normalizeText(notificationId));
}

function viewedPostDocRef(uid, postId) {
  return doc(db, 'users', normalizeText(uid), 'viewed_posts', normalizeText(postId));
}

function normalizeNotificationType(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === NOTIFICATION_TYPE.COMMENT) return NOTIFICATION_TYPE.COMMENT;
  if (type === NOTIFICATION_TYPE.MENTION) return NOTIFICATION_TYPE.MENTION;
  return NOTIFICATION_TYPE.POST;
}

function normalizeNickname(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

function extractMentionNicknames(text) {
  const source = String(text || '');
  const regex = /(^|\s)@([^\s@]{1,20})/g;
  const unique = new Set();
  let match = regex.exec(source);
  while (match) {
    const nickname = normalizeNickname(match[2]);
    if (nickname) unique.add(nickname);
    match = regex.exec(source);
  }
  return [...unique];
}

function hasAllMentionCommand(text) {
  const source = String(text || '');
  return /(^|\s)@all(?=\s|$)/i.test(source);
}

function detectMentionContext(text, cursorIndex) {
  const source = String(text || '');
  const safeCursor = Math.max(0, Math.min(source.length, Math.floor(Number(cursorIndex) || 0)));
  const head = source.slice(0, safeCursor);
  const match = head.match(/(?:^|\s)@([^\s@]{0,20})$/);
  if (!match) return null;
  const token = String(match[0] || '');
  const mentionStart = safeCursor - token.length + (token.startsWith('@') ? 0 : 1);
  return {
    start: mentionStart,
    end: safeCursor,
    query: normalizeNickname(match[1] || '')
  };
}

function notificationIdForEvent(type, postId, commentId, targetUid) {
  const safeType = normalizeText(type) || 'event';
  const safePostId = normalizeText(postId) || 'post';
  const safeCommentId = normalizeText(commentId) || 'root';
  const safeTargetUid = normalizeText(targetUid) || 'target';
  return [safeType, safePostId, safeCommentId, safeTargetUid]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function toNotificationBodySnippet(text, maxLength = 110) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeCoverForVenue(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

function normalizeTimeInput(value) {
  const text = normalizeText(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return '';
  return text;
}

function timeValueToMinutes(value) {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return -1;
  const [hourText, minuteText] = normalized.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return (hour * 60) + minute;
}

function isValidTimeRange(startTimeValue, endTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  const endMinutes = timeValueToMinutes(endTimeValue);
  return startMinutes >= 0 && endMinutes > startMinutes;
}

function suggestEndTime(startTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  if (startMinutes < 0) return COVER_FOR_DEFAULT_END_TIME;
  const nextMinutes = startMinutes + 30;
  if (nextMinutes >= 24 * 60) return '23:59';
  const hour = String(Math.floor(nextMinutes / 60)).padStart(2, '0');
  const minute = String(nextMinutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function normalizeCoverForStatus(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === COVER_FOR_STATUS.COMPLETED) return COVER_FOR_STATUS.COMPLETED;
  if (raw === COVER_FOR_STATUS.CANCELLED) return COVER_FOR_STATUS.CANCELLED;
  return COVER_FOR_STATUS.SEEKING;
}

function coverForStatusLabel(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  if (status === COVER_FOR_STATUS.COMPLETED) return '완료';
  if (status === COVER_FOR_STATUS.CANCELLED) return '취소';
  return '구하는 중';
}

function isClosedCoverForStatus(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  return status === COVER_FOR_STATUS.COMPLETED || status === COVER_FOR_STATUS.CANCELLED;
}

function normalizeCoverForDateKeys(values, fallbackKey = '') {
  const source = Array.isArray(values) ? values : [];
  const normalized = source
    .map((value) => normalizeDateKeyInput(value))
    .filter(Boolean)
    .slice(0, 6);

  if (!normalized.length) {
    const fallback = normalizeDateKeyInput(fallbackKey);
    if (fallback) normalized.push(fallback);
  }

  return normalized;
}

function normalizeCoverForDateStatuses(values, size, fallbackStatus = COVER_FOR_STATUS.SEEKING) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForStatus(list[idx] != null ? list[idx] : fallbackStatus));
  }
  return result;
}

function normalizeCoverForTimeValues(values, size, fallbackTime = COVER_FOR_DEFAULT_START_TIME) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeTimeInput(fallbackTime) || COVER_FOR_DEFAULT_START_TIME;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeTimeInput(list[idx]) || fallback);
  }
  return result;
}

function normalizeCoverForVenueValues(values, size, fallbackVenue = COVER_FOR_DEFAULT_VENUE) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeCoverForVenue(fallbackVenue) || COVER_FOR_DEFAULT_VENUE;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForVenue(list[idx]) || fallback);
  }
  return result;
}

function coverForDateEntriesFromPost(post) {
  const fallbackDateKey = toDateKey(post?.createdAt);
  const keys = normalizeCoverForDateKeys(post?.coverForDateKeys, fallbackDateKey);
  if (!keys.length) return [];

  const fallbackStatus = normalizeCoverForStatus(post?.coverForStatus);
  const statuses = normalizeCoverForDateStatuses(post?.coverForDateStatuses, keys.length, fallbackStatus);
  const legacyTimes = normalizeCoverForTimeValues(
    post?.coverForTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_START_TIME
  );
  const startTimes = normalizeCoverForTimeValues(
    post?.coverForStartTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_START_TIME
  );
  const endTimes = normalizeCoverForTimeValues(
    post?.coverForEndTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_END_TIME
  );
  const venues = normalizeCoverForVenueValues(
    post?.coverForVenueValues,
    keys.length,
    normalizeCoverForVenue(post?.coverForVenue) || COVER_FOR_DEFAULT_VENUE
  );
  return keys.map((dateKey, idx) => ({
    startTimeValue: normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME,
    endTimeValue: isValidTimeRange(
      normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME,
      normalizeTimeInput(endTimes[idx]) || COVER_FOR_DEFAULT_END_TIME
    )
      ? (normalizeTimeInput(endTimes[idx]) || COVER_FOR_DEFAULT_END_TIME)
      : suggestEndTime(normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME),
    dateKey,
    status: statuses[idx] || COVER_FOR_STATUS.SEEKING,
    venue: normalizeCoverForVenue(venues[idx]) || COVER_FOR_DEFAULT_VENUE
  }));
}

function summarizeCoverForDateEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    return {
      statusClass: COVER_FOR_STATUS.SEEKING,
      label: coverForStatusLabel(COVER_FOR_STATUS.SEEKING),
      isClosed: false
    };
  }

  const hasSeeking = list.some((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.SEEKING);
  if (hasSeeking) {
    return {
      statusClass: COVER_FOR_STATUS.SEEKING,
      label: coverForStatusLabel(COVER_FOR_STATUS.SEEKING),
      isClosed: false
    };
  }

  const allCompleted = list.every((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.COMPLETED);
  if (allCompleted) {
    return {
      statusClass: COVER_FOR_STATUS.COMPLETED,
      label: coverForStatusLabel(COVER_FOR_STATUS.COMPLETED),
      isClosed: true
    };
  }

  const allCancelled = list.every((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.CANCELLED);
  if (allCancelled) {
    return {
      statusClass: COVER_FOR_STATUS.CANCELLED,
      label: coverForStatusLabel(COVER_FOR_STATUS.CANCELLED),
      isClosed: true
    };
  }

  return {
    statusClass: 'closed',
    label: '완료/취소',
    isClosed: true
  };
}

function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function commentAuthorName(comment) {
  return comment.authorName || comment.authorUid || '사용자';
}

function plainRichPayload(text) {
  const safe = String(text || '');
  return {
    text: safe,
    runs: safe ? [{
      start: 0,
      end: safe.length,
      style: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        color: '#0f172a',
        fontSize: 16,
        link: ''
      }
    }] : []
  };
}

function renderStoredContentHtml(source) {
  const deltaHtml = renderRichDeltaToHtml(source?.contentDelta || null);
  if (deltaHtml) return deltaHtml;
  return renderRichPayloadToHtml(source?.contentRich || plainRichPayload(source?.contentText || ''));
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
  if (Object.prototype.hasOwnProperty.call(CORE_ROLE_LEVELS, key)) return key;
  if (roleDefMap.has(key)) return key;
  return MENTOR_FORUM_CONFIG.app.defaultRole;
}

function isExplicitNewbieRole(rawRole) {
  const raw = normalizeText(rawRole);
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return raw === 'Newbie' || lower === 'newbie' || raw === '새싹';
}

function roleMatchCandidates(roleKey, roleDefMap = null) {
  const rawKey = normalizeText(roleKey);
  if (!rawKey) return [];

  const normalizedKey = roleDefMap && typeof roleDefMap.has === 'function'
    ? normalizeRoleKey(rawKey, roleDefMap)
    : rawKey;
  const seeds = normalizedKey && normalizedKey !== rawKey
    ? [rawKey, normalizedKey]
    : [rawKey];

  const candidates = [];
  seeds.forEach((key) => {
    if (key === 'Super_Admin') {
      candidates.push('Super_Admin', 'super_admin', '개발자');
      return;
    }
    if (key === 'Admin') {
      candidates.push('Admin', 'admin', '관리자');
      return;
    }
    if (key === 'Mentor') {
      candidates.push('Mentor', 'mentor', '멘토', '토');
      return;
    }
    if (key === 'Staff') {
      candidates.push('Staff', 'staff', '운영진');
      return;
    }
    if (key === 'Newbie') {
      candidates.push('Newbie', 'newbie', '새싹');
      return;
    }

    const roleDef = roleDefMap && typeof roleDefMap.get === 'function'
      ? roleDefMap.get(key)
      : null;
    const labelKo = normalizeText(roleDef?.labelKo);
    const lower = key.toLowerCase();
    candidates.push(key);
    if (lower && lower !== key) candidates.push(lower);
    if (labelKo) candidates.push(labelKo);
  });

  return [...new Set(candidates.filter(Boolean))];
}

function isPrivilegedBoardRole(roleKey) {
  const role = normalizeText(roleKey);
  return role === 'Super_Admin' || role === 'Admin';
}

function isNoticeBoardData(boardId, boardData) {
  const id = normalizeText(boardId || boardData?.id);
  const name = normalizeText(boardData?.name);
  return id === NOTICE_BOARD_ID || name === '공지사항';
}

function sortCommentsForDisplay(comments) {
  const list = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ ...comment, id: normalizeText(comment.id) }))
    .filter((comment) => !!comment.id);

  const byId = new Map(list.map((comment) => [comment.id, comment]));
  const childrenByParent = new Map();
  const roots = [];

  list.forEach((comment) => {
    const parentId = normalizeText(comment.parentId);
    if (!parentId || parentId === comment.id || !byId.has(parentId)) {
      roots.push(comment);
      return;
    }

    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(comment);
  });

  const byCreatedAt = (a, b) => {
    const diff = toMillis(a.createdAt) - toMillis(b.createdAt);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  };

  roots.sort(byCreatedAt);
  childrenByParent.forEach((items) => items.sort(byCreatedAt));

  const visited = new Set();
  const ordered = [];

  const visit = (comment, depth, parentComment = null) => {
    if (!comment || visited.has(comment.id)) return;
    visited.add(comment.id);

    const normalizedDepth = Math.max(0, depth);
    const row = {
      ...comment,
      _threadDepth: normalizedDepth
    };

    if (normalizedDepth > 0 && !row.replyToAuthorName && parentComment) {
      row.replyToAuthorName = commentAuthorName(parentComment);
    }

    ordered.push(row);

    const children = childrenByParent.get(comment.id) || [];
    children.forEach((child) => visit(child, normalizedDepth + 1, comment));
  };

  roots.forEach((root) => visit(root, 0, null));
  list
    .filter((comment) => !visited.has(comment.id))
    .sort(byCreatedAt)
    .forEach((comment) => visit(comment, 0, null));

  return ordered;
}

async function loadRoleDefinitions() {
  const snap = await getDocs(collection(db, 'role_definitions'));
  const definitions = snap.docs.map((d) => ({ role: d.id, ...d.data() }));
  const mergedByRole = new Map();

  FALLBACK_ROLE_DEFINITIONS.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  definitions.forEach((item) => {
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
    const rawRoleExact = String(profile.role ?? '');
    const rawRole = normalizeText(rawRoleExact);
    const normalizedRole = normalizeRoleKey(rawRole, roleDefMap);
    const shouldNormalizeRole = !!normalizedRole && rawRoleExact !== normalizedRole;
    const shouldSetVerified = !!user.emailVerified && !profile.emailVerified;
    if (shouldNormalizeRole || shouldSetVerified) {
      const patch = { updatedAt: serverTimestamp() };
      if (shouldNormalizeRole) patch.role = normalizedRole;
      if (shouldSetVerified) patch.emailVerified = true;
      await updateDoc(ref, patch);
      return {
        ...profile,
        ...(shouldSetVerified ? { emailVerified: true } : {}),
        role: normalizedRole,
        rawRole: normalizedRole
      };
    }
    return { ...profile, role: normalizedRole, rawRole };
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
  return {
    ...profile,
    role: normalizeRoleKey(profile.role, roleDefMap),
    rawRole: normalizeText(profile.role)
  };
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

export default function PostPage() {
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

  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);

  const [currentPost, setCurrentPost] = useState(null);
  const [currentPostCanWrite, setCurrentPostCanWrite] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

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
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editMessage, setEditMessage] = useState({ type: '', text: '' });
  const [sessionRemainingMs, setSessionRemainingMs] = useState(null);
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

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
  const isCoverForPost = !!currentPost && isCoverForBoardId(currentPost.boardId);
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
    const baseCollection = collection(db, 'nickname_index');

    const mentionQuery = keyPrefix
      ? query(
        baseCollection,
        where('nicknameKey', '>=', keyPrefix),
        where('nicknameKey', '<=', `${keyPrefix}\uf8ff`),
        limit(MENTION_MAX_ITEMS)
      )
      : query(baseCollection, limit(MENTION_MAX_ITEMS));

    const snap = await getDocs(mentionQuery);
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
    if (!editModalOpen || !editEditorElRef.current || !editFontSizeLabelRef.current) {
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
  }, [closeMentionMenu, currentPost, editModalOpen, syncMentionMenu]);

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
    if (!boardData || !currentUserProfile) return false;

    const roleKey = normalizeRoleKey(currentUserProfile.role, roleDefMap);
    const rawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);
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

    const roleKey = normalizeRoleKey(currentUserProfile.role, roleDefMap);
    const rawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);

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
      const snap = await getDoc(doc(db, 'boards', boardId));
      if (!snap.exists()) {
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
    const commentsQuery = query(
      collection(db, 'posts', currentPost.id, 'comments'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(commentsQuery, (snap) => {
      const ordered = sortCommentsForDisplay(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      );
      setComments(ordered);
      setCommentsLoading(false);
    }, (err) => {
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
      snap = await getDoc(doc(db, 'posts', postId));
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
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'posts', loadedPost.id);
        const postSnap = await tx.get(ref);
        if (!postSnap.exists()) return;
        const data = postSnap.data() || {};
        const nextViews = numberOrZero(data.views) + 1;
        tx.update(ref, { views: nextViews });
      });
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
    setDoc(viewedPostDocRef(uid, currentPostId), {
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
        const snap = await getDoc(doc(db, 'nickname_index', key));
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
    const usersSnap = await getDocs(collection(db, 'users'));
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

    await setDoc(notificationDocRef(userUid, notificationId), {
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
      const createdRef = await addDoc(collection(db, 'posts', currentPost.id, 'comments'), {
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

  const openEditModal = useCallback(() => {
    if (!currentPost || !canModerateCurrentPost) return;

    setEditTitle(currentPost.title || '');
    setEditMessage({ type: '', text: '' });
    setEditModalOpen(true);
  }, [canModerateCurrentPost, currentPost]);

  const submitEditPost = useCallback(async (event) => {
    event.preventDefault();
    if (!currentPost || !canModerateCurrentPost) return;

    const title = normalizeText(editTitle);
    const rich = editEditorRef.current?.getPayload() || plainRichPayload('');
    const delta = editEditorRef.current?.getDelta?.() || { ops: [{ insert: '\n' }] };
    const body = normalizeText(rich.text);
    if (!title || !body) {
      setEditMessage({ type: 'error', text: '제목과 본문을 모두 입력해주세요.' });
      return;
    }

    setEditSubmitting(true);
    setEditMessage({ type: '', text: '' });
    try {
      await updateDoc(doc(db, 'posts', currentPost.id), {
        title,
        contentDelta: delta,
        contentText: rich.text,
        contentRich: rich,
        updatedAt: serverTimestamp()
      });

      setCurrentPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title,
          contentDelta: delta,
          contentText: rich.text,
          contentRich: rich
        };
      });

      setMessage({ type: 'notice', text: '게시글을 수정했습니다.' });
      setEditModalOpen(false);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestPostDocExists = false;
        let latestPostAuthorUid = '';
        let latestPostAuthorId = '';
        let latestPostUid = '';
        let latestPostCreatedByUid = '';
        try {
          const latestPostSnap = await getDoc(doc(db, 'posts', currentPost.id));
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
          `runtimeProjectId=${normalizeText(db?.app?.options?.projectId) || '-'}`,
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
          runtimeProjectId: normalizeText(db?.app?.options?.projectId),
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
    editTitle,
    permissions
  ]);

  const deletePost = useCallback(async () => {
    if (!currentPost || !canModerateCurrentPost) return;
    if (!window.confirm('게시글을 삭제할까요?')) return;

    try {
      await deleteDoc(doc(db, 'posts', currentPost.id));
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

  const updateCoverForDateStatus = useCallback(async (targetIndexRaw, nextStatusRaw) => {
    if (!currentPost || !canChangeCoverStatus) return;
    if (!isCoverForBoardId(currentPost.boardId)) return;

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
      await updateDoc(doc(db, 'posts', currentPost.id), {
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
          const latestPostSnap = await getDoc(doc(db, 'posts', currentPost.id));
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
          `runtimeProjectId=${normalizeText(db?.app?.options?.projectId) || '-'}`,
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
          runtimeProjectId: normalizeText(db?.app?.options?.projectId),
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
      if (!targetCommentId || !currentPost) return;
      if (!window.confirm('댓글을 삭제할까요?')) return;
      deleteDoc(doc(db, 'posts', currentPost.id, 'comments', targetCommentId))
        .then(() => {
          if (replyTarget && replyTarget.id === targetCommentId) {
            setReplyTarget(null);
          }
        })
        .catch((err) => {
          setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 삭제 실패') });
        });
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
    currentPost,
    deletePost,
    handleBackToList,
    location.search,
    location.state,
    navigate,
    openEditModal,
    replyTarget,
    updateCoverForDateStatus
  ]);

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
              멘토포럼
            </h1>
            <p className="hero-copy">멘토스끼리 자유롭게 소통 가능한 커뮤니티입니다!</p>
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
                        onClick={async () => {
                          if (!currentPost) return;
                          if (!window.confirm('댓글을 삭제할까요?')) return;

                          try {
                            await deleteDoc(doc(db, 'posts', currentPost.id, 'comments', comment.id));
                            if (replyTarget && replyTarget.id === comment.id) {
                              setReplyTarget(null);
                            }
                          } catch (err) {
                            setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 삭제 실패') });
                          }
                        }}
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
