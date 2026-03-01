// AppPage pure helpers.
// This module must stay framework-agnostic for easier testing and safe refactors.
// Firestore refs are exposed here only as small path helpers used by the controller.
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { getRoleBadgePalette } from '../../legacy/rbac.js';
import { db, collection, doc } from '../../legacy/firebase-app.js';
import {
  ALL_BOARD_ID,
  NOTICE_BOARD_ID,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  WORK_SCHEDULE_WRITE_ROLES,
  COVER_FOR_STATUS,
  COVER_FOR_MAX_DATES,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  DEFAULT_COVER_FOR_VENUE_OPTIONS,
  COVER_FOR_DEFAULT_VENUE,
  LAST_BOARD_STORAGE_KEY,
  RECENT_COMMENT_PREVIEW_LIMIT,
  POST_LIST_VIEW_MODE,
  NOTIFICATION_TYPE,
  NOTIFICATION_SUBTYPE,
  MOBILE_PUSH_PREF_KEY,
  NOTIFICATION_FEED_FILTER,
  CORE_ROLE_LEVELS,
  ROLE_KEY_ALIASES
} from './constants.js';

export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeBoardIdentity(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

export function boardIdentityCandidates(boardId, boardName = '') {
  const id = normalizeText(boardId);
  const name = normalizeText(boardName);
  const candidates = [
    id,
    id.toLowerCase(),
    id.toUpperCase(),
    id.replace(/_/g, '-'),
    id.replace(/-/g, '_'),
    id.replace(/_/g, ' '),
    normalizeBoardIdentity(id)
  ].filter(Boolean);

  if (name) {
    candidates.push(name, name.toLowerCase(), normalizeBoardIdentity(name));
  }

  return [...new Set(candidates.map((item) => normalizeText(item)).filter(Boolean))];
}

export function postBoardIdentityCandidates(post) {
  const candidates = [
    post?.boardId,
    post?.board,
    post?.boardKey,
    post?.board_id,
    post?.boardName
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const normalized = candidates
    .map((item) => normalizeBoardIdentity(item))
    .filter(Boolean);

  return [...new Set([...candidates, ...normalized])];
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

export function boardPermissionDebugText(board, profile) {
  return joinDebugParts([
    `boardId=${normalizeText(board?.id) || '-'}`,
    `boardName=${normalizeText(board?.name) || '-'}`,
    `allowedRoles=${debugValueList(board?.allowedRoles)}`,
    `boardIsDivider=${board?.isDivider === true ? 'true' : 'false'}`,
    `myRole=${normalizeText(profile?.role) || '-'}`,
    `myRawRole=${normalizeText(profile?.rawRole || profile?.role) || '-'}`
  ]);
}

export function readRememberedBoardId() {
  try {
    const value = normalizeText(window.sessionStorage.getItem(LAST_BOARD_STORAGE_KEY));
    if (!value || value === ALL_BOARD_ID) return '';
    return value;
  } catch (_) {
    return '';
  }
}

export function writeRememberedBoardId(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized || normalized === ALL_BOARD_ID) return;
  try {
    window.sessionStorage.setItem(LAST_BOARD_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage failure.
  }
}

export function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

export function formatPostListDate(value) {
  if (!value) return '-';
  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';

  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}. ${m}. ${d}. ${hh}:${mm}`;
}

export function formatPostListDateMobile(value) {
  if (!value) return '-';
  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${m}.${d} ${hh}:${mm}`;
}

export function buildRecentCommentPreview(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '(내용 없음)';
  if (compact.length <= RECENT_COMMENT_PREVIEW_LIMIT) return compact;
  return `${compact.slice(0, RECENT_COMMENT_PREVIEW_LIMIT)}...`;
}

export function notificationCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'notifications');
}

export function notificationDocRef(uid, notificationId) {
  return doc(db, 'users', normalizeText(uid), 'notifications', normalizeText(notificationId));
}

export function notificationPrefCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'notification_prefs');
}

export function notificationPrefDocRef(uid, boardId) {
  return doc(db, 'users', normalizeText(uid), 'notification_prefs', normalizeText(boardId));
}

export function pushTokenCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'push_tokens');
}

export function pushTokenDocRef(uid, tokenId) {
  return doc(db, 'users', normalizeText(uid), 'push_tokens', normalizeText(tokenId));
}

