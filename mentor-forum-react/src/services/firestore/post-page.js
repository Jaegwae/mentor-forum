// Firestore gateway for PostPage controller.
// Keeps post-detail query paths and mutations in one place.
import {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  runTransaction,
  deleteDoc
} from '../../legacy/firebase-app.js';

function isMissingIndexError(err) {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  const indexPhrase = message.includes('requires') && message.includes('index');
  const notReadyPhrase = message.includes('index') && message.includes('not ready');
  return code.includes('failed-precondition') && (indexPhrase || notReadyPhrase);
}

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

// Board metadata read for access checks.
export function fetchBoardDoc(boardId) {
  return getDoc(doc(db, 'boards', String(boardId || '')));
}

// Realtime comments stream for the current post.
export function subscribeCommentsForPost({ postId, onNext, onError }) {
  const commentsRef = collection(db, 'posts', String(postId || ''), 'comments');
  const orderedQuery = query(commentsRef, orderBy('createdAt', 'asc'));

  let unsub = () => {};
  let fallbackAttached = false;

  unsub = onSnapshot(
    orderedQuery,
    onNext,
    (err) => {
      if (!fallbackAttached && isMissingIndexError(err)) {
        fallbackAttached = true;
        // 인덱스 빌드 중에는 무정렬 구독으로 폴백하고, 화면 레이어에서 정렬한다.
        unsub = onSnapshot(commentsRef, onNext, onError);
        return;
      }
      onError?.(err);
    }
  );

  return () => {
    unsub?.();
  };
}

// Core post document read.
export function fetchPostDoc(postId) {
  return getDoc(doc(db, 'posts', String(postId || '')));
}

// View-count increment wrapped in transaction to avoid race conditions.
export function incrementPostViews(postId, numberOrZero) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'posts', String(postId || ''));
    const postSnap = await tx.get(ref);
    if (!postSnap.exists()) return;
    const data = postSnap.data() || {};
    const nextViews = numberOrZero(data.views) + 1;
    tx.update(ref, { views: nextViews });
  });
}

// User-scoped viewed-post marker write.
export function upsertViewedPost(uid, postId, payload, options = { merge: true }) {
  return setDoc(
    doc(db, 'users', String(uid || ''), 'viewed_posts', String(postId || '')),
    payload,
    options
  );
}

// Mention target and user lookup helpers.
export function fetchNicknameIndexDoc(nicknameKey) {
  return getDoc(doc(db, 'nickname_index', String(nicknameKey || '')));
}

export function fetchUsersDocs() {
  return getDocs(collection(db, 'users'));
}

// Notification write helper.
export function upsertNotificationDoc(uid, notificationId, payload, options = { merge: true }) {
  return setDoc(
    doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || '')),
    payload,
    options
  );
}

// Comment/post mutation helpers.
export function createComment(postId, payload) {
  return addDoc(collection(db, 'posts', String(postId || ''), 'comments'), payload);
}

export function updatePostDoc(postId, patch) {
  return updateDoc(doc(db, 'posts', String(postId || '')), patch);
}

export function deletePostDoc(postId) {
  return deleteDoc(doc(db, 'posts', String(postId || '')));
}

export function deleteCommentDoc(postId, commentId) {
  return deleteDoc(doc(db, 'posts', String(postId || ''), 'comments', String(commentId || '')));
}

// Small runtime diagnostic helper for permission-debug payloads.
export function getRuntimeProjectId() {
  return db?.app?.options?.projectId || '';
}
