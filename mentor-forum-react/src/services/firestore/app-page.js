// Firestore gateway for AppPage controller.
// This file centralizes AppPage-specific query shapes so controller code can
// focus on state transitions and UX logic.
import {
  db,
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
} from '../../legacy/firebase-app.js';

// Mention candidate lookup from nickname index.
export function fetchMentionIndexDocs({ keyPrefix = '', maxItems = 8 } = {}) {
  const baseCollection = collection(db, 'nickname_index');
  const q = keyPrefix
    ? query(
      baseCollection,
      where('nicknameKey', '>=', keyPrefix),
      where('nicknameKey', '<=', `${keyPrefix}\uf8ff`),
      limit(maxItems)
    )
    : query(baseCollection, limit(maxItems));
  return getDocs(q);
}

// Realtime feed subscriptions.
export function subscribeRecentPosts({ maxItems = 120, onNext, onError }) {
  const postsQuery = query(
    collection(db, 'posts'),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
  return onSnapshot(postsQuery, onNext, onError);
}

// Fallback path used when ordered collectionGroup query fails due to data gaps.
export function fetchRecentCommentsFallback({ maxItems }) {
  return getDocs(query(
    collectionGroup(db, 'comments'),
    limit(maxItems)
  ));
}

// Ordered recent-comments realtime stream.
export function subscribeRecentComments({ maxItems, onNext, onError }) {
  const commentsQuery = query(
    collectionGroup(db, 'comments'),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
  return onSnapshot(commentsQuery, onNext, onError);
}

// Basic document fetchers.
export function fetchPostDoc(postId) {
  return getDoc(doc(db, 'posts', String(postId || '')));
}

export function fetchUserDoc(uid) {
  return getDoc(doc(db, 'users', String(uid || '')));
}

export function fetchBoardDoc(boardId) {
  return getDoc(doc(db, 'boards', String(boardId || '')));
}

// Post creation entrypoint.
export function createPost(payload) {
  return addDoc(collection(db, 'posts'), payload);
}

// Realtime option/state subscriptions under user scope.
export function subscribeVenueOptions({ maxItems = 120, onNext, onError }) {
  return onSnapshot(
    query(collection(db, 'venue_options'), limit(maxItems)),
    onNext,
    onError
  );
}

export function subscribeViewedPosts({ uid, maxItems = 2000, onNext, onError }) {
  return onSnapshot(
    query(collection(db, 'users', String(uid || ''), 'viewed_posts'), limit(maxItems)),
    onNext,
    onError
  );
}

export function subscribePushTokens({ uid, maxItems = 24, onNext, onError }) {
  return onSnapshot(
    query(collection(db, 'users', String(uid || ''), 'push_tokens'), limit(maxItems)),
    onNext,
    onError
  );
}

export function subscribeNotifications({ uid, maxItems, onNext, onError }) {
  return onSnapshot(
    query(
      collection(db, 'users', String(uid || ''), 'notifications'),
      orderBy('createdAtMs', 'desc'),
      limit(maxItems)
    ),
    onNext,
    onError
  );
}

export function subscribeNotificationPrefs({ uid, onNext, onError }) {
  return onSnapshot(
    query(collection(db, 'users', String(uid || ''), 'notification_prefs')),
    onNext,
    onError
  );
}

// Notification + preference writes.
export function fetchNotificationDoc(uid, notificationId) {
  return getDoc(doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || '')));
}

export function upsertNotificationDoc(uid, notificationId, payload, options = { merge: true }) {
  return setDoc(
    doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || '')),
    payload,
    options
  );
}

export function updateNotificationDoc(uid, notificationId, patch) {
  return updateDoc(doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || '')), patch);
}

export function upsertNotificationPrefDoc(uid, prefKey, payload, options = { merge: true }) {
  return setDoc(
    doc(db, 'users', String(uid || ''), 'notification_prefs', String(prefKey || '')),
    payload,
    options
  );
}

export function upsertPushTokenDoc(uid, tokenId, payload, options = { merge: true }) {
  return setDoc(
    doc(db, 'users', String(uid || ''), 'push_tokens', String(tokenId || '')),
    payload,
    options
  );
}

// Post mutation helper used by pin/status workflows.
export function updatePostDoc(postId, patch) {
  return updateDoc(doc(db, 'posts', String(postId || '')), patch);
}