export function mobilePushBoardPrefKey(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized) return '';
  return `${MOBILE_PUSH_PREF_KEY.BOARD_PREFIX}${encodeURIComponent(normalized)}`;
}

export function buildPushTokenDocId(token) {
  const normalized = normalizeText(token);
  if (!normalized) return '';
  const encoded = encodeURIComponent(normalized);
  return encoded.length > 900 ? encoded.slice(0, 900) : encoded;
}

export function viewedPostCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'viewed_posts');
}

export function venueOptionCollectionRef() {
  return collection(db, 'venue_options');
}

export function formatNotificationDate(ms) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

export function notificationPermissionLabel(permission) {
  const normalized = normalizeText(permission).toLowerCase();
  if (normalized === 'granted') return '허용';
  if (normalized === 'denied') return '차단';
  if (normalized === 'default') return '확인 전';
  return '미지원';
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

export function normalizeNotificationFeedFilter(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === NOTIFICATION_FEED_FILTER.POST) return NOTIFICATION_FEED_FILTER.POST;
  if (type === NOTIFICATION_FEED_FILTER.COMMENT) return NOTIFICATION_FEED_FILTER.COMMENT;
  if (type === NOTIFICATION_FEED_FILTER.MENTION) return NOTIFICATION_FEED_FILTER.MENTION;
  return NOTIFICATION_FEED_FILTER.ALL;
}

export function normalizeCoverVenueOptions(options) {
  const source = Array.isArray(options) ? options : [];
  const normalized = source
    .map((value) => normalizeCoverForVenue(value))
    .filter(Boolean);

  const fallback = DEFAULT_COVER_FOR_VENUE_OPTIONS
    .map((value) => normalizeCoverForVenue(value))
    .filter(Boolean);

  const merged = normalized.length ? normalized : fallback;
  return [...new Set(merged)];
}

export function normalizeCoverForVenue(value) {
  const venue = normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  return venue;
}

export function sanitizeCoverForVenueInput(value) {
  return String(value == null ? '' : value)
    .replace(/\r?\n/g, ' ')
    .slice(0, 30);
}

export function logCoverVenueDebug(stage, payload = {}) {
  try {
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams(window.location.search || '');
    const debugEnabled = window.__COVER_VENUE_DEBUG__ === true || query.get('coverVenueDebug') === '1';
    if (!debugEnabled) return;
    console.log('[cover-venue-debug]', stage, payload);
  } catch (_) {
    // Ignore logging failures.
  }
}

export function notificationCategoryLabel(item) {
  const type = normalizeNotificationType(item?.type);
  const subtype = normalizeText(item?.subtype);
  if (subtype === NOTIFICATION_SUBTYPE.MENTION_ALL) return '@ALL 멘션';
  if (type === NOTIFICATION_TYPE.MENTION) return '멘션';
  if (subtype === NOTIFICATION_SUBTYPE.REPLY_COMMENT) return '답글';
  if (type === NOTIFICATION_TYPE.COMMENT) return '댓글';
  return '새 글';
}

export function notificationHeadline(item) {
  const type = normalizeNotificationType(item?.type);
  const subtype = normalizeText(item?.subtype);
  const actorName = normalizeText(item?.actorName) || '익명';
  const title = normalizeText(item?.title) || '(제목 없음)';
  if (subtype === NOTIFICATION_SUBTYPE.MENTION_ALL) {
    return `[${actorName}님이 댓글에서 @ALL로 전체 멘션을 보냈습니다.]`;
  }
  if (type === NOTIFICATION_TYPE.MENTION) {
    return `[${actorName}님이 댓글에서 회원님을 언급했습니다.]`;
  }
  if (subtype === NOTIFICATION_SUBTYPE.REPLY_COMMENT) {
    return `[${actorName}님이 내 댓글에 답글을 남겼습니다.]`;
  }
  if (type === NOTIFICATION_TYPE.COMMENT) {
    return `[${actorName}님이 내 게시글에 댓글을 남겼습니다.]`;
  }
  return `[새 글 알림] [${title}] [${actorName}]`;
}

export function isForcedNotification(item) {
  return normalizeText(item?.subtype) === NOTIFICATION_SUBTYPE.MENTION_ALL;
}

export function isWorkScheduleShiftAlertNotification(item) {
  const notificationId = normalizeText(item?.id || item?.notificationId);
  const boardId = normalizeText(item?.boardId);
  const subtype = normalizeText(item?.subtype);

  if (subtype === NOTIFICATION_SUBTYPE.WORK_SCHEDULE_SHIFT_ALERT) return true;
  if (boardId !== WORK_SCHEDULE_BOARD_ID) return false;
  return /^work_schedule_/i.test(notificationId);
}

