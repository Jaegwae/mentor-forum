// AppPage domain constants.
// Keep values stable unless the product behavior itself is intentionally changing.
// Controller/View/Data modules assume these identifiers and defaults as a contract.
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';

export const ALL_BOARD_ID = '__all__';
export const NOTICE_BOARD_ID = MENTOR_FORUM_CONFIG.app.noticeBoardId || 'Notice';
export const COVER_FOR_BOARD_ID = 'cover_for';
export const COVER_FOR_STATUS = {
  SEEKING: 'seeking',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};
export const COVER_FOR_MAX_DATES = 6;
export const COVER_FOR_REQUEST_TITLE = '대체근무요청';
export const COVER_FOR_DEFAULT_START_TIME = '09:00';
export const COVER_FOR_DEFAULT_END_TIME = '18:00';
export const DEFAULT_COVER_FOR_VENUE_OPTIONS = ['구로', '경기도서관'];
export const COVER_FOR_DEFAULT_VENUE = DEFAULT_COVER_FOR_VENUE_OPTIONS[0];
export const COVER_FOR_CUSTOM_VENUE_VALUE = '__custom__';
export const COVER_CALENDAR_PREVIEW_LIMIT = 2;
export const COVER_FOR_TIME_OPTIONS = Array.from({ length: 48 }, (_, idx) => {
  const hour = String(Math.floor(idx / 2)).padStart(2, '0');
  const minute = idx % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});
export const COVER_FOR_START_TIME_OPTIONS = COVER_FOR_TIME_OPTIONS.slice(0, COVER_FOR_TIME_OPTIONS.length - 1);
export const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
export const POSTS_PER_PAGE = 20;
export const LAST_BOARD_STORAGE_KEY = 'mentor_forum_last_board_id';
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
export const MENTION_MAX_ITEMS = 8;
export const MENTION_MENU_ESTIMATED_WIDTH = 248;
export const MENTION_ALL_TOKEN = 'ALL';
export const NOTIFICATION_TYPE = {
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
export const NOTIFICATION_SUBTYPE = {
  POST_CREATE: 'post_create',
  POST_COMMENT: 'post_comment',
  REPLY_COMMENT: 'reply_comment',
  MENTION: 'mention',
  MENTION_ALL: 'mention_all'
};
export const NOTIFICATION_PREF_KEY = {
  COMMENT: 'pref_comment',
  MENTION: 'pref_mention'
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
export const COMPOSER_MENTION_MENU_INITIAL = {
  open: false,
  query: '',
  start: -1,
  end: -1,
  anchorLeft: 8,
  anchorTop: 8
};

export const CORE_ROLE_LEVELS = {
  Super_Admin: 100,
  Admin: 80,
  Staff: 60,
  Mentor: 40,
  Newbie: 10
};

export const ROLE_KEY_ALIASES = {
  '개발자': 'Super_Admin',
  '관리자': 'Admin',
  '멘토': 'Mentor',
  '새싹': 'Newbie',
  '토': 'Mentor',
  '운영진': 'Staff'
};

export const FALLBACK_ROLE_DEFINITIONS = [
  { role: 'Newbie', labelKo: '새싹', level: 10, badgeBgColor: '#ffffff', badgeTextColor: '#334155' },
  { role: 'Mentor', labelKo: '멘토', level: 40, badgeBgColor: '#dcfce7', badgeTextColor: '#166534' },
  { role: 'Staff', labelKo: '운영진', level: 60, badgeBgColor: '#fde68a', badgeTextColor: '#92400e' },
  { role: 'Admin', labelKo: '관리자', level: 80, badgeBgColor: '#dbeafe', badgeTextColor: '#1d4ed8' },
  { role: 'Super_Admin', labelKo: '개발자', level: 100, badgeBgColor: '#f3e8ff', badgeTextColor: '#7e22ce' }
];
