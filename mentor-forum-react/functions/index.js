import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

// Firebase Functions notification backend.
// AI orientation:
// - React clients only create posts/comments/notification docs.
// - This file owns server-side fan-out, preference checks, and FCM delivery.
// - Keep Firestore document IDs and preference keys aligned with the React app.
initializeApp();

// Global guardrails: enough for notification work, but bounded to reduce runaway fan-out risk.
setGlobalOptions({
  region: 'asia-northeast3',
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 5
});

const db = getFirestore();
const messaging = getMessaging();

// Stable app URLs, preference IDs, and board IDs used across Firestore documents.
const APP_BASE_URL = 'https://guro-mentor-forum.web.app';
const MOBILE_PUSH_PREF_GLOBAL = 'pref_mobile_push_global';
const MOBILE_PUSH_PREF_BOARD_PREFIX = 'pref_mobile_push_board:';
const NOTIFICATION_PREF_COMMENT = 'pref_comment';
const NOTIFICATION_PREF_MENTION = 'pref_mention';
const LEGACY_NOTIFICATION_PREF_COMMENT = '__comment__';
const LEGACY_NOTIFICATION_PREF_MENTION = '__mention__';
const WORK_SCHEDULE_BOARD_ID = 'work_schedule';
const WORK_SCHEDULE_BOARD_NAME = '근무일정';
const WORK_SCHEDULE_ALERT_PREF_KEY = 'pref_work_schedule_shift_alert';
const WORK_SCHEDULE_ALERT_SUBTYPE = 'work_schedule_shift_alert';
const WORK_SCHEDULE_PHASE_TODAY = 'today';
const WORK_SCHEDULE_PHASE_TOMORROW = 'tomorrow';

function normalizeText(value) {
  // Normalize external Firestore/user input before comparing IDs, roles, or prefs.
  return String(value == null ? '' : value).trim();
}

function numberOrZero(value) {
  // Older documents may omit numeric fields; defaulting to zero keeps sort/filter logic stable.
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function toMillis(value) {
  // Accept Admin SDK Timestamp, ISO string, Date, and plain millisecond values.
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toMillis === 'function') return numberOrZero(value.toMillis());
  if (value instanceof Date) return value.getTime();
  return 0;
}