export function notificationMatchesFeedFilter(item, filterValue) {
  const filter = normalizeNotificationFeedFilter(filterValue);
  if (filter === NOTIFICATION_FEED_FILTER.ALL) return true;
  const type = normalizeNotificationType(item?.type);
  if (filter === NOTIFICATION_FEED_FILTER.POST) return type === NOTIFICATION_TYPE.POST;
  if (filter === NOTIFICATION_FEED_FILTER.COMMENT) return type === NOTIFICATION_TYPE.COMMENT;
  return type === NOTIFICATION_TYPE.MENTION;
}

export function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(userAgent);
  const desktopIpadUa = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  const viewportNarrow = window.matchMedia('(max-width: 900px)').matches || window.innerWidth <= 900;
  const shortestScreen = Math.min(
    Number(window.screen?.width || 0),
    Number(window.screen?.height || 0)
  );
  const screenLooksMobile = shortestScreen > 0 && shortestScreen <= 1024;

  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const hoverNone = window.matchMedia('(hover: none)').matches || window.matchMedia('(any-hover: none)').matches;
  const touchLikeInput = maxTouchPoints > 0 || anyCoarse || hoverNone;

  if (mobileUa || desktopIpadUa || viewportNarrow) return true;
  if (touchLikeInput && screenLooksMobile) return true;

  const desktopLike = hoverFine && pointerFine && !touchLikeInput;
  return !desktopLike;
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

export function isCoverForBoardId(boardId) {
  const normalized = normalizeText(boardId);
  return normalized === COVER_FOR_BOARD_ID || normalized === WORK_SCHEDULE_BOARD_ID;
}

export function isWorkScheduleBoardId(boardId) {
  return normalizeText(boardId) === WORK_SCHEDULE_BOARD_ID;
}

export function isCalendarBoardId(boardId) {
  return isCoverForBoardId(boardId);
}

export function normalizeWorkScheduleRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byDateKey = new Map();

  source.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const dateKey = normalizeDateKeyInput(row.dateKey || row.date || row.dayKey);
    if (!dateKey) return;

    const fullTimeParts = splitEducationParts(row.fullTime || row.fulltime || row.full || '');
    const part1Parts = splitEducationParts(row.part1 || '');
    const part2Parts = splitEducationParts(row.part2 || '');
    const part3Parts = splitEducationParts(row.part3 || '');
    const inlineEducation = normalizeWorkScheduleMemberText(
      [fullTimeParts.education, part1Parts.education, part2Parts.education, part3Parts.education].join(', ')
    );
    const rowEducation = normalizeWorkScheduleMemberText(row.education || '');
    let mergedEducation = normalizeWorkScheduleMemberText([rowEducation, inlineEducation].join(', '));

    const fullTimeRecovered = recoverSplitEducationName(fullTimeParts.member, mergedEducation);
    mergedEducation = fullTimeRecovered.education;
    const part1Recovered = recoverSplitEducationName(part1Parts.member, mergedEducation);
    mergedEducation = part1Recovered.education;
    const part2Recovered = recoverSplitEducationName(part2Parts.member, mergedEducation);
    mergedEducation = part2Recovered.education;
    const part3Recovered = recoverSplitEducationName(part3Parts.member, mergedEducation);
    mergedEducation = part3Recovered.education;

    const nextRow = {
      dateKey,
      dateLabel: normalizeText(row.dateLabel || row.dateText || ''),
      weekday: normalizeText(row.weekday || row.dayOfWeek || row.day || ''),
      fullTime: fullTimeRecovered.member,
      part1: part1Recovered.member,
      part2: part2Recovered.member,
      part3: part3Recovered.member,
      education: mergedEducation
    };

    if (!byDateKey.has(dateKey)) {
      byDateKey.set(dateKey, nextRow);
      return;
    }

    const existing = byDateKey.get(dateKey);
    byDateKey.set(dateKey, {
      dateKey,
      dateLabel: existing.dateLabel || nextRow.dateLabel,
      weekday: existing.weekday || nextRow.weekday,
      fullTime: existing.fullTime || nextRow.fullTime,
      part1: existing.part1 || nextRow.part1,
      part2: existing.part2 || nextRow.part2,
      part3: existing.part3 || nextRow.part3,
      education: existing.education || nextRow.education
    });
  });

  return [...byDateKey.values()].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey), 'ko'));
}

