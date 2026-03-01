// Notification-focused Firestore helpers.
import {
  db,
  doc,
  setDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from '../../legacy/firebase-app.js';

// Idempotent notification upsert for user inbox rows.
export async function upsertUserNotification(uid, notificationId, payload, merge = true) {
  const ref = doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || ''));
  await setDoc(ref, payload, merge ? { merge: true } : undefined);
}

// Marks a notification row as read (or applies caller-provided read patch).
export async function markUserNotificationRead(uid, notificationId, readAtPatch) {
  const ref = doc(db, 'users', String(uid || ''), 'notifications', String(notificationId || ''));
  await updateDoc(ref, readAtPatch);
}

// Recent notification list for bell/inbox UI.
export async function listRecentUserNotifications(uid, maxCount = 80) {
  const snap = await getDocs(query(
    collection(db, 'users', String(uid || ''), 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Number(maxCount) || 80))
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
