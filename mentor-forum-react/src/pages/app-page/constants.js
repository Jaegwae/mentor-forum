// AppPage domain constants.
// Keep values stable unless the product behavior itself is intentionally changing.
// Controller/View/Data modules assume these identifiers and defaults as a contract.
import {
  ALL_BOARD_ID,
  NOTICE_BOARD_ID,
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
  MENTION_ALL_TOKEN,
  MENTION_MAX_ITEMS,
  MENTION_MENU_ESTIMATED_WIDTH,
  MENTION_MENU_INITIAL,
  NOTIFICATION_TYPE,
  BASE_NOTIFICATION_SUBTYPE,
  CORE_ROLE_LEVELS,
  ROLE_KEY_ALIASES,
  FALLBACK_ROLE_DEFINITIONS
} from '../shared/forum-constants.js';
export {
  ALL_BOARD_ID,
  NOTICE_BOARD_ID,
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
  MENTION_ALL_TOKEN,
  MENTION_MAX_ITEMS,
  MENTION_MENU_ESTIMATED_WIDTH,
  NOTIFICATION_TYPE,
  CORE_ROLE_LEVELS,
  ROLE_KEY_ALIASES,
  FALLBACK_ROLE_DEFINITIONS
} from '../shared/forum-constants.js';

export const WORK_SCHEDULE_BOARD_DESCRIPTION = '근무 일정 공유 게시판';
export const COVER_FOR_MAX_DATES = 6;
export const COVER_FOR_REQUEST_TITLE = '대체근무요청';
export const COVER_FOR_CUSTOM_VENUE_VALUE = '__custom__';
export const COVER_CALENDAR_PREVIEW_LIMIT = 2;
export const COVER_FOR_TIME_OPTIONS = Array.from({ length: 48 }, (_, idx) => {
  const hour = String(Math.floor(idx / 2)).padStart(2, '0');
  const minute = idx % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});
export const COVER_FOR_START_TIME_OPTIONS = COVER_FOR_TIME_OPTIONS.slice(0, COVER_FOR_TIME_OPTIONS.length - 1);
export const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const POSTS_PER_PAGE = 20;
export const NOTIFICATION_MAX_ITEMS = 200;
export const NOTIFICATION_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const NEW_POST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_COMMENT_MAX_ITEMS = 5;
export const RECENT_COMMENT_FETCH_LIMIT = 48;
export const RECENT_COMMENT_PREVIEW_LIMIT = 72;
export const PINNED_POST_FETCH_LIMIT = 120;
export const POST_LIST_VIEW_MODE = {
  LATEST: 'latest',
  POPULAR: 'popular'
};
export const NOTIFICATION_SUBTYPE = {
  ...BASE_NOTIFICATION_SUBTYPE,
  POST_CREATE: 'post_create',
  WORK_SCHEDULE_SHIFT_ALERT: 'work_schedule_shift_alert'
};
export const NOTIFICATION_PREF_KEY = {
  COMMENT: 'pref_comment',
  MENTION: 'pref_mention',
  WORK_SCHEDULE_SHIFT_ALERT: 'pref_work_schedule_shift_alert'
};
export const MOBILE_PUSH_PREF_KEY = {
  GLOBAL: 'pref_mobile_push_global',
  BOARD_PREFIX: 'pref_mobile_push_board:'
};
export const LEGACY_NOTIFICATION_PREF_KEY = {
  COMMENT: '__comment__',
  MENTION: '__mention__'
};
export const NOTIFICATION_FEED_FILTER = {
  ALL: 'all',
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
export const COMPOSER_MENTION_MENU_INITIAL = MENTION_MENU_INITIAL;
