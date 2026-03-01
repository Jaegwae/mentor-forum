// Comment-focused Firestore helpers.
import { db, collection, getDocs } from '../../legacy/firebase-app.js';

// Returns all comments for a post (used in fallback/detail paths).
export async function listCommentsByPost(postId) {
  const snap = await getDocs(collection(db, 'posts', String(postId || ''), 'comments'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Lightweight count helper for post-list comment badges.
export async function countCommentsByPost(postId) {
  const snap = await getDocs(collection(db, 'posts', String(postId || ''), 'comments'));
  return snap.size;
}
