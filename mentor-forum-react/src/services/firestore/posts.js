// Post-focused Firestore helpers shared across app/post pages.
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from '../../legacy/firebase-app.js';

function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Pinned posts for board header section.
export async function listPinnedPostsByBoard(boardId, maxCount) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    where('boardId', '==', String(boardId || '')),
    where('isPinned', '==', true),
    limit(Math.max(1, Number(maxCount) || 1))
  ));
  return mapDocs(snap);
}

// Preferred board feed query: board filter + createdAt DESC.
export async function listPostsByBoardCreatedDesc(boardId, maxCount) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    where('boardId', '==', String(boardId || '')),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Number(maxCount) || 1))
  ));
  return mapDocs(snap);
}

// Fallback board feed query without ordering.
export async function listPostsByBoard(boardId) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    where('boardId', '==', String(boardId || ''))
  ));
  return mapDocs(snap);
}

// Preferred global feed query ordered by recency.
export async function listRecentPostsCreatedDesc(maxCount) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Number(maxCount) || 1))
  ));
  return mapDocs(snap);
}

// Fallback global feed query without ordering.
export async function listRecentPosts(maxCount) {
  const snap = await getDocs(query(
    collection(db, 'posts'),
    limit(Math.max(1, Number(maxCount) || 1))
  ));
  return mapDocs(snap);
}
