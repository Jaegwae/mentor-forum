// Firestore gateway for AdminPage controller.
// Centralizes admin-side CRUD so controller logic stays workflow-oriented.
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
  getDocs,
  deleteDoc,
  writeBatch
} from '../../legacy/firebase-app.js';

// Base list fetchers used by initial admin bootstrap.
export function fetchBoardsDocs() {
  return getDocs(collection(db, 'boards'));
}

export function fetchUsersDocs() {
  return getDocs(collection(db, 'users'));
}

export function fetchVenueOptionsDocs() {
  return getDocs(collection(db, 'venue_options'));
}

// Venue option creation.
export function addVenueOptionDoc(payload) {
  return addDoc(collection(db, 'venue_options'), payload);
}

// Nickname index reads/writes for backfill workflow.
export function fetchNicknameIndexDoc(nicknameKey) {
  return getDoc(doc(db, 'nickname_index', String(nicknameKey || '')));
}

export function upsertNicknameIndexDoc(nicknameKey, payload, options = { merge: true }) {
  return setDoc(doc(db, 'nickname_index', String(nicknameKey || '')), payload, options);
}

// Board order persistence using batched writes with chunking.
export async function saveBoardOrder(items, userUid, serverTimestamp) {
  const MAX_BATCH_OPS = 450;
  let batch = writeBatch(db);
  let opCount = 0;
  const commits = [];

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    batch.set(doc(db, 'boards', item.id), {
      sortOrder: (idx + 1) * 10,
      updatedAt: serverTimestamp(),
      updatedBy: userUid
    }, { merge: true });
    opCount += 1;

    if (opCount >= MAX_BATCH_OPS) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      opCount = 0;
    }
  }

  if (opCount > 0) {
    commits.push(batch.commit());
  }

  for (const commitTask of commits) {
    await commitTask;
  }
}

// Board CRUD helpers.
export function upsertBoardDoc(boardId, payload, options = { merge: true }) {
  return setDoc(doc(db, 'boards', String(boardId || '')), payload, options);
}

export function deleteBoardDoc(boardId) {
  return deleteDoc(doc(db, 'boards', String(boardId || '')));
}

// Role-definition and user-role helpers.
export function upsertRoleDefinitionDoc(roleKey, payload, options = { merge: true }) {
  return setDoc(doc(db, 'role_definitions', String(roleKey || '')), payload, options);
}

export function fetchUsersByRoleDocs(roleKey) {
  return getDocs(query(
    collection(db, 'users'),
    where('role', '==', String(roleKey || ''))
  ));
}

export function updateUserDoc(uid, patch) {
  return updateDoc(doc(db, 'users', String(uid || '')), patch);
}

export function fetchUserDoc(uid) {
  return getDoc(doc(db, 'users', String(uid || '')));
}

export function deleteRoleDefinitionDoc(roleKey) {
  return deleteDoc(doc(db, 'role_definitions', String(roleKey || '')));
}

// Venue update/delete helpers.
export function upsertVenueOptionDoc(venueId, payload, options = { merge: true }) {
  return setDoc(doc(db, 'venue_options', String(venueId || '')), payload, options);
}

export function deleteVenueOptionDoc(venueId) {
  return deleteDoc(doc(db, 'venue_options', String(venueId || '')));
}