function compactRoleToken(value) {
  // Role values have legacy English, Korean, and typo forms; compact before alias lookup.
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function canonicalCoreRole(rawRole) {
  // Canonical role mapping is shared by board access and optimized user queries.
  const token = compactRoleToken(rawRole);
  if (token === 'superadmin' || token === '개발자') return 'Super_Admin';
  if (token === 'admin' || token === '관리자') return 'Admin';
  if (token === 'staff' || token === '운영진') return 'Staff';
  if (token === 'mentor' || token === '멘토' || token === '토') return 'Mentor';
  if (token === 'newbie' || token === '새싹') return 'Newbie';
  return '';
}

function boardRoleCandidatesByRaw(rawRole) {
  // Expand a stored user role into every board.allowedRoles value it may match.
  const source = normalizeText(rawRole);
  const core = canonicalCoreRole(source);
  if (core === 'Super_Admin') return ['Super_Admin', 'SUPER_ADMIN', 'super_admin', 'super-admin', 'super admin', '개발자', source];
  if (core === 'Admin') return ['Admin', 'ADMIN', 'admin', '관리자', source];
  if (core === 'Staff') return ['Staff', 'STAFF', 'staff', '운영진', source];
  if (core === 'Mentor') return ['Mentor', 'MENTOR', 'mentor', '멘토', '토', source];
  if (core === 'Newbie') return ['Newbie', 'NEWBIE', 'newbie', '새싹', source];
  return source ? [source] : ['Newbie', 'NEWBIE', 'newbie', '새싹'];
}

function canUseBoardByRawRole(board, rawRole) {
  // Final permission guard. Keep this even when callers already pre-filter users by role.
  if (!board || board.isDivider === true) return false;
  const allowedRoles = Array.isArray(board.allowedRoles) ? board.allowedRoles : [];
  const normalizedAllowed = allowedRoles.map(normalizeText).filter(Boolean);
  if (!normalizedAllowed.length) return false;

  const candidates = boardRoleCandidatesByRaw(rawRole);
  if (candidates.some((candidate) => normalizedAllowed.includes(candidate))) return true;

  const canonical = canonicalCoreRole(rawRole);
  return !!canonical && normalizedAllowed.some((allowed) => canonicalCoreRole(allowed) === canonical);
}

function userRoleQueryCandidatesForAllowedRole(allowedRole) {
  // Expand board role aliases into exact user.role values for Firestore "in" queries.
  const source = normalizeText(allowedRole);
  const core = canonicalCoreRole(source);
  if (core === 'Super_Admin') return ['Super_Admin', 'SUPER_ADMIN', 'super_admin', 'super-admin', 'super admin', '개발자', source];
  if (core === 'Admin') return ['Admin', 'ADMIN', 'admin', '관리자', source];
  if (core === 'Staff') return ['Staff', 'STAFF', 'staff', '운영진', source];
  if (core === 'Mentor') return ['Mentor', 'MENTOR', 'mentor', '멘토', '토', source];
  if (core === 'Newbie') return ['Newbie', 'NEWBIE', 'newbie', '새싹', source];
  return source ? [source] : [];
}

function chunkArray(items, chunkSize) {
  // Firestore "in" filters accept a limited number of values, so role aliases are chunked.
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function listUsersForBoard(board, fieldNames = ['role']) {
  // Fan-out optimization: query only role-compatible users, then recheck access locally.
  const allowedRoles = Array.isArray(board?.allowedRoles) ? board.allowedRoles : [];
  const roleCandidates = [...new Set(
    allowedRoles
      .flatMap(userRoleQueryCandidatesForAllowedRole)
      .map(normalizeText)
      .filter(Boolean)
  )];
  if (!roleCandidates.length) return [];

  const docsByUid = new Map();
  const chunks = chunkArray(roleCandidates, 10);
  await Promise.all(chunks.map(async (chunk) => {
    const snap = await db.collection('users')
      .where('role', 'in', chunk)
      .select(...fieldNames)
      .get();
    snap.docs.forEach((doc) => {
      docsByUid.set(doc.id, { uid: doc.id, ...doc.data() });
    });
  }));

  return [...docsByUid.values()].filter((user) => canUseBoardByRawRole(board, user.role));
}

async function readPrefEnabled(uid, prefDocId) {
  // Missing preference docs mean enabled by default for existing users.
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('notification_prefs')
    .doc(prefDocId)
    .get();
  if (!snap.exists) return null;
  return snap.data()?.enabled !== false;
}

async function mobilePushEnabledForUser(uid, boardId) {
  // Mobile push must pass both global and board-specific switches.
  const globalEnabled = await readPrefEnabled(uid, MOBILE_PUSH_PREF_GLOBAL);
  if (globalEnabled === false) return false;

  const boardPrefId = `${MOBILE_PUSH_PREF_BOARD_PREFIX}${encodeURIComponent(normalizeText(boardId))}`;
  const boardEnabled = await readPrefEnabled(uid, boardPrefId);
  return boardEnabled !== false;
}

async function typePushEnabledForNotification(uid, notification) {
  // Apply comment/mention/work-schedule preference gates before any FCM call.
  const type = normalizeText(notification?.type);
  const subtype = normalizeText(notification?.subtype);

  if (subtype === WORK_SCHEDULE_ALERT_SUBTYPE) {
    return (await readPrefEnabled(uid, WORK_SCHEDULE_ALERT_PREF_KEY)) !== false;
  }

  if (type === 'comment') {
    const current = await readPrefEnabled(uid, NOTIFICATION_PREF_COMMENT);
    const legacy = await readPrefEnabled(uid, LEGACY_NOTIFICATION_PREF_COMMENT);
    return current !== false && legacy !== false;
  }

  if (type === 'mention' && subtype !== 'mention_all') {
    const current = await readPrefEnabled(uid, NOTIFICATION_PREF_MENTION);
    const legacy = await readPrefEnabled(uid, LEGACY_NOTIFICATION_PREF_MENTION);
    return current !== false && legacy !== false;
  }

  return true;
}

async function listEnabledPushTokens(uid) {
  // Disabled token rows stay in Firestore but are ignored by delivery.
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('push_tokens')
    .limit(100)
    .get();

  return snap.docs
    .map((doc) => ({ docId: doc.id, ...doc.data() }))
    .filter((row) => normalizeText(row.token) && row.enabled !== false)
    .map((row) => ({ docId: normalizeText(row.docId), token: normalizeText(row.token) }));
}

function fallbackPushBody(subtype, actorName) {
  // Notification docs may keep body empty; subtype fallback keeps push copy useful.
  if (subtype === 'post_create') return `${actorName}님이 새 게시글을 등록했습니다.`;
  if (subtype === 'post_comment') return `${actorName}님이 내 게시글에 댓글을 남겼습니다.`;
  if (subtype === 'reply_comment') return `${actorName}님이 내 댓글에 답글을 남겼습니다.`;
  if (subtype === 'mention' || subtype === 'mention_all') return `${actorName}님이 회원님을 언급했습니다.`;
  if (subtype === WORK_SCHEDULE_ALERT_SUBTYPE) return '근무일정 알림이 도착했습니다.';
  return '새 알림이 도착했습니다.';
}

function buildPostLink(postId, boardId, commentId) {
  // Push click targets include board context so app navigation can return to the source board.
  const url = new URL('/post', APP_BASE_URL);
  if (postId) url.searchParams.set('postId', postId);
  if (boardId) {
    url.searchParams.set('boardId', boardId);
    url.searchParams.set('fromBoardId', boardId);
  }
  if (commentId) url.searchParams.set('commentId', commentId);
  return url.toString();
}

function buildPushPayload(notification, notificationId) {
  // Keep notification and data payloads aligned; service worker reads mf_* and url fields.
  const boardId = normalizeText(notification.boardId);
  const boardName = normalizeText(notification.boardName) || boardId;
  const postId = normalizeText(notification.postId);
  const commentId = normalizeText(notification.commentId);
  const subtype = normalizeText(notification.subtype);
  const actorName = normalizeText(notification.actorName) || '익명';
  const titleText = normalizeText(notification.title) || '(제목 없음)';
  const title = `[${boardName}] ${titleText}`;
  const body = normalizeText(notification.body) || fallbackPushBody(subtype, actorName);
  const clickUrl = buildPostLink(postId, boardId, commentId);

  return {
    notification: { title, body },
    data: {
      notificationId: normalizeText(notificationId),
      mf_title: title,
      mf_body: body,
      actorName,
      boardId,
      postId,
      commentId,
      subtype,
      url: clickUrl
    },
    webpush: {
      fcmOptions: { link: clickUrl },
      notification: {
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: `mentor-forum:${normalizeText(notificationId)}`,
        renotify: false
      },
      headers: {
        Urgency: 'high'
      }
    }
  };
}

function isInvalidTokenError(error) {
  // Clean up dead tokens so future sends do not repeatedly fail.
  const code = normalizeText(error?.code);
  const message = normalizeText(error?.message).toLowerCase();
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || message.includes('registration token is not a valid')
    || message.includes('requested entity was not found');
}

async function sendPushToUser(uid, notificationId, notification) {
  // Central delivery gate: validate core fields, check prefs, load tokens, then multicast.
  const boardId = normalizeText(notification?.boardId);
  const postId = normalizeText(notification?.postId);
  if (!uid || !boardId || !postId) return { sent: 0, failed: 0, removedTokens: 0, skipped: 'missing-core-fields' };

  if (!(await mobilePushEnabledForUser(uid, boardId))) {
    return { sent: 0, failed: 0, removedTokens: 0, skipped: 'mobile-push-disabled' };
  }

  if (!(await typePushEnabledForNotification(uid, notification))) {
    return { sent: 0, failed: 0, removedTokens: 0, skipped: 'type-pref-disabled' };
  }

  const tokenRows = await listEnabledPushTokens(uid);
  if (!tokenRows.length) return { sent: 0, failed: 0, removedTokens: 0, skipped: 'no-active-token' };

  const payload = buildPushPayload(notification, notificationId);
  const result = await messaging.sendEachForMulticast({
    tokens: tokenRows.map((row) => row.token),
    ...payload
  });

  const invalidDocIds = [];
  result.responses.forEach((response, index) => {
    if (response.success) return;
    if (isInvalidTokenError(response.error)) invalidDocIds.push(tokenRows[index]?.docId);
  });

  await Promise.allSettled(
    invalidDocIds.filter(Boolean).map((docId) => (
      db.collection('users').doc(uid).collection('push_tokens').doc(docId).delete()
    ))
  );

  return {
    sent: result.successCount,
    failed: result.failureCount,
    removedTokens: invalidDocIds.length
  };
}

function notificationCoreSignature(data) {
  // Exclude readAt/updatedAt so read-state updates never trigger another push.
  if (!data) return '';
  return JSON.stringify({
    actorName: normalizeText(data.actorName),
    actorUid: normalizeText(data.actorUid),
    boardId: normalizeText(data.boardId),
    boardName: normalizeText(data.boardName),
    body: normalizeText(data.body),
    commentId: normalizeText(data.commentId),
    postId: normalizeText(data.postId),
    subtype: normalizeText(data.subtype),
    title: normalizeText(data.title),
    type: normalizeText(data.type)
  });
}

export const dispatchNotificationPush = onDocumentWritten(
  'users/{userUid}/notifications/{notificationId}',
  async (event) => {
    // Any new or meaningfully changed notification document becomes a push candidate.
    const userUid = normalizeText(event.params.userUid);
    const notificationId = normalizeText(event.params.notificationId);
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    if (!userUid || !notificationId || !afterSnap?.exists) return;

    const beforeData = beforeSnap?.exists ? beforeSnap.data() : null;
    const afterData = afterSnap.data() || {};
    if (beforeData && notificationCoreSignature(beforeData) === notificationCoreSignature(afterData)) return;

    const result = await sendPushToUser(userUid, notificationId, afterData);
    logger.info('notification push dispatch complete', { userUid, notificationId, ...result });
  }
);

async function createNotificationIfAbsent(uid, notificationId, payload) {
  // Idempotent create prevents duplicate 새 글 alerts if Cloud Functions retries.
  try {
    await db.collection('users').doc(uid).collection('notifications').doc(notificationId).create(payload);
    return 'created';
  } catch (err) {
    if (err?.code === 6 || err?.code === 'already-exists') return 'exists';
    throw err;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  // Bound concurrent Firestore writes/reads during fan-out.
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), items.length);

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (err) {
        results[index] = { ok: false, error: err };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export const createPostNotifications = onDocumentCreated(
  {
    document: 'posts/{postId}',
    timeoutSeconds: 120,
    maxInstances: 2
  },
  async (event) => {
    // New post fan-out creates notification docs only; dispatchNotificationPush sends FCM.
    const postId = normalizeText(event.params.postId);
    const post = event.data?.data() || {};
    if (!postId || post.deleted === true) return;

    const actorUid = normalizeText(post.authorUid);
    const boardId = normalizeText(post.boardId);
    if (!actorUid || !boardId) return;

    const boardSnap = await db.collection('boards').doc(boardId).get();
    if (!boardSnap.exists) {
      logger.info('post fanout skipped: board not found', { postId, boardId });
      return;
    }
    const board = { id: boardSnap.id, ...boardSnap.data() };
    if (board.isDivider === true) return;

    // Query role-compatible users instead of scanning every user document.
    const users = (await listUsersForBoard(board, ['role']))
      .filter((user) => normalizeText(user.uid) && normalizeText(user.uid) !== actorUid);

    const notificationId = `post:${postId}`;
    const now = Date.now();
    const basePayload = {
      actorUid,
      actorName: normalizeText(post.authorName) || '익명',
      postId,
      boardId,
      boardName: normalizeText(board.name) || boardId,
      type: 'post',
      subtype: 'post_create',
      title: normalizeText(post.title) || '(제목 없음)',
      body: '',
      commentId: '',
      createdAtMs: toMillis(post.createdAt) || numberOrZero(post.createdAtMs) || now,
      readAtMs: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    const counters = {
      scannedUsers: users.length,
      eligibleUsers: 0,
      notificationsCreated: 0,
      skippedBoardAccess: 0,
      skippedBoardPref: 0,
      skippedExists: 0,
      failedUsers: 0
    };

    await mapWithConcurrency(users, 20, async (user) => {
      const uid = normalizeText(user.uid);
      if (!canUseBoardByRawRole(board, user.role)) {
        counters.skippedBoardAccess += 1;
        return;
      }
      counters.eligibleUsers += 1;

      if ((await readPrefEnabled(uid, boardId)) === false) {
        counters.skippedBoardPref += 1;
        return;
      }

      const status = await createNotificationIfAbsent(uid, notificationId, {
        ...basePayload,
        userUid: uid
      });
      if (status === 'created') counters.notificationsCreated += 1;
      else counters.skippedExists += 1;
    }).then((results) => {
      results.forEach((result) => {
        if (result?.ok === false) {
          counters.failedUsers += 1;
          logger.warn('post fanout user failed', { postId, boardId, error: normalizeText(result.error?.message) });
        }
      });
    });

    logger.info('post notification fanout complete', { postId, boardId, ...counters });
  }
);

function seoulDateKey(offsetDays = 0) {
  // Scheduled work alerts are defined by Seoul calendar dates, not server timezone.
  const mapped = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).forEach((part) => {
    if (part.type !== 'literal') mapped[part.type] = part.value;
  });

  const base = new Date(Date.UTC(
    Number(mapped.year || 0),
    Number(mapped.month || 1) - 1,
    Number(mapped.day || 1) + Number(offsetDays || 0)
  ));
  const y = String(base.getUTCFullYear());
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function targetDateKeyForPhase(phase) {
  // Phase names are persisted in notification IDs; keep these strings stable.
  if (phase === WORK_SCHEDULE_PHASE_TODAY) return seoulDateKey(0);
  if (phase === WORK_SCHEDULE_PHASE_TOMORROW) return seoulDateKey(1);
  return '';
}

function normalizeDateKey(value) {
  // Accept legacy/extension date forms and normalize to YYYY-MM-DD.
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeWorkScheduleMemberText(value) {
  // Normalize copied Naver table cells before real-name matching.
  const text = String(value == null ? '' : value)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[，、]/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ',')
    .trim();
  if (!text) return '';
  return text
    .split(',')
    .map((token) => normalizeText(token))
    .filter(Boolean)
    .join(', ')
    .replace(/[,;\s]+$/g, '');
}

function splitEducationParts(value) {
  // Some cells embed "교육: 이름" inside role cells; extract that into education.
  const educationParts = [];
  let memberRaw = String(value == null ? '' : value)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');

  memberRaw = memberRaw.replace(/[([]\s*교육\s*[:：]\s*([^\)\]]+)\s*[)\]]/gi, (_match, captured) => {
    educationParts.push(String(captured || ''));
    return ' ';
  });
  memberRaw = memberRaw.replace(/(?:^|[\s,;])교육\s*[:：]\s*([^,;]+)/gi, (_match, captured) => {
    educationParts.push(String(captured || ''));
    return ' ';
  });

  return {
    member: normalizeWorkScheduleMemberText(memberRaw),
    education: normalizeWorkScheduleMemberText(educationParts.join(', '))
  };
}

function recoverSplitEducationName(memberValue, educationValue) {
  // Recover names split across a trailing ")" in one cell and leading text in education.
  const member = normalizeWorkScheduleMemberText(memberValue);
  const education = normalizeWorkScheduleMemberText(educationValue);
  if (!member || !education) return { member, education };

  const trailingMatch = member.match(/(?:^|,\s*)([0-9A-Za-z가-힣]{1,4})\)$/);
  const leadingMatch = education.match(/^([0-9A-Za-z가-힣]{1,4})(?:,\s*|$)/);
  if (!trailingMatch || !leadingMatch) return { member, education };

  const reconstructed = normalizeWorkScheduleMemberText(`${leadingMatch[1]}${trailingMatch[1]}`);
  if (!reconstructed) return { member, education };

  const memberWithoutTrailing = normalizeWorkScheduleMemberText(
    member.replace(/(?:^|,\s*)[0-9A-Za-z가-힣]{1,4}\)\s*$/, '')
  );
  const educationWithoutLeading = normalizeWorkScheduleMemberText(
    education.replace(/^[0-9A-Za-z가-힣]{1,4}(?:,\s*|$)/, '')
  );

  return {
    member: memberWithoutTrailing,
    education: normalizeWorkScheduleMemberText([reconstructed, educationWithoutLeading].join(', '))
  };
}

