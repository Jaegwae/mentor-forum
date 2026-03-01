// PostPage pure helpers and formatting utilities.
// Keep this file React-free so mention parsing, role normalization, and content
// rendering helpers can be reasoned about and reused safely.
import { db, doc } from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { renderRichDeltaToHtml, renderRichPayloadToHtml } from '../../legacy/rich-editor.js';
import {
  ALL_BOARD_ID,
  COVER_FOR_BOARD_ID,
  COVER_FOR_DEFAULT_END_TIME,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_VENUE,
  COVER_FOR_STATUS,
  CORE_ROLE_LEVELS,
  LAST_BOARD_STORAGE_KEY,
  NOTICE_BOARD_ID,
  NOTIFICATION_TYPE,
  ROLE_KEY_ALIASES
} from './constants.js';

export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeText(value) {
  return String(value || '').trim();
}

export function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const viewportWide = window.matchMedia('(min-width: 901px)').matches;
  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ''));

  const desktopLike = viewportWide && hoverFine && pointerFine && !mobileUa;
  return !desktopLike;
}

export function stripHtmlToText(value) {
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

export function isTruthyLegacyValue(value) {
  if (value === true || value === 1) return true;
  const text = normalizeText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'y' || text === 'yes';
}

export function isDeletedPost(post) {
  return !!post && isTruthyLegacyValue(post.deleted);
}

export function normalizeErrMessage(err, fallback) {
  const code = err && err.code ? String(err.code) : '';
  if (code.includes('permission-denied')) {
    return '권한 오류입니다. 현재 등급에서 허용되지 않은 작업입니다.';
  }
  return (err && err.message) ? err.message : fallback;
}

export function isPermissionDeniedError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.includes('permission-denied');
}

export function shouldLogDebugPayload() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return window.__MENTOR_DEBUG__ === true;
}

export function logErrorWithOptionalDebug(tag, error, debugPayload) {
  if (shouldLogDebugPayload() && debugPayload) {
    console.error(tag, debugPayload);
    return;
  }
  console.error(tag, error);
}

export function debugValueList(values) {
  if (!Array.isArray(values)) return '-';
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length ? normalized.join(',') : '-';
}

export function debugCodePoints(value) {
  const raw = String(value ?? '');
  if (!raw) return '-';
  return Array.from(raw)
    .map((char) => `U+${(char.codePointAt(0) || 0).toString(16).toUpperCase()}`)
    .join(',');
}

export function joinDebugParts(parts) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' | ');
}

