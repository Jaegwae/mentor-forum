// Board-focused Firestore helpers shared across pages.
import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  limit,
  getDocs
} from '../../legacy/firebase-app.js';

function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Full board scan (used by admin/app bootstrap).
export async function listAllBoards() {
  const snap = await getDocs(collection(db, 'boards'));
  return mapDocs(snap);
}

// Single board fetch by known ID.
export async function getBoardById(boardId) {
  const snap = await getDoc(doc(db, 'boards', String(boardId || '')));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Upsert by known board ID (used for system-board bootstrap).
export function upsertBoardById(boardId, payload, options = { merge: true }) {
  return setDoc(doc(db, 'boards', String(boardId || '')), payload, options);
}

// Lookup by display name for compatibility paths.
export async function listBoardsByName(boardName, maxCount = 1) {
  const snap = await getDocs(query(
    collection(db, 'boards'),
    where('name', '==', String(boardName || '')),
    limit(Math.max(1, Number(maxCount) || 1))
  ));
  return mapDocs(snap);
}

// Lookup boards where a role is explicitly allowed.
export async function listBoardsByAllowedRole(roleKey) {
  const snap = await getDocs(query(
    collection(db, 'boards'),
    where('allowedRoles', 'array-contains', String(roleKey || ''))
  ));
  return mapDocs(snap);
}

// Divider-only board rows.
export async function listDividerBoards() {
  const snap = await getDocs(query(
    collection(db, 'boards'),
    where('isDivider', '==', true)
  ));
  return mapDocs(snap);
}
