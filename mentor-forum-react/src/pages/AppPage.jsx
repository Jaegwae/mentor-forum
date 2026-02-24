// Main forum page: post list, post creation, and notification flows.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { buildPermissions, getRoleBadgePalette } from '../legacy/rbac.js';
import { createRichEditor } from '../legacy/rich-editor.js';
import {
  WEB_PUSH_SW_PATH,
  getWebPushCapability,
  requestWebPushToken
} from '../legacy/push-notifications.js';
import { pushRelayConfigured, sendPushRelayPostCreate } from '../legacy/push-relay.js';
import { RichEditorToolbar } from '../components/editor/RichEditorToolbar.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { useTheme } from '../hooks/useTheme.js';

const ALL_BOARD_ID = '__all__';
const NOTICE_BOARD_ID = MENTOR_FORUM_CONFIG.app.noticeBoardId || 'Notice';
const COVER_FOR_BOARD_ID = 'cover_for';
const COVER_FOR_STATUS = {
  SEEKING: 'seeking',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};
const COVER_FOR_MAX_DATES = 6;
const COVER_FOR_REQUEST_TITLE = '대체근무요청';
const COVER_FOR_DEFAULT_START_TIME = '09:00';
const COVER_FOR_DEFAULT_END_TIME = '18:00';
const DEFAULT_COVER_FOR_VENUE_OPTIONS = ['구로', '경기도서관'];
const COVER_FOR_DEFAULT_VENUE = DEFAULT_COVER_FOR_VENUE_OPTIONS[0];
const COVER_FOR_CUSTOM_VENUE_VALUE = '__custom__';
const COVER_CALENDAR_PREVIEW_LIMIT = 2;
const COVER_FOR_TIME_OPTIONS = Array.from({ length: 48 }, (_, idx) => {
  const hour = String(Math.floor(idx / 2)).padStart(2, '0');
  const minute = idx % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});