function normalizeWorkScheduleRow(row) {
  // Convert extension-stored workScheduleRows into a stable server matching shape.
  const source = row && typeof row === 'object' ? row : {};
  const dateKey = normalizeDateKey(source.dateKey || source.date || source.dayKey);
  const fullTimeParts = splitEducationParts(source.fullTime || source.fulltime || source.full || '');
  const part1Parts = splitEducationParts(source.part1 || '');
  const part2Parts = splitEducationParts(source.part2 || '');
  const part3Parts = splitEducationParts(source.part3 || '');
  const inlineEducation = normalizeWorkScheduleMemberText([
    fullTimeParts.education,
    part1Parts.education,
    part2Parts.education,
    part3Parts.education
  ].join(', '));
  const rowEducation = normalizeWorkScheduleMemberText(source.education || '');
  let mergedEducation = normalizeWorkScheduleMemberText([rowEducation, inlineEducation].join(', '));

  const fullTimeRecovered = recoverSplitEducationName(fullTimeParts.member, mergedEducation);
  mergedEducation = fullTimeRecovered.education;
  const part1Recovered = recoverSplitEducationName(part1Parts.member, mergedEducation);
  mergedEducation = part1Recovered.education;
  const part2Recovered = recoverSplitEducationName(part2Parts.member, mergedEducation);
  mergedEducation = part2Recovered.education;
  const part3Recovered = recoverSplitEducationName(part3Parts.member, mergedEducation);
  mergedEducation = part3Recovered.education;

  return {
    dateKey,
    dateLabel: normalizeText(source.dateLabel || source.dateText || ''),
    weekday: normalizeText(source.weekday || source.dayOfWeek || source.day || ''),
    fullTime: fullTimeRecovered.member,
    part1: part1Recovered.member,
    part2: part2Recovered.member,
    part3: part3Recovered.member,
    education: mergedEducation
  };
}

