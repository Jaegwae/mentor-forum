// Web push helpers: capability checks and FCM token registration.
import { app } from './firebase-app.js';
import { MENTOR_FORUM_CONFIG } from './config.js';

export const WEB_PUSH_SW_PATH = '/firebase-messaging-sw.js';

let messagingModulePromise = null;

function normalizeText(value) {
  return String(value || '').trim();
}

function detectIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  const matchMediaStandalone = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false;
  const navigatorStandalone = typeof navigator !== 'undefined' && navigator.standalone === true;
  return !!(matchMediaStandalone || navigatorStandalone);
}

function isSecureOrigin() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const hostname = String(window.location?.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

async function loadMessagingModule() {
  if (!messagingModulePromise) {
    messagingModulePromise = import('firebase/messaging');
  }
  return messagingModulePromise;
}

function vapidKeyFromConfig() {
  return normalizeText(
    MENTOR_FORUM_CONFIG?.firebase?.messagingVapidKey
    || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FIREBASE_MESSAGING_VAPID_KEY : '')
  );
}

export async function getWebPushCapability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reasonCode: 'no-window', reason: '브라우저 환경에서만 사용할 수 있습니다.' };
  }

  if (!isSecureOrigin()) {
    return { supported: false, reasonCode: 'insecure-origin', reason: 'HTTPS 환경에서만 모바일 알림을 사용할 수 있습니다.' };
  }

  if (!('Notification' in window)) {
    return { supported: false, reasonCode: 'notification-unsupported', reason: '이 브라우저는 알림 API를 지원하지 않습니다.' };
  }

  if (!('serviceWorker' in navigator)) {
    return { supported: false, reasonCode: 'sw-unsupported', reason: '이 브라우저는 서비스워커를 지원하지 않습니다.' };
  }

  if (!('PushManager' in window)) {
    return { supported: false, reasonCode: 'push-unsupported', reason: '이 브라우저는 푸시 알림을 지원하지 않습니다.' };
  }

  if (detectIOS() && !isStandaloneDisplayMode()) {
    return {
      supported: false,
      reasonCode: 'ios-requires-standalone',
      reason: 'iPhone은 Safari에서 홈 화면에 추가한 웹앱(PWA)에서만 알림을 받을 수 있습니다.'
    };
  }

  try {
    const { isSupported } = await loadMessagingModule();
    const messagingSupported = await isSupported();
    if (!messagingSupported) {
      return { supported: false, reasonCode: 'messaging-unsupported', reason: '현재 브라우저에서는 Firebase 푸시 알림을 지원하지 않습니다.' };
    }
  } catch (err) {
    return {
      supported: false,
      reasonCode: 'messaging-check-failed',
      reason: err?.message || '푸시 지원 여부를 확인하지 못했습니다.'
    };
  }

  return { supported: true, reasonCode: 'supported', reason: '' };
}

export async function requestWebPushToken(options = {}) {
  const serviceWorkerPath = normalizeText(options.serviceWorkerPath || WEB_PUSH_SW_PATH) || WEB_PUSH_SW_PATH;
  const capability = await getWebPushCapability();
  if (!capability.supported) {
    return {
      ok: false,
      reasonCode: capability.reasonCode,
      reason: capability.reason
    };
  }

  let permission = String(Notification.permission || 'default').toLowerCase();
  if (permission !== 'granted') {
    permission = String(await Notification.requestPermission()).toLowerCase();
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      reasonCode: 'permission-denied',
      reason: '브라우저 알림 권한이 허용되어야 모바일 알림을 받을 수 있습니다.'
    };
  }

  const registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: '/' });

  const { getMessaging, getToken } = await loadMessagingModule();
  const messaging = getMessaging(app);

  const vapidKey = vapidKeyFromConfig();
  const tokenOptions = {
    serviceWorkerRegistration: registration
  };
  if (vapidKey) tokenOptions.vapidKey = vapidKey;

  let token = '';
  try {
    token = normalizeText(await getToken(messaging, tokenOptions));
  } catch (errWithVapid) {
    if (!vapidKey) {
      throw errWithVapid;
    }
    token = normalizeText(await getToken(messaging, {
      serviceWorkerRegistration: registration
    }));
  }

  if (!token) {
    return {
      ok: false,
      reasonCode: 'token-empty',
      reason: '푸시 토큰 발급에 실패했습니다. 브라우저 알림 설정을 확인해주세요.'
    };
  }

  return {
    ok: true,
    token,
    permission,
    serviceWorkerPath
  };
}