export function normalizeWorkScheduleMemberText(value) {
  const text = String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[，、]/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ',')
    .trim();
  if (!text) return '';
  return text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/[,;\s]+$/g, '');
}

export function splitEducationParts(value) {
  const raw = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');

  const educationParts = [];
  let memberRaw = raw;
  memberRaw = memberRaw.replace(/[([]\s*교육\s*[:：]\s*([^\)\]]+)\s*[)\]]/gi, (_match, captured) => {
    educationParts.push(String(captured || ''));
    return ' ';
  });
  memberRaw = memberRaw.replace(/(?:^|[\s,;])교육\s*[:：]\s*([^,;]+)/gi, (_match, captured) => {
    educationParts.push(String(captured || ''));
    return ' ';
  });

  return {
    member: normalizeWorkScheduleMemberText(memberRaw),
    education: normalizeWorkScheduleMemberText(educationParts.join(', '))
  };
}

export function recoverSplitEducationName(memberValue, educationValue) {
  const member = normalizeWorkScheduleMemberText(memberValue);
  const education = normalizeWorkScheduleMemberText(educationValue);
  if (!member || !education) return { member, education };

  const trailingMatch = member.match(/(?:^|,\s*)([0-9A-Za-z가-힣]{1,4})\)$/);
  const leadingMatch = education.match(/^([0-9A-Za-z가-힣]{1,4})(?:,\s*|$)/);
  if (!trailingMatch || !leadingMatch) return { member, education };

  const trailing = trailingMatch[1];
  const leading = leadingMatch[1];
  const reconstructed = normalizeWorkScheduleMemberText(`${leading}${trailing}`);
  if (!reconstructed) return { member, education };

  const memberWithoutTrailing = normalizeWorkScheduleMemberText(
    member.replace(/(?:^|,\s*)[0-9A-Za-z가-힣]{1,4}\)\s*$/, '')
  );
  const educationWithoutLeading = normalizeWorkScheduleMemberText(
    education.replace(/^[0-9A-Za-z가-힣]{1,4}(?:,\s*|$)/, '')
  );

  return {
    member: memberWithoutTrailing,
    education: normalizeWorkScheduleMemberText([reconstructed, educationWithoutLeading].join(', '))
  };
}

export function buildWorkScheduleSummaryLines(row) {
  const lines = [];
  const fullTime = normalizeWorkScheduleMemberText(row?.fullTime);
  const part1 = normalizeWorkScheduleMemberText(row?.part1);
  const part2 = normalizeWorkScheduleMemberText(row?.part2);
  const part3 = normalizeWorkScheduleMemberText(row?.part3);
  const education = normalizeWorkScheduleMemberText(row?.education);
  if (fullTime) lines.push(`풀타임: ${fullTime}`);
  if (part1) lines.push(`파트1: ${part1}`);
  if (part2) lines.push(`파트2: ${part2}`);
  if (part3) lines.push(`파트3: ${part3}`);
  if (education) lines.push(`교육: ${education}`);
  return lines;
}

export function normalizePersonNameToken(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase()
    .trim();
}

export function textContainsPersonName(text, personName) {
  const nameToken = normalizePersonNameToken(personName);
  if (!nameToken || nameToken.length < 2) return false;
  const source = normalizePersonNameToken(text);
  if (!source) return false;
  return source.includes(nameToken);
}

export function workScheduleRowContainsPersonName(row, personName) {
  return (
    textContainsPersonName(row?.fullTime, personName)
    || textContainsPersonName(row?.part1, personName)
    || textContainsPersonName(row?.part2, personName)
    || textContainsPersonName(row?.part3, personName)
    || textContainsPersonName(row?.education, personName)
  );
}

export function normalizeDateKeyInput(value) {
  const key = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const parsed = fromDateKey(key);
  if (!parsed) return '';
  return toDateKey(parsed);
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

export function normalizeCoverForTimeValues(values, size, fallbackTime = COVER_FOR_DEFAULT_START_TIME) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeTimeInput(fallbackTime) || COVER_FOR_DEFAULT_START_TIME;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeTimeInput(list[idx]) || fallback);
  }
  return result;
}