const COVER_FOR_START_TIME_OPTIONS = COVER_FOR_TIME_OPTIONS.slice(0, COVER_FOR_TIME_OPTIONS.length - 1);
const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
const POSTS_PER_PAGE = 20;
const LAST_BOARD_STORAGE_KEY = 'mentor_forum_last_board_id';
const NOTIFICATION_MAX_ITEMS = 200;
const NOTIFICATION_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const NEW_POST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_COMMENT_MAX_ITEMS = 5;
const RECENT_COMMENT_FETCH_LIMIT = 48;
const RECENT_COMMENT_PREVIEW_LIMIT = 72;
const PINNED_POST_FETCH_LIMIT = 120;
const POST_LIST_VIEW_MODE = {
  LATEST: 'latest',
  POPULAR: 'popular'
};
const MENTION_MAX_ITEMS = 8;
const MENTION_MENU_ESTIMATED_WIDTH = 248;
const MENTION_ALL_TOKEN = 'ALL';
const NOTIFICATION_TYPE = {
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
const NOTIFICATION_SUBTYPE = {
  POST_CREATE: 'post_create',
  POST_COMMENT: 'post_comment',
  REPLY_COMMENT: 'reply_comment',
  MENTION: 'mention',
  MENTION_ALL: 'mention_all'
};
const NOTIFICATION_PREF_KEY = {
  COMMENT: 'pref_comment',
  MENTION: 'pref_mention'
};
const MOBILE_PUSH_PREF_KEY = {
  GLOBAL: 'pref_mobile_push_global',
  BOARD_PREFIX: 'pref_mobile_push_board:'
};
const LEGACY_NOTIFICATION_PREF_KEY = {
  COMMENT: '__comment__',
  MENTION: '__mention__'
};
const NOTIFICATION_FEED_FILTER = {
  ALL: 'all',
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
const COMPOSER_MENTION_MENU_INITIAL = {
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

function normalizeBoardIdentity(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

function boardIdentityCandidates(boardId, boardName = '') {
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

function postBoardIdentityCandidates(post) {
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

function boardPermissionDebugText(board, profile) {
  return joinDebugParts([
    `boardId=${normalizeText(board?.id) || '-'}`,
    `boardName=${normalizeText(board?.name) || '-'}`,
    `allowedRoles=${debugValueList(board?.allowedRoles)}`,
    `boardIsDivider=${board?.isDivider === true ? 'true' : 'false'}`,
    `myRole=${normalizeText(profile?.role) || '-'}`,
    `myRawRole=${normalizeText(profile?.rawRole || profile?.role) || '-'}`
  ]);
}

function readRememberedBoardId() {
  try {
    const value = normalizeText(window.sessionStorage.getItem(LAST_BOARD_STORAGE_KEY));
    if (!value || value === ALL_BOARD_ID) return '';
    return value;
  } catch (_) {
    return '';
  }
}

function writeRememberedBoardId(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized || normalized === ALL_BOARD_ID) return;
  try {
    window.sessionStorage.setItem(LAST_BOARD_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage failure.
  }
}

function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

function formatPostListDate(value) {
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

function formatPostListDateMobile(value) {
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

function buildRecentCommentPreview(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '(내용 없음)';
  if (compact.length <= RECENT_COMMENT_PREVIEW_LIMIT) return compact;
  return `${compact.slice(0, RECENT_COMMENT_PREVIEW_LIMIT)}...`;
}

function notificationCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'notifications');
}

function notificationDocRef(uid, notificationId) {
  return doc(db, 'users', normalizeText(uid), 'notifications', normalizeText(notificationId));
}

function notificationPrefCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'notification_prefs');
}

function notificationPrefDocRef(uid, boardId) {
  return doc(db, 'users', normalizeText(uid), 'notification_prefs', normalizeText(boardId));
}

function pushTokenCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'push_tokens');
}

function pushTokenDocRef(uid, tokenId) {
  return doc(db, 'users', normalizeText(uid), 'push_tokens', normalizeText(tokenId));
}

function mobilePushBoardPrefKey(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized) return '';
  return `${MOBILE_PUSH_PREF_KEY.BOARD_PREFIX}${encodeURIComponent(normalized)}`;
}

function buildPushTokenDocId(token) {
  const normalized = normalizeText(token);
  if (!normalized) return '';
  const encoded = encodeURIComponent(normalized);
  return encoded.length > 900 ? encoded.slice(0, 900) : encoded;
}

function viewedPostCollectionRef(uid) {
  return collection(db, 'users', normalizeText(uid), 'viewed_posts');
}

function venueOptionCollectionRef() {
  return collection(db, 'venue_options');
}

function formatNotificationDate(ms) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

function notificationPermissionLabel(permission) {
  const normalized = normalizeText(permission).toLowerCase();
  if (normalized === 'granted') return '허용';
  if (normalized === 'denied') return '차단';
  if (normalized === 'default') return '확인 전';
  return '미지원';
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

function normalizeNotificationFeedFilter(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === NOTIFICATION_FEED_FILTER.POST) return NOTIFICATION_FEED_FILTER.POST;
  if (type === NOTIFICATION_FEED_FILTER.COMMENT) return NOTIFICATION_FEED_FILTER.COMMENT;
  if (type === NOTIFICATION_FEED_FILTER.MENTION) return NOTIFICATION_FEED_FILTER.MENTION;
  return NOTIFICATION_FEED_FILTER.ALL;
}

function normalizeCoverVenueOptions(options) {
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

function normalizeCoverForVenue(value) {
  const venue = normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  return venue;
}

function sanitizeCoverForVenueInput(value) {
  return String(value == null ? '' : value)
    .replace(/\r?\n/g, ' ')
    .slice(0, 30);
}

function logCoverVenueDebug(stage, payload = {}) {
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

function notificationCategoryLabel(item) {
  const type = normalizeNotificationType(item?.type);
  const subtype = normalizeText(item?.subtype);
  if (subtype === NOTIFICATION_SUBTYPE.MENTION_ALL) return '@ALL 멘션';
  if (type === NOTIFICATION_TYPE.MENTION) return '멘션';
  if (subtype === NOTIFICATION_SUBTYPE.REPLY_COMMENT) return '답글';
  if (type === NOTIFICATION_TYPE.COMMENT) return '댓글';
  return '새 글';
}

function notificationHeadline(item) {
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

function isForcedNotification(item) {
  return normalizeText(item?.subtype) === NOTIFICATION_SUBTYPE.MENTION_ALL;
}

function notificationMatchesFeedFilter(item, filterValue) {
  const filter = normalizeNotificationFeedFilter(filterValue);
  if (filter === NOTIFICATION_FEED_FILTER.ALL) return true;
  const type = normalizeNotificationType(item?.type);
  if (filter === NOTIFICATION_FEED_FILTER.POST) return type === NOTIFICATION_TYPE.POST;
  if (filter === NOTIFICATION_FEED_FILTER.COMMENT) return type === NOTIFICATION_TYPE.COMMENT;
  return type === NOTIFICATION_TYPE.MENTION;
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

function isCoverForBoardId(boardId) {
  return normalizeText(boardId) === COVER_FOR_BOARD_ID;
}

function normalizeDateKeyInput(value) {
  const key = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const parsed = fromDateKey(key);
  if (!parsed) return '';
  return toDateKey(parsed);
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

function normalizeCoverForTimeValues(values, size, fallbackTime = COVER_FOR_DEFAULT_START_TIME) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeTimeInput(fallbackTime) || COVER_FOR_DEFAULT_START_TIME;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeTimeInput(list[idx]) || fallback);
  }
  return result;
}

function normalizeCoverForVenueValues(values, size, fallbackVenue = COVER_FOR_DEFAULT_VENUE, options = {}) {
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

function normalizeCoverForDateTimeEntries(
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

function normalizeCoverForDateKeys(values, fallbackKey = '') {
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

function normalizeCoverForDateStatuses(values, size, fallbackStatus = COVER_FOR_STATUS.SEEKING) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForStatus(list[idx] != null ? list[idx] : fallbackStatus));
  }
  return result;
}

function postCoverForDateEntries(post) {
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

function summarizeCoverForPost(post) {
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

function hashText(value) {
  const text = String(value || '');
  let hash = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    hash = ((hash * 31) + text.charCodeAt(idx)) >>> 0;
  }
  return hash;
}

function buildPastelTone(seed) {
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

function pastelToneStyle(tone) {
  if (!tone) return undefined;
  return {
    backgroundColor: tone.bg,
    borderColor: tone.border,
    color: tone.text
  };
}

function pastelToneCardStyle(tone) {
  if (!tone) return undefined;
  return {
    backgroundColor: tone.bg,
    borderColor: tone.border
  };
}

function hexToRgb(value) {
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

function rgbaFromHex(value, alpha = 1) {
  const { r, g, b } = hexToRgb(value);
  const safeAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function profileCardSurface(role, roleDefMap, isDark = false) {
  const roleKey = normalizeText(role) || 'Newbie';
  const roleDef = roleDefMap?.get?.(roleKey) || null;
  const palette = getRoleBadgePalette(roleKey, roleDef);
  const darkBorder = rgbaFromHex(palette.borderColor, 0.62);
  const darkTint = rgbaFromHex(palette.borderColor, 0.24);
  const darkKicker = rgbaFromHex(palette.borderColor, 0.95);

  return {
    cardStyle: {
      borderColor: isDark ? darkBorder : palette.borderColor,
      background: isDark
        ? `linear-gradient(135deg, ${darkTint} 0%, rgba(15,23,42,0.92) 100%)`
        : `linear-gradient(135deg, ${palette.bgColor} 0%, rgba(255,255,255,0.94) 100%)`
    },
    kickerStyle: {
      color: isDark ? darkKicker : palette.textColor
    }
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isPinnedPost(post) {
  return !!post && isTruthyLegacyValue(post.isPinned);
}

function pinnedAtMillis(post) {
  const pinnedAtMs = Number(post?.pinnedAtMs);
  if (Number.isFinite(pinnedAtMs) && pinnedAtMs > 0) return pinnedAtMs;
  return toMillis(post?.pinnedAt);
}

function comparePostsWithPinnedPriority(a, b, mode = POST_LIST_VIEW_MODE.LATEST) {
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

function isDividerItem(item) {
  return !!(item && item.isDivider === true);
}

function navSortValue(item) {
  const n = Number(item?.sortOrder);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function sortBoardNavItems(items) {
  return [...items].sort((a, b) => {
    const sa = navSortValue(a);
    const sb = navSortValue(b);
    if (sa !== sb) return sa - sb;
    const na = normalizeText(a.name || a.dividerLabel || a.id).toLowerCase();
    const nb = normalizeText(b.name || b.dividerLabel || b.id).toLowerCase();
    return na.localeCompare(nb, 'ko');
  });
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

function roleLevelOf(roleKey, roleDefMap) {
  const key = normalizeText(roleKey);
  if (!key) return 0;
  const roleDef = roleDefMap.get(key);
  if (roleDef && Number.isFinite(Number(roleDef.level))) {
    return Number(roleDef.level);
  }
  return CORE_ROLE_LEVELS[key] || 0;
}

function normalizeRoles(roles, roleDefMap) {
  if (!Array.isArray(roles)) return [];
  const unique = [...new Set(roles.map((role) => normalizeText(role)).filter(Boolean))];
  return unique.sort((a, b) => {
    const la = roleLevelOf(a, roleDefMap);
    const lb = roleLevelOf(b, roleDefMap);
    if (la !== lb) return lb - la;
    return a.localeCompare(b, 'ko');
  });
}

function boardAllowedRoles(board, roleDefMap) {
  return normalizeRoles(board && board.allowedRoles, roleDefMap);
}

function boardAutoVisibility(board, roleDefMap) {
  const roles = boardAllowedRoles(board, roleDefMap);
  return roles.includes('Newbie') ? 'public' : 'mentor';
}

function isPrivilegedBoardRole(roleKey) {
  const key = normalizeText(roleKey);
  return key === 'Super_Admin' || key === 'Admin';
}

function isNoticeBoard(board) {
  if (!board) return false;
  const boardId = normalizeText(board.id);
  const boardName = normalizeText(board.name);
  return boardId === NOTICE_BOARD_ID || boardName === '공지사항';
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

function canUseBoardWithProfile(board, profile, roleDefMap) {
  if (!board || !profile) return false;
  if (isDividerItem(board)) return false;

  const roleKey = normalizeRoleKey(profile.role, roleDefMap);
  const rawRole = normalizeText(profile.rawRole || profile.role);
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

function canWriteBoardWithProfile(board, profile, roleDefMap) {
  if (!board || !profile) return false;
  if (isDividerItem(board)) return false;

  const roleKey = normalizeRoleKey(profile.role, roleDefMap);
  const rawRole = normalizeText(profile.rawRole || profile.role);

  if (roleKey === 'Newbie') {
    if (isExplicitNewbieRole(rawRole)) return false;
    const allowedRoles = Array.isArray(board.allowedRoles) ? board.allowedRoles : [];
    const rawRoleCandidates = roleMatchCandidates(rawRole, roleDefMap);
    return rawRoleCandidates.some((candidateRole) => allowedRoles.includes(candidateRole));
  }

  return canUseBoardWithProfile(board, profile, roleDefMap);
}

function mergePostsByCreatedAtDesc(groups, maxCount = 50) {
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

function getVisiblePosts(posts) {
  return posts.filter((post) => !isDeletedPost(post));
}

function buildAuthorName(profile) {
  return profile.nickname || profile.realName || profile.email || 'unknown';
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

async function loadBoards(roleKey, roleDefMap = null, rawRole = '') {
  const normalizedRole = normalizeText(roleKey);
  const normalizedRawRole = normalizeText(rawRole);
  const privileged = isPrivilegedBoardRole(normalizedRole);
  let rawItems = [];

  if (privileged) {
    const allSnap = await getDocs(collection(db, 'boards'));
    rawItems = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else if (normalizedRole === 'Newbie' && isExplicitNewbieRole(normalizedRawRole)) {
    const noticeByIdSnap = await getDoc(doc(db, 'boards', NOTICE_BOARD_ID));
    if (noticeByIdSnap.exists()) {
      rawItems = [{ id: noticeByIdSnap.id, ...noticeByIdSnap.data() }];
    } else {
      const noticeByNameSnap = await getDocs(query(
        collection(db, 'boards'),
        where('name', '==', '공지사항'),
        limit(1)
      ));
      rawItems = noticeByNameSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } else {
    const roleCandidates = [
      ...roleMatchCandidates(normalizedRole, roleDefMap),
      ...(
        normalizedRole === 'Newbie' && !isExplicitNewbieRole(normalizedRawRole)
          ? roleMatchCandidates(normalizedRawRole, roleDefMap)
          : []
      )
    ];
    const uniqueRoleCandidates = [...new Set(roleCandidates.filter(Boolean))];
    const boardQueries = uniqueRoleCandidates.length
      ? uniqueRoleCandidates.map((candidateRole) => getDocs(query(
        collection(db, 'boards'),
        where('allowedRoles', 'array-contains', candidateRole)
      )))
      : [];

    const [boardSnapshots, dividerSnap] = await Promise.all([
      Promise.all(boardQueries),
      getDocs(query(collection(db, 'boards'), where('isDivider', '==', true)))
    ]);

    const byId = new Map();
    boardSnapshots.forEach((snap) => {
      snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
    });
    dividerSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
    rawItems = Array.from(byId.values());
  }

  return sortBoardNavItems(rawItems);
}

async function queryPostsForBoard(boardId, maxCount = 50, options = {}) {
  const {
    allowLooseFallback = false,
    boardName = ''
  } = options || {};
  const mapSnap = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data(), views: numberOrZero(d.data().views) }));
  let pinnedPosts = [];
  const sortAndLimit = (posts) => mergePostsByCreatedAtDesc([posts, pinnedPosts], maxCount);
  let strictPosts = [];

  try {
    const pinnedSnap = await getDocs(query(
      collection(db, 'posts'),
      where('boardId', '==', boardId),
      where('isPinned', '==', true),
      limit(Math.max(PINNED_POST_FETCH_LIMIT, maxCount))
    ));
    pinnedPosts = mapSnap(pinnedSnap);
  } catch (err) {
    const code = String(err?.code || '');
    if (code.includes('failed-precondition')) {
      try {
        const fallbackSnap = await getDocs(query(
          collection(db, 'posts'),
          where('boardId', '==', boardId)
        ));
        pinnedPosts = mapSnap(fallbackSnap).filter((post) => isPinnedPost(post));
      } catch (_) {
        pinnedPosts = [];
      }
    } else {
      pinnedPosts = [];
    }
  }

  try {
    const snap = await getDocs(query(
      collection(db, 'posts'),
      where('boardId', '==', boardId),
      orderBy('createdAt', 'desc'),
      limit(maxCount)
    ));
    strictPosts = mapSnap(snap);
  } catch (err) {
    const code = String(err?.code || '');
    if (!code.includes('failed-precondition')) throw err;

    const fallback = await getDocs(query(
      collection(db, 'posts'),
      where('boardId', '==', boardId)
    ));
    strictPosts = mapSnap(fallback);
  }

  if (strictPosts.length || !allowLooseFallback) {
    return sortAndLimit(strictPosts);
  }

  const looseLimit = Math.min(Math.max((Number(maxCount) || 50) * 8, 160), 600);
  let looseSnap;

  try {
    looseSnap = await getDocs(query(
      collection(db, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(looseLimit)
    ));
  } catch (err) {
    const code = String(err?.code || '');
    if (!code.includes('failed-precondition')) throw err;
    looseSnap = await getDocs(query(collection(db, 'posts'), limit(looseLimit)));
  }

  const targetCandidates = boardIdentityCandidates(boardId, boardName);
  const targetRawSet = new Set(targetCandidates.map((item) => normalizeText(item)).filter(Boolean));
  const targetNormalizedSet = new Set(targetCandidates.map((item) => normalizeBoardIdentity(item)).filter(Boolean));

  const loosePosts = mapSnap(looseSnap).filter((post) => {
    const postCandidates = postBoardIdentityCandidates(post);
    return postCandidates.some((candidate) => (
      targetRawSet.has(normalizeText(candidate))
      || targetNormalizedSet.has(normalizeBoardIdentity(candidate))
    ));
  });

  return sortAndLimit(loosePosts);
}

async function fetchCommentCount(postId) {
  try {
    const snap = await getDocs(collection(db, 'posts', postId, 'comments'));
    return snap.size;
  } catch (_) {
    return 0;
  }
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

export default function AppPage() {
  usePageMeta('멘토포럼', 'app-page');

  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useTheme();

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

  const [ready, setReady] = useState(false);
  const [pageMessage, setPageMessage] = useState({ type: '', text: '' });
  const [appliedPopup, setAppliedPopup] = useState({ open: false, text: '' });

  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);

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

  const [boardDrawerOpen, setBoardDrawerOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);

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
    return profileCardSurface(currentUserProfile?.role, roleDefMap, isDark);
  }, [currentUserProfile?.role, isDark, roleDefMap]);

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
          const fallbackLimit = fallbackBoardId === COVER_FOR_BOARD_ID ? 320 : 50;
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
          const boardPostLimit = currentBoard.id === COVER_FOR_BOARD_ID ? 320 : 50;
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
    if (!ready || !currentUserUid || !currentUserProfile || !boardList.length) return () => {};

    const boardById = new Map(
      boardList.map((board) => [normalizeText(board?.id), board])
    );

    const postsQuery = query(
      collection(db, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(120)
    );

    const unsubscribe = onSnapshot(postsQuery, (snap) => {
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
    }, (err) => {
      console.error('[post-notification-realtime-failed]', err);
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
        const fallbackSnap = await getDocs(query(
          collectionGroup(db, 'comments'),
          limit(Math.max(120, RECENT_COMMENT_FETCH_LIMIT * 4))
        ));
        return parseRowsFromSnapshot(fallbackSnap);
      } catch (err) {
        console.error('[recent-comments-fallback-fetch-failed]', err);
        return [];
      }
    };
    const commentsQuery = query(
      collectionGroup(db, 'comments'),
      orderBy('createdAt', 'desc'),
      limit(RECENT_COMMENT_FETCH_LIMIT)
    );

    const applyRows = (rows) => {
      // Resolve post metadata in batch, then keep only top N rows that map to readable posts.
      const uniquePostIds = [...new Set(rows.map((item) => item.postId))];
      Promise.all(uniquePostIds.map(async (postId) => {
        try {
          const postSnap = await getDoc(doc(db, 'posts', postId));
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

    const unsubscribe = onSnapshot(commentsQuery, (snap) => {
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
    }, (err) => {
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
    if (board && isCoverForBoardId(board.id)) {
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
      const debugText = boardPermissionDebugText(currentBoard, currentUserProfile);
      alert(`선택한 게시판에 글 작성 권한이 없습니다. (${debugText})`);
      return;
    }

    resetComposer(currentBoard);
    setComposerOpen(true);
  }, [canWriteBoard, currentBoard, currentUserProfile, isAllBoardSelected, resetComposer]);

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
    setComposerDatePickerOpen(true);
  }, [composerCoverDateKeys, todayDate]);

  const closeComposerDatePicker = useCallback(() => {
    setComposerDatePickerOpen(false);
    setComposerDatePickerTargetIndex(-1);
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
    const coverEntryCompositeValues = currentBoard.id === COVER_FOR_BOARD_ID
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
    const duplicateCoverEntryValues = currentBoard.id === COVER_FOR_BOARD_ID
      ? [...new Set(
        coverEntryCompositeValues.filter((entryValue, idx) => coverEntryCompositeValues.indexOf(entryValue) !== idx)
      )]
      : [];
    const coverDateFallbackKey = toDateKey(new Date()) || toDateKey(todayDate);
    const nextCoverDateTimeEntries = currentBoard.id === COVER_FOR_BOARD_ID
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

    if (currentBoard.id === COVER_FOR_BOARD_ID && duplicateCoverEntryValues.length) {
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

    if (currentBoard.id === COVER_FOR_BOARD_ID && !nextCoverDateKeys.length) {
      setComposerMessage({ type: 'error', text: '대체근무 요청 날짜를 최소 1개 선택해주세요.' });
      return;
    }

    if (
      currentBoard.id === COVER_FOR_BOARD_ID
      && nextCoverDateTimeEntries.some((entry) => !normalizeCoverForVenue(entry.venue))
    ) {
      setComposerMessage({ type: 'error', text: '각 날짜별 체험관을 선택해주세요.' });
      return;
    }

    if (
      currentBoard.id === COVER_FOR_BOARD_ID
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

      if (currentBoard.id === COVER_FOR_BOARD_ID) {
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

      const createdRef = await addDoc(collection(db, 'posts'), payloadToCreate);
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
            getDoc(doc(db, 'users', currentUser.uid)),
            getDoc(doc(db, 'boards', currentBoard?.id || ''))
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
        const coverDebugText = currentBoard?.id === COVER_FOR_BOARD_ID
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
        console.error('[post-create-permission-debug]', {
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
          invalidRangeIndexes
        });
        setComposerMessage({
          type: 'error',
          text: `${normalizeErrMessage(err, '저장 실패')} (${debugText})`
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
          console.error('[post-create-push-relay-dispatch-failed]', {
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
      console.error('[post-create-list-refresh-failed]', {
        error: err,
        boardId: currentBoard?.id || '',
        boardName: currentBoard?.name || '',
        createdPostId
      });
      setListMessage({
        type: 'error',
        text: `게시글은 등록되었지만 목록을 갱신하지 못했습니다. 새로고침 후 확인해주세요. (errorCode=${normalizeText(err?.code) || '-'})`
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

    const venuesQuery = query(
      venueOptionCollectionRef(),
      limit(120)
    );

    const unsubscribe = onSnapshot(venuesQuery, (snap) => {
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
    }, (err) => {
      console.error('[venue-option-sync-subscribe-failed]', {
        error: err,
        uid: currentUserUid
      });
      setVenueOptions(DEFAULT_COVER_FOR_VENUE_OPTIONS);
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

    const viewedQuery = query(
      viewedPostCollectionRef(currentUserUid),
      limit(2000)
    );

    const unsubscribe = onSnapshot(viewedQuery, (snap) => {
      const nextMap = {};
      snap.docs.forEach((row) => {
        const postId = normalizeText(row.id || row.data()?.postId);
        if (!postId) return;
        nextMap[postId] = true;
      });
      setViewedPostIdMap(nextMap);
    }, (err) => {
      console.error('[viewed-post-sync-subscribe-failed]', {
        error: err,
        uid: currentUserUid
      });
      setViewedPostIdMap({});
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

    const tokensQuery = query(
      pushTokenCollectionRef(currentUserUid),
      limit(24)
    );

    const unsubscribe = onSnapshot(tokensQuery, (snap) => {
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
    }, (err) => {
      console.error('[push-token-sync-subscribe-failed]', {
        error: err,
        uid: currentUserUid
      });
      setMobilePushTokens([]);
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

    const notificationsQuery = query(
      notificationCollectionRef(currentUserUid),
      orderBy('createdAtMs', 'desc'),
      limit(NOTIFICATION_MAX_ITEMS)
    );
    const unsubscribeNotifications = onSnapshot(notificationsQuery, (snap) => {
      const normalized = snap.docs
        .map((row) => {
          const data = row.data() || {};
          const id = normalizeText(row.id);
          const postId = normalizeText(data.postId || row.id);
          const boardId = normalizeText(data.boardId);
          if (!id || !postId || !boardId) return null;
          return {
            id,
            postId,
            boardId,
            boardName: normalizeText(data.boardName) || boardId,
            title: normalizeText(data.title) || '(제목 없음)',
            type: normalizeNotificationType(data.type),
            subtype: normalizeText(data.subtype),
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
    }, (err) => {
      console.error('[notification-sync-subscribe-failed]', {
        error: err,
        uid: currentUserUid
      });
      setNotifications([]);
    });

    const prefsQuery = query(notificationPrefCollectionRef(currentUserUid));
    const unsubscribePrefs = onSnapshot(prefsQuery, (snap) => {
      const nextPrefs = {};
      snap.docs.forEach((row) => {
        const data = row.data() || {};
        const boardId = normalizeText(row.id || data.boardId);
        if (!boardId) return;
        nextPrefs[boardId] = data.enabled !== false;
      });
      setNotificationPrefs(nextPrefs);
    }, (err) => {
      console.error('[notification-pref-sync-subscribe-failed]', {
        error: err,
        uid: currentUserUid
      });
      setNotificationPrefs({});
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

    const targetRef = notificationDocRef(currentUserUid, notificationId);
    try {
      const existing = await getDoc(targetRef);
      if (existing.exists()) return;
      await setDoc(targetRef, {
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
      console.error('[notification-sync-write-failed]', {
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
          await updateDoc(notificationDocRef(currentUserUid, item.id), {
            readAtMs: now,
            readAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          console.error('[notification-sync-mark-all-read-failed]', {
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
      await updateDoc(notificationDocRef(currentUserUid, targetId), {
        readAtMs: now,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error('[notification-sync-mark-read-failed]', {
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
      await setDoc(notificationPrefDocRef(currentUserUid, targetId), {
        userUid: currentUserUid,
        boardId: targetId,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('[notification-pref-sync-write-failed]', {
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
      await setDoc(notificationPrefDocRef(currentUserUid, targetKey), {
        userUid: currentUserUid,
        boardId: targetKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('[notification-pref-type-write-failed]', {
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
      await setDoc(notificationPrefDocRef(currentUserUid, prefKey), {
        userUid: currentUserUid,
        boardId: prefKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('[mobile-push-pref-board-write-failed]', {
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
      await setDoc(notificationPrefDocRef(currentUserUid, MOBILE_PUSH_PREF_KEY.GLOBAL), {
        userUid: currentUserUid,
        boardId: MOBILE_PUSH_PREF_KEY.GLOBAL,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('[mobile-push-pref-global-write-failed]', {
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
          await setDoc(pushTokenDocRef(currentUserUid, tokenInfo.id), {
            userUid: currentUserUid,
            token: normalizeText(tokenInfo.token),
            enabled: false,
            platform: normalizeText(tokenInfo.platform || 'web') || 'web',
            updatedAt: serverTimestamp()
          }, { merge: true });
        }));
      }

      await setDoc(pushTokenDocRef(currentUserUid, tokenId), {
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
      console.error('[mobile-push-enable-failed]', {
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
          await setDoc(pushTokenDocRef(currentUserUid, tokenInfo.id), {
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
      console.error('[mobile-push-disable-failed]', {
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
        return updateDoc(doc(db, 'posts', postId), payload);
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
  const showCoverCalendar = !!currentBoard && isCoverForBoardId(currentBoard.id);
  const composerIsCoverForBoard = !!currentBoard && isCoverForBoardId(currentBoard.id);
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

    visiblePosts
      .filter((post) => !isDeletedPost(post) && isCoverForBoardId(post.boardId))
      .forEach((post) => {
        const entries = postCoverForDateEntries(post);
        const authorName = normalizeText(post.authorName || post.authorUid) || '익명';
        const tone = buildPastelTone(post.id);

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
  }, [showCoverCalendar, visiblePosts]);

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
      const previewEvents = dayEvents.slice(0, COVER_CALENDAR_PREVIEW_LIMIT).map((event) => ({
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

  return (
    <>
      <motion.main
        className="page stack forum-shell"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
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
                className={boardDrawerOpen ? 'mobile-hamburger-btn hidden' : 'mobile-hamburger-btn'}
                aria-label="게시판 메뉴 열기"
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
          <div className="forum-list-layout" style={{ marginTop: '10px' }}>
            <div className="forum-side-column">
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
                          {compactListMode ? (
                            cell.eventCount > 0 ? (
                              <span className="cover-calendar-event-count">{cell.eventCount}건</span>
                            ) : null
                          ) : (
                            <>
                              {cell.previewEvents.map((event, idx) => (
                                <span
                                  key={`${cell.key}-${event.postId}-${idx}`}
                                  className="cover-calendar-event"
                                  title={event.label}
                                  style={pastelToneStyle(event.tone)}
                                >
                                  {event.label}
                                </span>
                              ))}
                              {cell.hasMoreEvents ? (
                                <span className="cover-calendar-event-more">+{cell.moreCount}건</span>
                              ) : null}
                            </>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <p className="meta" style={{ marginTop: '8px' }}>
                  날짜를 누르면 해당 날짜의 구하는 중 요청 목록이 모달로 열립니다.
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
                        const coverSummary = isCoverForBoardId(post.boardId) ? summarizeCoverForPost(post) : null;
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
                    const coverSummary = isCoverForBoardId(post.boardId) ? summarizeCoverForPost(post) : null;
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
            <DialogTitle className="text-balance text-lg font-semibold">멘토포럼 사용 설명서</DialogTitle>
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
                <li>대체근무요청 게시판은 날짜/시간/체험관까지 입력해야 등록됩니다.</li>
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
                {coverCalendarModalItems.length ? coverCalendarModalItems.map((item) => (
                  <button
                    key={`cover-calendar-modal-item-${item.eventId || item.postId}`}
                    type="button"
                    className="cover-calendar-modal-item"
                    style={pastelToneCardStyle(item.tone)}
                    onClick={() => {
                      setCoverCalendarModalOpen(false);
                      handleMovePost(item.postId, item.boardId);
                    }}
                  >
                    <span className="cover-calendar-modal-item-author" style={pastelToneStyle(item.tone)}>
                      [{item.startTimeValue || COVER_FOR_DEFAULT_START_TIME}~{item.endTimeValue || COVER_FOR_DEFAULT_END_TIME}] [{item.venue || COVER_FOR_DEFAULT_VENUE}]
                    </span>
                    <span className="cover-calendar-modal-item-title">{item.title || '(제목 없음)'}</span>
                    <span className="cover-calendar-modal-item-meta">작성자: {item.authorName || '익명'}</span>
                  </button>
                )) : (
                  <p className="muted" style={{ margin: 0 }}>해당 날짜에 구하는 중인 요청이 없습니다.</p>
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
                    <p className="meta" style={{ margin: 0, fontWeight: 700 }}>대체근무 요청 날짜/시간 (필수)</p>
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
