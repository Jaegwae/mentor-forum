// User profile Firestore helpers.
import { db, doc, getDoc, setDoc, updateDoc } from '../../legacy/firebase-app.js';

// Reads profile document, returning null when missing.
export async function getUserProfileDoc(uid) {
  const ref = doc(db, 'users', String(uid || ''));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Creates/replaces profile document.
export async function setUserProfileDoc(uid, payload) {
  const ref = doc(db, 'users', String(uid || ''));
  await setDoc(ref, payload);
  return { id: String(uid || ''), ...payload };
}

// Partial update helper for profile normalization and metadata refresh.
export async function updateUserProfileDoc(uid, patch) {
  const ref = doc(db, 'users', String(uid || ''));
  await updateDoc(ref, patch);
}