function normalizeNameToken(value) {
  // Match Korean names while ignoring whitespace and punctuation from copied tables.
  return normalizeText(value)
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase();
}

function textContainsPersonName(text, personName) {
  // Require at least two chars so short stray symbols do not match unrelated rows.
  const nameToken = normalizeNameToken(personName);
  if (!nameToken || nameToken.length < 2) return false;
  return normalizeNameToken(text).includes(nameToken);
}

function summarizeWorkScheduleRoleMatches(row, realName) {
  // Produce compact role labels used in the notification body.
  const fields = [
    { key: 'fullTime', label: '풀타임' },
    { key: 'part1', label: '파트1' },
    { key: 'part2', label: '파트2' },
    { key: 'part3', label: '파트3' },
    { key: 'education', label: '교육' }
  ];

  return fields
    .map((field) => {
      const value = normalizeWorkScheduleMemberText(row?.[field.key]);
      if (!value || !textContainsPersonName(value, realName)) return '';
      return `${field.label}: ${value}`;
    })
    .filter(Boolean);
}

function findBestWorkScheduleMatchForUser(rows, realName) {
  // Rows are sorted newest-first, so the first match is the preferred schedule source.
  const name = normalizeText(realName);
  if (!name) return null;

  for (const candidate of rows) {
    const roleMatches = summarizeWorkScheduleRoleMatches(candidate?.row, name);
    if (!roleMatches.length) continue;
    return {
      postId: normalizeText(candidate.postId),
      postTitle: normalizeText(candidate.postTitle),
      postAuthorUid: normalizeText(candidate.postAuthorUid),
      postAuthorName: normalizeText(candidate.postAuthorName),
      row: candidate.row,
      roleMatches
    };
  }

  return null;
}