export function normalizeCoverForVenueValues(values, size, fallbackVenue = COVER_FOR_DEFAULT_VENUE, options = {}) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeCoverForVenue(fallbackVenue) || COVER_FOR_DEFAULT_VENUE;
  const allowEmpty = !!options.allowEmpty;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    const normalized = normalizeCoverForVenue(list[idx]);
    result.push(normalized || (allowEmpty ? '' : fallback));
  }
  return result;
}

export function normalizeCoverForDateTimeEntries(
  dateValues,
  startTimeValues,
  endTimeValues,
  venueValues,
  fallbackDateKey = '',
  fallbackStartTime = COVER_FOR_DEFAULT_START_TIME,
  fallbackEndTime = COVER_FOR_DEFAULT_END_TIME,
  fallbackVenue = COVER_FOR_DEFAULT_VENUE
) {
  const rawDates = Array.isArray(dateValues) ? dateValues : [];
  const rawStartTimes = Array.isArray(startTimeValues) ? startTimeValues : [];
  const rawEndTimes = Array.isArray(endTimeValues) ? endTimeValues : [];
  const rawVenues = Array.isArray(venueValues) ? venueValues : [];
  const fallbackDate = normalizeDateKeyInput(fallbackDateKey);
  const fallbackSafeStartTime = normalizeTimeInput(fallbackStartTime) || COVER_FOR_DEFAULT_START_TIME;
  const fallbackSafeEndTime = normalizeTimeInput(fallbackEndTime) || suggestEndTime(fallbackSafeStartTime);
  const fallbackSafeVenue = normalizeCoverForVenue(fallbackVenue) || COVER_FOR_DEFAULT_VENUE;

  const pairs = rawDates
    .map((dateValue, idx) => {
      const dateKey = normalizeDateKeyInput(dateValue);
      if (!dateKey) return null;
      const startTimeValue = normalizeTimeInput(rawStartTimes[idx]) || fallbackSafeStartTime;
      const rawEnd = normalizeTimeInput(rawEndTimes[idx]) || fallbackSafeEndTime;
      const endTimeValue = isValidTimeRange(startTimeValue, rawEnd)
        ? rawEnd
        : suggestEndTime(startTimeValue);
      const venue = normalizeCoverForVenue(rawVenues[idx]);
      return {
        dateKey,
        startTimeValue,
        endTimeValue,
        venue
      };
    })
    .filter(Boolean);

  if (!pairs.length && fallbackDate) {
    pairs.push({
      dateKey: fallbackDate,
      startTimeValue: fallbackSafeStartTime,
      endTimeValue: isValidTimeRange(fallbackSafeStartTime, fallbackSafeEndTime)
        ? fallbackSafeEndTime
        : suggestEndTime(fallbackSafeStartTime),
      venue: fallbackSafeVenue
    });
  }

  return pairs
    .map((item) => ({
      dateKey: item.dateKey,
      startTimeValue: item.startTimeValue || fallbackSafeStartTime,
      endTimeValue: item.endTimeValue || suggestEndTime(item.startTimeValue || fallbackSafeStartTime),
      venue: normalizeCoverForVenue(item.venue)
    }))
    .slice(0, COVER_FOR_MAX_DATES);
}

export function normalizeCoverForDateKeys(values, fallbackKey = '') {
  const source = Array.isArray(values) ? values : [];
  const normalized = source
    .map((value) => normalizeDateKeyInput(value))
    .filter(Boolean)
    .slice(0, COVER_FOR_MAX_DATES);

  if (!normalized.length) {
    const fallback = normalizeDateKeyInput(fallbackKey);
    if (fallback) normalized.push(fallback);
  }

  return normalized;
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

export function normalizeCoverForDateStatuses(values, size, fallbackStatus = COVER_FOR_STATUS.SEEKING) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForStatus(list[idx] != null ? list[idx] : fallbackStatus));
  }
  return result;
}

export function postCoverForDateEntries(post) {
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

export function summarizeCoverForPost(post) {
  const entries = postCoverForDateEntries(post);
  if (!entries.length) {
    const fallbackStatus = normalizeCoverForStatus(post?.coverForStatus);
    return {
      statusClass: fallbackStatus,
      label: coverForStatusLabel(fallbackStatus),
      isClosed: isClosedCoverForStatus(fallbackStatus)
    };
  }
  return summarizeCoverForDateEntries(entries);
}

export function hashText(value) {
  const text = String(value || '');
  let hash = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    hash = ((hash * 31) + text.charCodeAt(idx)) >>> 0;
  }
  return hash;
}