export function boardAccessDebugText(boardAccess, profile) {
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

export function readLastBoardId() {
  try {
    const value = normalizeText(window.sessionStorage.getItem(LAST_BOARD_STORAGE_KEY));
    return value === ALL_BOARD_ID ? '' : value;
  } catch (_) {
    return '';
  }
}

export function writeLastBoardId(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized || normalized === ALL_BOARD_ID) return;
  try {
    window.sessionStorage.setItem(LAST_BOARD_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage failure.
  }
}

export function isCoverForBoardId(boardId) {
  return normalizeText(boardId) === COVER_FOR_BOARD_ID;
}

export function toDateKey(value) {
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

export function fromDateKey(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

export function formatDateKeyLabel(key) {
  const date = fromDateKey(key);
  if (!date) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}. ${m}. ${d}.`;
}

export function normalizeDateKeyInput(value) {
  const key = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const parsed = fromDateKey(key);
  if (!parsed) return '';
  return toDateKey(parsed);
}

export function notificationDocRef(uid, notificationId) {
  return doc(db, 'users', normalizeText(uid), 'notifications', normalizeText(notificationId));
}

export function viewedPostDocRef(uid, postId) {
  return doc(db, 'users', normalizeText(uid), 'viewed_posts', normalizeText(postId));
}

export function normalizeNotificationType(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === NOTIFICATION_TYPE.COMMENT) return NOTIFICATION_TYPE.COMMENT;
  if (type === NOTIFICATION_TYPE.MENTION) return NOTIFICATION_TYPE.MENTION;
  return NOTIFICATION_TYPE.POST;
}

export function normalizeNickname(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

export function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

export function extractMentionNicknames(text) {
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

export function hasAllMentionCommand(text) {
  const source = String(text || '');
  return /(^|\s)@all(?=\s|$)/i.test(source);
}

export function detectMentionContext(text, cursorIndex) {
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

export function notificationIdForEvent(type, postId, commentId, targetUid) {
  const safeType = normalizeText(type) || 'event';
  const safePostId = normalizeText(postId) || 'post';
  const safeCommentId = normalizeText(commentId) || 'root';
  const safeTargetUid = normalizeText(targetUid) || 'target';
  return [safeType, safePostId, safeCommentId, safeTargetUid]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

export function toNotificationBodySnippet(text, maxLength = 110) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function normalizeCoverForVenue(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

export function normalizeTimeInput(value) {
  const text = normalizeText(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return '';
  return text;
}

export function timeValueToMinutes(value) {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return -1;
  const [hourText, minuteText] = normalized.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return (hour * 60) + minute;
}

export function isValidTimeRange(startTimeValue, endTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  const endMinutes = timeValueToMinutes(endTimeValue);
  return startMinutes >= 0 && endMinutes > startMinutes;
}

export function suggestEndTime(startTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  if (startMinutes < 0) return COVER_FOR_DEFAULT_END_TIME;
  const nextMinutes = startMinutes + 30;
  if (nextMinutes >= 24 * 60) return '23:59';
  const hour = String(Math.floor(nextMinutes / 60)).padStart(2, '0');
  const minute = String(nextMinutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function normalizeCoverForStatus(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === COVER_FOR_STATUS.COMPLETED) return COVER_FOR_STATUS.COMPLETED;
  if (raw === COVER_FOR_STATUS.CANCELLED) return COVER_FOR_STATUS.CANCELLED;
  return COVER_FOR_STATUS.SEEKING;
}

export function coverForStatusLabel(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  if (status === COVER_FOR_STATUS.COMPLETED) return '완료';
  if (status === COVER_FOR_STATUS.CANCELLED) return '취소';
  return '구하는 중';
}

export function isClosedCoverForStatus(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  return status === COVER_FOR_STATUS.COMPLETED || status === COVER_FOR_STATUS.CANCELLED;
}

export function normalizeCoverForDateKeys(values, fallbackKey = '') {
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

export function normalizeCoverForDateStatuses(values, size, fallbackStatus = COVER_FOR_STATUS.SEEKING) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForStatus(list[idx] != null ? list[idx] : fallbackStatus));
  }
  return result;
}

export function normalizeCoverForTimeValues(values, size, fallbackTime = COVER_FOR_DEFAULT_START_TIME) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeTimeInput(fallbackTime) || COVER_FOR_DEFAULT_START_TIME;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeTimeInput(list[idx]) || fallback);
  }
  return result;
}

export function normalizeCoverForVenueValues(values, size, fallbackVenue = COVER_FOR_DEFAULT_VENUE) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeCoverForVenue(fallbackVenue) || COVER_FOR_DEFAULT_VENUE;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForVenue(list[idx]) || fallback);
  }
  return result;
}

export function coverForDateEntriesFromPost(post) {
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

export function summarizeCoverForDateEntries(entries) {
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

export function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function commentAuthorName(comment) {
  return comment.authorName || comment.authorUid || '사용자';
}

export function plainRichPayload(text) {
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

export function renderStoredContentHtml(source) {
  const deltaHtml = renderRichDeltaToHtml(source?.contentDelta || null);
  if (deltaHtml) return deltaHtml;
  return renderRichPayloadToHtml(source?.contentRich || plainRichPayload(source?.contentText || ''));
}

export function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  roleDefinitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

export function normalizeRoleKey(roleKey, roleDefMap) {
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

export function isExplicitNewbieRole(rawRole) {
  const raw = normalizeText(rawRole);
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return raw === 'Newbie' || lower === 'newbie' || raw === '새싹';
}

export function roleMatchCandidates(roleKey, roleDefMap = null) {
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

export function isPrivilegedBoardRole(roleKey) {
  const role = normalizeText(roleKey);
  return role === 'Super_Admin' || role === 'Admin';
}

export function isNoticeBoardData(boardId, boardData) {
  const id = normalizeText(boardId || boardData?.id);
  const name = normalizeText(boardData?.name);
  return id === NOTICE_BOARD_ID || name === '공지사항';
}

export function sortCommentsForDisplay(comments) {
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
