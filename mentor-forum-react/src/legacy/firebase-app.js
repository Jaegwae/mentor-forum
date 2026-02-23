// Firebase app initialization and shared SDK exports.
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  signOut,
  deleteUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  deleteField,
  increment,
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
  deleteDoc,
  runTransaction,
  onSnapshot
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { MENTOR_FORUM_CONFIG } from './config.js';

const placeholderProjectId = !MENTOR_FORUM_CONFIG.firebase.projectId || MENTOR_FORUM_CONFIG.firebase.projectId === 'YOUR_PROJECT_ID';

export const firebaseConfigured = !placeholderProjectId;
export const app = initializeApp(MENTOR_FORUM_CONFIG.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functionsClient = getFunctions(app);
export const TEMP_LOGIN_TTL_MS = 10 * 60 * 1000;

const TEMP_LOGIN_EXPIRY_KEY = 'mentor_forum_temp_login_expiry';

function readSessionValue(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch (_) {
    // Ignore storage write failure.
  }
}

function removeSessionValue(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch (_) {
    // Ignore storage remove failure.
  }
}

export {
  onAuthStateChanged,
  signOut,
  deleteUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  serverTimestamp,
  deleteField,
  increment,
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
  deleteDoc,
  runTransaction,
  onSnapshot,
  httpsCallable
};

export function ensureFirebaseConfigured() {
  if (!firebaseConfigured) {
    throw new Error('Firebase 설정이 비어 있습니다. mentor-forum-react/src/legacy/config.js 값을 먼저 채워주세요.');
  }
}

export async function configureLoginPersistence(rememberLogin) {
  const remember = !!rememberLogin;
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);

  if (remember) {
    clearTemporaryLoginExpiry();
    return;
  }
  setTemporaryLoginExpiry(Date.now() + TEMP_LOGIN_TTL_MS);
}

export function setTemporaryLoginExpiry(expiresAtMs) {
  const expiresAt = Number(expiresAtMs);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    clearTemporaryLoginExpiry();
    return;
  }
  writeSessionValue(TEMP_LOGIN_EXPIRY_KEY, Math.floor(expiresAt));
}

export function clearTemporaryLoginExpiry() {
  removeSessionValue(TEMP_LOGIN_EXPIRY_KEY);
}

export function getTemporaryLoginRemainingMs(nowMs = Date.now()) {
  const raw = readSessionValue(TEMP_LOGIN_EXPIRY_KEY);
  if (!raw) return null;

  const expiresAt = Number(raw);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    clearTemporaryLoginExpiry();
    return 0;
  }
  return expiresAt - Number(nowMs);
}

export async function enforceTemporaryLoginExpiry() {
  const remainingMs = getTemporaryLoginRemainingMs();
  if (remainingMs == null) {
    return { expired: false, remainingMs: null };
  }
  if (remainingMs > 0) {
    return { expired: false, remainingMs };
  }

  clearTemporaryLoginExpiry();
  try {
    await signOut(auth);
  } catch (_) {
    // Ignore sign-out failure and continue as expired.
  }
  return { expired: true, remainingMs: 0 };
}

export function toDateText(value) {
  if (!value) return '-';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { hour12: false });
}
