/* eslint-disable no-undef */
// Firebase Messaging service worker for background push notifications.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCbvxhl6GhRi8nk6FgZtOYz6VwuAepEokI',
  authDomain: 'guro-mentor-forum.firebaseapp.com',
  projectId: 'guro-mentor-forum',
  storageBucket: 'guro-mentor-forum.firebasestorage.app',
  messagingSenderId: '748559493922',
  appId: '1:748559493922:web:4fb9b26d7f2f41d70ed37b'
};

if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

const messaging = firebase.messaging();
const SW_VERSION = '2026-02-25-push-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

function fallbackBodyFromData(data = {}) {
  const subtype = String(data.subtype || '').trim();
  const actorName = String(data.actorName || '익명').trim() || '익명';
  if (subtype === 'post_create') return `${actorName}님이 새 게시글을 등록했습니다.`;
  if (subtype === 'post_comment') return `${actorName}님이 내 게시글에 댓글을 남겼습니다.`;
  if (subtype === 'reply_comment') return `${actorName}님이 내 댓글에 답글을 남겼습니다.`;
  if (subtype === 'mention' || subtype === 'mention_all') return `${actorName}님이 회원님을 언급했습니다.`;
  return '새 알림이 도착했습니다.';
}

function resolveClickUrl(payload) {
  const data = payload?.data || {};
  const direct = String(data.url || '').trim();
  if (direct) return direct;

  const postId = String(data.postId || '').trim();
  const boardId = String(data.boardId || '').trim();
  const commentId = String(data.commentId || '').trim();

  const url = new URL('/post', 'https://guro-mentor-forum.web.app');
  if (postId) url.searchParams.set('postId', postId);
  if (boardId) {
    url.searchParams.set('boardId', boardId);
    url.searchParams.set('fromBoardId', boardId);
  }
  if (commentId) url.searchParams.set('commentId', commentId);
  return url.toString();
}

messaging.onBackgroundMessage((payload) => {
  const nativeTitle = String(payload?.notification?.title || '').trim();
  const nativeBody = String(payload?.notification?.body || '').trim();
  if (nativeTitle || nativeBody) {
    // FCM/browser already renders this notification payload.
    // Returning here prevents duplicate notifications.
    return;
  }

  const data = payload?.data || {};
  const title = String(data.mf_title || data.title || payload?.notification?.title || '멘토포럼 알림').trim();
  const body = String(data.mf_body || data.body || payload?.notification?.body || fallbackBodyFromData(data)).trim();
  const clickUrl = resolveClickUrl(payload);
  const notificationId = String(data.notificationId || '').trim();

  self.registration.showNotification(title, {
    body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: notificationId ? `mentor-forum:${notificationId}` : `mentor-forum:notification:${SW_VERSION}`,
    renotify: false,
    data: {
      url: clickUrl
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = String(event.notification?.data?.url || 'https://guro-mentor-forum.web.app/app').trim();

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetPathname = (() => {
      try {
        return new URL(targetUrl).pathname;
      } catch (_) {
        return '/app';
      }
    })();

    for (let i = 0; i < allClients.length; i += 1) {
      const client = allClients[i];
      try {
        const clientPathname = new URL(client.url).pathname;
        if (clientPathname === targetPathname) {
          await client.focus();
          client.postMessage({ type: 'mentor_forum_push_open', url: targetUrl });
          return;
        }
      } catch (_) {
        // Continue and fallback to openWindow.
      }
    }

    await clients.openWindow(targetUrl);
  })());
});
