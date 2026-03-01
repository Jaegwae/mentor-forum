/**
 * 런타임 설정 상수.
 * - Firebase 식별자, 라우트 경로, 역할 라벨, 푸시 릴레이 주소를 한 곳에서 관리한다.
 * - Vite env 값이 없을 때는 안전한 기본값으로 폴백한다.
 */
export const MENTOR_FORUM_CONFIG = {
  firebase: {
    apiKey: "AIzaSyCbvxhl6GhRi8nk6FgZtOYz6VwuAepEokI",
    authDomain: "guro-mentor-forum.firebaseapp.com",
    projectId: "guro-mentor-forum",
    storageBucket: "guro-mentor-forum.firebasestorage.app",
    messagingSenderId: "748559493922",
    appId: "1:748559493922:web:4fb9b26d7f2f41d70ed37b",
    messagingVapidKey: (typeof import.meta !== 'undefined' && import.meta.env)
      ? (import.meta.env.VITE_FIREBASE_MESSAGING_VAPID_KEY || '')
      : ''
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
    adminPage: '/admin',
    pushRelayUrl: (typeof import.meta !== 'undefined' && import.meta.env)
      // 개발/운영 env가 없을 때 기존 기본 relay 엔드포인트를 사용한다.
      ? (import.meta.env.VITE_PUSH_RELAY_URL || 'https://script.google.com/macros/s/AKfycbyFoiPgFbVaNHr7wOmXVaDichgheQbzfhiwevt9fHYxqAX-lDAAUQ2Lj5mIuB0TNypq/exec')
      : ''
  }
};
