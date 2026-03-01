// PostPage domain constants.
// Values are shared by controller/view/utils and should remain stable unless
// post-detail behavior is explicitly changed.
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';

export const NOTICE_BOARD_ID = MENTOR_FORUM_CONFIG.app.noticeBoardId || 'Notice';
export const ALL_BOARD_ID = '__all__';
export const COVER_FOR_BOARD_ID = 'cover_for';
export const WORK_SCHEDULE_BOARD_ID = 'work_schedule';
export const WORK_SCHEDULE_BOARD_NAME = '근무일정';
export const WORK_SCHEDULE_WRITE_ROLES = ['Super_Admin', 'Admin', 'Staff'];
export const COVER_FOR_STATUS = {
  SEEKING: 'seeking',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};
export const COVER_FOR_DEFAULT_START_TIME = '09:00';
export const COVER_FOR_DEFAULT_END_TIME = '18:00';
export const DEFAULT_COVER_FOR_VENUE_OPTIONS = ['구로', '경기도서관'];
export const COVER_FOR_DEFAULT_VENUE = DEFAULT_COVER_FOR_VENUE_OPTIONS[0];
export const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
export const LAST_BOARD_STORAGE_KEY = 'mentor_forum_last_board_id';
export const NOTIFICATION_TYPE = {
  POST: 'post',
  COMMENT: 'comment',
  MENTION: 'mention'
};
export const NOTIFICATION_SUBTYPE = {
  POST_COMMENT: 'post_comment',
  REPLY_COMMENT: 'reply_comment',
  MENTION: 'mention',
  MENTION_ALL: 'mention_all'
};
export const MENTION_ALL_TOKEN = 'ALL';
export const MENTION_MAX_ITEMS = 8;
export const MENTION_MENU_ESTIMATED_WIDTH = 248;
export const MENTION_MENU_INITIAL = {
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