function formatDateLabelFromDateKey(dateKey, fallbackDateLabel) {
  // Human-readable Korean date label for work schedule push copy.
  const key = normalizeDateKey(dateKey);
  if (!key) return normalizeText(fallbackDateLabel) || '-';
  const [year, month, day] = key.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function sanitizeId(value) {
  // Keep generated notification IDs deterministic and Firestore-safe.
  return normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function buildWorkScheduleNotificationId(uid, targetDateKey, phase) {
  // One scheduled notification per user/date/phase; content changes update the same doc.
  return `work_schedule_${sanitizeId(targetDateKey)}_${sanitizeId(phase)}_${sanitizeId(uid)}`;
}

function extractWorkScheduleRoleLabels(roleMatches) {
  // Convert "파트1: 홍길동" into "파트1" for concise push bodies.
  const labels = [];
  (Array.isArray(roleMatches) ? roleMatches : []).forEach((matchText) => {
    const label = normalizeText(normalizeText(matchText).split(':')[0]);
    if (label && !labels.includes(label)) labels.push(label);
  });
  return labels;
}

function buildWorkScheduleShiftNotification({ uid, phase, targetDateKey, match }) {
  // Build the Firestore notification doc; the document write trigger handles FCM.
  const row = match?.row || {};
  const phaseLabel = phase === WORK_SCHEDULE_PHASE_TODAY ? '당일' : '전날';
  const dateLabel = formatDateLabelFromDateKey(targetDateKey, row.dateLabel || '');
  const weekday = normalizeText(row.weekday);
  const roleLabels = extractWorkScheduleRoleLabels(match?.roleMatches);
  const roleSummary = roleLabels.length ? roleLabels.join(' / ') : '근무';

  return {
    userUid: uid,
    actorUid: normalizeText(match?.postAuthorUid) || 'system',
    postId: normalizeText(match?.postId),
    boardId: WORK_SCHEDULE_BOARD_ID,
    boardName: WORK_SCHEDULE_BOARD_NAME,
    type: 'post',
    subtype: WORK_SCHEDULE_ALERT_SUBTYPE,
    title: `출근 ${phaseLabel} 알림`,
    actorName: normalizeText(match?.postAuthorName) || '근무일정 동기화',
    body: `[${dateLabel}${weekday ? ` (${weekday})` : ''}] ${roleSummary} 근무 예정`,
    commentId: '',
    createdAtMs: Date.now(),
    readAtMs: 0
  };
}

async function listWorkScheduleRowsForDate(targetDateKey) {
  // Load work_schedule posts and extract rows for the requested Seoul date key.
  const dateKey = normalizeDateKey(targetDateKey);
  if (!dateKey) return [];

  const snap = await db
    .collection('posts')
    .where('boardId', '==', WORK_SCHEDULE_BOARD_ID)
    .limit(1200)
    .get();

  const rows = [];
  snap.docs.forEach((doc) => {
    const post = { id: doc.id, ...doc.data() };
    if (post.deleted === true) return;
    const sourceRows = Array.isArray(post.workScheduleRows) ? post.workScheduleRows : [];
    const updatedAtMs = toMillis(post.updatedAt) || toMillis(post.createdAt) || numberOrZero(post.createdAtMs);

    sourceRows.forEach((rawRow, rowIndex) => {
      const row = normalizeWorkScheduleRow(rawRow);
      if (row.dateKey !== dateKey) return;
      if (!row.fullTime && !row.part1 && !row.part2 && !row.part3 && !row.education) return;
      rows.push({
        postId: doc.id,
        postTitle: normalizeText(post.title),
        postUpdatedAtMs: updatedAtMs,
        postAuthorUid: normalizeText(post.authorUid),
        postAuthorName: normalizeText(post.authorName),
        rowIndex: Number(rowIndex) || 0,
        row
      });
    });
  });

  rows.sort((a, b) => {
    if (b.postUpdatedAtMs !== a.postUpdatedAtMs) return b.postUpdatedAtMs - a.postUpdatedAtMs;
    return a.rowIndex - b.rowIndex;
  });
  return rows;
}

async function upsertNotificationIfChanged(uid, notificationId, notification) {
  // Avoid resending scheduled pushes when the derived notification content is unchanged.
  const ref = db.collection('users').doc(uid).collection('notifications').doc(notificationId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  const nextSignature = notificationCoreSignature(notification);
  if (existing && notificationCoreSignature(existing) === nextSignature) return 'unchanged';

  await ref.set({
    ...notification,
    userUid: uid,
    createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return existing ? 'updated' : 'created';
}

async function dispatchWorkScheduleShiftAlertsByPhase(phase) {
  // Scheduled fan-out: access-filter users, match realName, then upsert notification docs.
  const targetDateKey = targetDateKeyForPhase(phase);
  const boardSnap = await db.collection('boards').doc(WORK_SCHEDULE_BOARD_ID).get();
  if (!targetDateKey || !boardSnap.exists) return { skipped: true, reason: 'missing-target-or-board' };

  const board = { id: boardSnap.id, ...boardSnap.data() };
  if (board.isDivider === true) return { skipped: true, reason: 'board-is-divider' };

  const rows = await listWorkScheduleRowsForDate(targetDateKey);
  if (!rows.length) return { skipped: true, reason: 'no-matching-work-schedule-rows', targetDateKey };

  // Role-filtered lookup keeps scheduled runs from scanning unrelated users.
  const users = await listUsersForBoard(board, ['role', 'realName']);
  const counters = {
    phase,
    targetDateKey,
    scannedUsers: 0,
    eligibleUsers: 0,
    notificationsCreated: 0,
    notificationsUpdated: 0,
    skippedNoMatch: 0,
    skippedPhasePref: 0,
    skippedBoardAccess: 0,
    skippedUnchanged: 0,
    failedUsers: 0
  };

  await mapWithConcurrency(users, 20, async (user) => {
    const uid = normalizeText(user.uid);
    const realName = normalizeText(user.realName);
    if (!uid || !realName) return;
    counters.scannedUsers += 1;

    if (!canUseBoardByRawRole(board, user.role)) {
      counters.skippedBoardAccess += 1;
      return;
    }
    counters.eligibleUsers += 1;

    if ((await readPrefEnabled(uid, WORK_SCHEDULE_ALERT_PREF_KEY)) === false) {
      counters.skippedPhasePref += 1;
      return;
    }

    const match = findBestWorkScheduleMatchForUser(rows, realName);
    if (!match) {
      counters.skippedNoMatch += 1;
      return;
    }

    const notificationId = buildWorkScheduleNotificationId(uid, targetDateKey, phase);
    const notification = buildWorkScheduleShiftNotification({ uid, phase, targetDateKey, match });
    const status = await upsertNotificationIfChanged(uid, notificationId, notification);
    if (status === 'created') counters.notificationsCreated += 1;
    else if (status === 'updated') counters.notificationsUpdated += 1;
    else counters.skippedUnchanged += 1;
  }).then((results) => {
    results.forEach((result) => {
      if (result?.ok === false) {
        counters.failedUsers += 1;
        logger.warn('work schedule alert user failed', { phase, targetDateKey, error: normalizeText(result.error?.message) });
      }
    });
  });

  return counters;
}

export const workScheduleTomorrowReminder = onSchedule(
  {
    schedule: '0 21 * * *',
    timeZone: 'Asia/Seoul',
    timeoutSeconds: 300,
    maxInstances: 1
  },
  async () => {
    // 전날 21:00 KST: match tomorrow's work schedule rows.
    const result = await dispatchWorkScheduleShiftAlertsByPhase(WORK_SCHEDULE_PHASE_TOMORROW);
    logger.info('work schedule tomorrow reminder complete', result);
  }
);

export const workScheduleTodayReminder = onSchedule(
  {
    schedule: '30 8 * * *',
    timeZone: 'Asia/Seoul',
    timeoutSeconds: 300,
    maxInstances: 1
  },
  async () => {
    // 당일 08:30 KST: match today's work schedule rows.
    const result = await dispatchWorkScheduleShiftAlertsByPhase(WORK_SCHEDULE_PHASE_TODAY);
    logger.info('work schedule today reminder complete', result);
  }
);