export function buildPastelTone(seed) {
  const tones = [
    { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' }, // red
    { bg: '#ffedd5', border: '#fdba74', text: '#9a3412' }, // orange
    { bg: '#fef9c3', border: '#fde68a', text: '#854d0e' }, // yellow
    { bg: '#dcfce7', border: '#86efac', text: '#166534' }, // green
    { bg: '#dbeafe', border: '#93c5fd', text: '#1d4ed8' }, // blue
    { bg: '#f3e8ff', border: '#d8b4fe', text: '#6b21a8' } // purple
  ];
  const hash = hashText(seed);
  return tones[hash % tones.length];
}

export function pastelToneStyle(tone) {
  if (!tone) return undefined;
  return {
    backgroundColor: tone.bg,
    borderColor: tone.border,
    color: tone.text
  };
}

export function pastelToneCardStyle(tone) {
  if (!tone) return undefined;
  return {
    backgroundColor: tone.bg,
    borderColor: tone.border
  };
}

export function hexToRgb(value) {
  const hex = String(value || '').trim().replace(/^#/, '');
  const full = hex.length === 3
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 148, g: 163, b: 184 };
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

export function rgbaFromHex(value, alpha = 1) {
  const { r, g, b } = hexToRgb(value);
  const safeAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function profileCardSurface(role, roleDefMap, theme = 'light') {
  const roleKey = normalizeText(role) || 'Newbie';
  const roleDef = roleDefMap?.get?.(roleKey) || null;
  const palette = getRoleBadgePalette(roleKey, roleDef);
  const normalizedTheme = normalizeText(theme).toLowerCase();
  const isDark = normalizedTheme === 'dark';
  const isExcel = normalizedTheme === 'excel';
  const darkBorder = rgbaFromHex(palette.borderColor, 0.62);
  const darkTint = rgbaFromHex(palette.borderColor, 0.24);
  const darkKicker = rgbaFromHex(palette.borderColor, 0.95);
  const excelBorder = rgbaFromHex(palette.borderColor, 0.58);
  const excelTint = rgbaFromHex(palette.bgColor, 0.38);

  return {
    cardStyle: {
      borderColor: isDark ? darkBorder : isExcel ? excelBorder : palette.borderColor,
      background: isDark
        ? `linear-gradient(135deg, ${darkTint} 0%, rgba(15,23,42,0.92) 100%)`
        : isExcel
          ? `linear-gradient(135deg, ${excelTint} 0%, rgba(248,250,248,0.98) 72%, rgba(238,244,240,1) 100%)`
          : `linear-gradient(135deg, ${palette.bgColor} 0%, rgba(255,255,255,0.94) 100%)`
    },
    kickerStyle: {
      color: isDark ? darkKicker : isExcel ? '#1f6a41' : palette.textColor
    }
  };
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function isPinnedPost(post) {
  return !!post && isTruthyLegacyValue(post.isPinned);
}

export function pinnedAtMillis(post) {
  const pinnedAtMs = Number(post?.pinnedAtMs);
  if (Number.isFinite(pinnedAtMs) && pinnedAtMs > 0) return pinnedAtMs;
  return toMillis(post?.pinnedAt);
}

export function comparePostsWithPinnedPriority(a, b, mode = POST_LIST_VIEW_MODE.LATEST) {
  const aPinned = isPinnedPost(a);
  const bPinned = isPinnedPost(b);

  if (aPinned !== bPinned) return bPinned ? 1 : -1;

  if (aPinned && bPinned) {
    const byPinnedAt = pinnedAtMillis(b) - pinnedAtMillis(a);
    if (byPinnedAt !== 0) return byPinnedAt;
  }

  if (mode === POST_LIST_VIEW_MODE.POPULAR) {
    const byViews = numberOrZero(b?.views) - numberOrZero(a?.views);
    if (byViews !== 0) return byViews;
  }

  return toMillis(b?.createdAt) - toMillis(a?.createdAt);
}

export function isDividerItem(item) {
  return !!(item && item.isDivider === true);
}

export function navSortValue(item) {
  const n = Number(item?.sortOrder);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function sortBoardNavItems(items) {
  return [...items].sort((a, b) => {
    const aPriority = isWorkScheduleBoardId(a?.id) ? 0 : 1;
    const bPriority = isWorkScheduleBoardId(b?.id) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const sa = navSortValue(a);
    const sb = navSortValue(b);
    if (sa !== sb) return sa - sb;
    const na = normalizeText(a.name || a.dividerLabel || a.id).toLowerCase();
    const nb = normalizeText(b.name || b.dividerLabel || b.id).toLowerCase();
    return na.localeCompare(nb, 'ko');
  });
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

export function roleLevelOf(roleKey, roleDefMap) {
  const key = normalizeText(roleKey);
  if (!key) return 0;
  const roleDef = roleDefMap.get(key);
  if (roleDef && Number.isFinite(Number(roleDef.level))) {
    return Number(roleDef.level);
  }
  return CORE_ROLE_LEVELS[key] || 0;
}

export function normalizeRoles(roles, roleDefMap) {
  if (!Array.isArray(roles)) return [];
  const unique = [...new Set(roles.map((role) => normalizeText(role)).filter(Boolean))];
  return unique.sort((a, b) => {
    const la = roleLevelOf(a, roleDefMap);
    const lb = roleLevelOf(b, roleDefMap);
    if (la !== lb) return lb - la;
    return a.localeCompare(b, 'ko');
  });
}

export function boardAllowedRoles(board, roleDefMap) {
  return normalizeRoles(board && board.allowedRoles, roleDefMap);
}

export function boardAutoVisibility(board, roleDefMap) {
  const roles = boardAllowedRoles(board, roleDefMap);
  return roles.includes('Newbie') ? 'public' : 'mentor';
}

export function isPrivilegedBoardRole(roleKey) {
  const key = normalizeText(roleKey);
  return key === 'Super_Admin' || key === 'Admin';
}

export function isNoticeBoard(board) {
  if (!board) return false;
  const boardId = normalizeText(board.id);
  const boardName = normalizeText(board.name);
  return boardId === NOTICE_BOARD_ID || boardName === '공지사항';
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

export function canUseBoardWithProfile(board, profile, roleDefMap) {
  if (!board || !profile) return false;
  if (isDividerItem(board)) return false;

  const roleKey = normalizeRoleKey(profile.role, roleDefMap);
  const rawRole = normalizeText(profile.rawRole || profile.role);

  if (isWorkScheduleBoardId(board.id)) {
    return roleKey !== 'Newbie' && !isExplicitNewbieRole(rawRole);
  }

  if (isPrivilegedBoardRole(roleKey)) return true;

  const allowedRoles = Array.isArray(board.allowedRoles) ? board.allowedRoles : [];

  if (roleKey === 'Newbie') {
    if (isNoticeBoard(board)) return true;
    if (isExplicitNewbieRole(rawRole)) return false;
    const rawRoleCandidates = roleMatchCandidates(rawRole, roleDefMap);
    return rawRoleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
  }

  const roleCandidates = roleMatchCandidates(roleKey, roleDefMap);
  return roleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
}

export function canWriteBoardWithProfile(board, profile, roleDefMap) {
  if (!board || !profile) return false;
  if (isDividerItem(board)) return false;

  const roleKey = normalizeRoleKey(profile.role, roleDefMap);
  const rawRole = normalizeText(profile.rawRole || profile.role);

  if (isWorkScheduleBoardId(board.id)) {
    return WORK_SCHEDULE_WRITE_ROLES.includes(roleKey);
  }

  if (roleKey === 'Newbie') {
    if (isExplicitNewbieRole(rawRole)) return false;
    const allowedRoles = Array.isArray(board.allowedRoles) ? board.allowedRoles : [];
    const rawRoleCandidates = roleMatchCandidates(rawRole, roleDefMap);
    return rawRoleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
  }

  return canUseBoardWithProfile(board, profile, roleDefMap);
}

export function mergePostsByCreatedAtDesc(groups, maxCount = 50) {
  const merged = [];
  const seen = new Set();

  groups.forEach((posts) => {
    posts.forEach((post) => {
      if (seen.has(post.id)) return;
      seen.add(post.id);
      merged.push(post);
    });
  });

  merged.sort((a, b) => comparePostsWithPinnedPriority(a, b, POST_LIST_VIEW_MODE.LATEST));
  return merged.slice(0, maxCount);
}

export function getVisiblePosts(posts) {
  return posts.filter((post) => !isDeletedPost(post));
}

export function buildAuthorName(profile) {
  return profile.nickname || profile.realName || profile.email || 'unknown';
}
