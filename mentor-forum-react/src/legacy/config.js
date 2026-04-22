/**
 * 런타임 설정 상수.
 * - Firebase 식별자, 라우트 경로, 역할 라벨을 한 곳에서 관리한다.
 * - Firebase 웹 설정은 공개 번들 값이지만, 소스에는 하드코딩하지 않는다.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

export const MENTOR_FORUM_CONFIG = {
  firebase: {
    apiKey: env.VITE_FIREBASE_API_KEY || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.VITE_FIREBASE_APP_ID || '',
    messagingVapidKey: env.VITE_FIREBASE_MESSAGING_VAPID_KEY || ''
  },
  app: {
    roleLabels: {
      Super_Admin: '개발자',
      Admin: '관리자',
      Mentor: '멘토',
      Newbie: '새싹'
    },
    defaultRole: 'Newbie',
    noticeBoardId: 'Notice',
    superAdminRole: 'Super_Admin',
    loginPage: '/login',
    signupPage: '/signup',
    appPage: '/app',
    postPage: '/post',
    adminPage: '/admin'
  }
};
