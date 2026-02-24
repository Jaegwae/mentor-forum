const SCRIPT_PROP_KEY = {
  FIREBASE_PROJECT_ID: 'FIREBASE_PROJECT_ID',
  FIREBASE_WEB_API_KEY: 'FIREBASE_WEB_API_KEY',
  GCP_SA_CLIENT_EMAIL: 'GCP_SA_CLIENT_EMAIL',
  GCP_SA_PRIVATE_KEY: 'GCP_SA_PRIVATE_KEY'
};

const MOBILE_PUSH_PREF_GLOBAL = 'pref_mobile_push_global';
const MOBILE_PUSH_PREF_BOARD_PREFIX = 'pref_mobile_push_board:';
const APP_BASE_URL = 'https://guro-mentor-forum.web.app';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const RELAY_EVENT_POST_CREATE_FANOUT = 'post_create_fanout';

function doGet(e) {
  try {
    const payload = parseRequestQueryPayload_(e);
    if (payload) {
      const result = handleRelayPayload_(payload, 'doGet');
      return jsonOutput_(result);
    }
    return jsonOutput_({
      ok: true,
      service: 'mentor-forum-push-relay',
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error('[mentor-forum-push-relay-get-failed]', err);
    return jsonOutput_({
      ok: false,
      error: normalizeText_(err && err.message) || 'internal-error'
    });
  }
}

function doPost(e) {
  try {
    const payload = parseRequestJson_(e);
    const result = handleRelayPayload_(payload, 'doPost');
    return jsonOutput_(result);
  } catch (err) {
    console.error('[mentor-forum-push-relay-failed]', err);
    return jsonOutput_({
      ok: false,
      error: normalizeText_(err && err.message) || 'internal-error'
    });
  }
}

function handleRelayPayload_(payload, sourceTag) {
  const idToken = normalizeText_(payload && payload.idToken);
  if (!idToken) return { ok: false, error: 'invalid-request' };

  const authed = verifyFirebaseIdToken_(idToken);
  const actorUid = normalizeText_(authed.uid);
  if (!actorUid) {
    return { ok: false, error: 'unauthorized' };
  }

  const eventType = normalizeText_(payload.eventType || payload.type);
  console.log('[relay-hit]', {
    source: normalizeText_(sourceTag) || 'unknown',
    eventType: eventType || 'single',
    actorUid: actorUid,
    targetUid: normalizeText_(payload.targetUid),
    notificationId: normalizeText_(payload.notificationId),
    postId: normalizeText_(payload.postId)
  });

  if (eventType === RELAY_EVENT_POST_CREATE_FANOUT) {
    return dispatchPostCreateFanout_(payload, actorUid);
  }
  return dispatchSingleNotificationPush_(payload, actorUid);
}

function dispatchSingleNotificationPush_(payload, actorUid) {
  const targetUid = normalizeText_(payload.targetUid);
  const notificationId = normalizeText_(payload.notificationId);
  if (!targetUid || !notificationId) {
    console.log('[relay-single-skip]', { reason: 'invalid-request', targetUid: targetUid, notificationId: notificationId });
    return { ok: false, error: 'invalid-request' };
  }

  const notification = getNotificationDocWithRetry_(targetUid, notificationId, 4, 220);
  if (!notification) {
    console.log('[relay-single-skip]', { reason: 'notification-not-found', targetUid: targetUid, notificationId: notificationId });
    return { ok: true, skipped: true, reason: 'notification-not-found' };
  }

  const notificationActorUid = normalizeText_(notification.actorUid);
  if (notificationActorUid && notificationActorUid !== actorUid && actorUid !== targetUid) {
    console.log('[relay-single-skip]', {
      reason: 'forbidden-actor',
      targetUid: targetUid,
      actorUid: actorUid,
      notificationActorUid: notificationActorUid
    });
    return { ok: false, error: 'forbidden-actor' };
  }

  const boardId = normalizeText_(notification.boardId);
  const postId = normalizeText_(notification.postId);
  if (!boardId || !postId) {
    console.log('[relay-single-skip]', {
      reason: 'notification-missing-core-fields',
      targetUid: targetUid,
      boardId: boardId,
      postId: postId
    });
    return { ok: true, skipped: true, reason: 'notification-missing-core-fields' };
  }

  if (!isMobilePushEnabledForUser_(targetUid, boardId)) {
    console.log('[relay-single-skip]', {
      reason: 'push-pref-disabled',
      targetUid: targetUid,
      boardId: boardId
    });
    return { ok: true, skipped: true, reason: 'push-pref-disabled' };
  }

  const tokenRows = listEnabledPushTokens_(targetUid);
  if (!tokenRows.length) {
    console.log('[relay-single-skip]', {
      reason: 'no-active-token',
      targetUid: targetUid,
      boardId: boardId
    });
    return { ok: true, skipped: true, reason: 'no-active-token' };
  }

  const pushPayload = buildPushPayloadFromNotification_(notification, notificationId);
  const sendResult = sendPushToTokens_(targetUid, tokenRows, pushPayload);
  console.log('[relay-single-result]', {
    targetUid: targetUid,
    boardId: boardId,
    tokenCount: tokenRows.length,
    sent: sendResult.sent,
    failed: sendResult.failed,
    removedTokens: sendResult.removedTokens
  });
  return {
    ok: true,
    sent: sendResult.sent,
    failed: sendResult.failed,
    removedTokens: sendResult.removedTokens
  };
}

function getNotificationDocWithRetry_(targetUid, notificationId, attempts, waitMs) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  const pauseMs = Math.max(0, Number(waitMs) || 0);
  for (var i = 0; i < maxAttempts; i += 1) {
    const row = getNotificationDoc_(targetUid, notificationId);
    if (row) return row;
    if (i < maxAttempts - 1 && pauseMs > 0) {
      Utilities.sleep(pauseMs);
    }
  }
  return null;
}

function dispatchPostCreateFanout_(payload, actorUid) {
  const startedAtMs = Date.now();
  const HARD_LIMIT_MS = 25000;
  const postId = normalizeText_(payload.postId);
  if (!postId) return { ok: false, error: 'invalid-post-id' };

  const post = getPostDoc_(postId);
  if (!post) return { ok: true, skipped: true, reason: 'post-not-found' };
  if (post.deleted === true) return { ok: true, skipped: true, reason: 'post-deleted' };

  const postAuthorUid = normalizeText_(post.authorUid);
  if (!postAuthorUid || postAuthorUid !== actorUid) {
    return { ok: false, error: 'forbidden-post-actor' };
  }

  const boardId = normalizeText_(post.boardId || payload.boardId);
  if (!boardId) return { ok: true, skipped: true, reason: 'post-missing-board-id' };
  const board = getBoardDoc_(boardId);
  if (!board) return { ok: true, skipped: true, reason: 'board-not-found' };
  if (board.isDivider === true) return { ok: true, skipped: true, reason: 'board-is-divider' };

  const boardName = normalizeText_(payload.boardName || board.name || boardId);
  const title = normalizeText_(payload.title || post.title) || '(제목 없음)';
  const actorName = normalizeText_(post.authorName || payload.actorName) || '익명';
  const createdAtMs = Number(payload.createdAtMs) || Date.now();
  const notificationId = 'post:' + postId;

  const counters = {
    ok: true,
    eventType: RELAY_EVENT_POST_CREATE_FANOUT,
    postId: postId,
    boardId: boardId,
    scannedUsers: 0,
    eligibleUsers: 0,
    notificationsCreated: 0,
    skippedBoardAccess: 0,
    skippedBoardPref: 0,
    skippedPushPref: 0,
    skippedNoToken: 0,
    skippedExists: 0,
    failedUsers: 0,
    sent: 0,
    failed: 0,
    removedTokens: 0,
    timedOut: false,
    elapsedMs: 0
  };

  const users = listAllUsers_();
  for (var idx = 0; idx < users.length; idx += 1) {
    if ((Date.now() - startedAtMs) > HARD_LIMIT_MS) {
      counters.timedOut = true;
      break;
    }
    var userRow = users[idx];
    const uid = normalizeText_(userRow && userRow.uid);
    if (!uid || uid === actorUid) continue;
    counters.scannedUsers += 1;

    try {
      const rawRole = normalizeText_(userRow && userRow.role);
      if (!canUseBoardByRawRole_(board, rawRole)) {
        counters.skippedBoardAccess += 1;
        continue;
      }
      counters.eligibleUsers += 1;

      const boardPrefEnabled = getNotificationPrefEnabled_(uid, boardId);
      if (boardPrefEnabled === false) {
        counters.skippedBoardPref += 1;
        continue;
      }

      const notification = {
        userUid: uid,
        actorUid: actorUid,
        postId: postId,
        boardId: boardId,
        boardName: boardName,
        type: 'post',
        subtype: 'post_create',
        title: title,
        actorName: actorName,
        body: '',
        commentId: '',
        createdAtMs: createdAtMs,
        readAtMs: 0
      };
      const createResult = createNotificationDocIfAbsent_(uid, notificationId, notification);
      if (createResult === 'exists') {
        counters.skippedExists += 1;
      } else {
        counters.notificationsCreated += 1;
      }

      if (!isMobilePushEnabledForUser_(uid, boardId)) {
        counters.skippedPushPref += 1;
        continue;
      }

      const tokenRows = listEnabledPushTokens_(uid);
      if (!tokenRows.length) {
        counters.skippedNoToken += 1;
        continue;
      }

      const pushPayload = buildPushPayloadFromNotification_(notification, notificationId);
      const sendResult = sendPushToTokens_(uid, tokenRows, pushPayload);
      counters.sent += sendResult.sent;
      counters.failed += sendResult.failed;
      counters.removedTokens += sendResult.removedTokens;
    } catch (err) {
      counters.failedUsers += 1;
      console.error('[post-create-fanout-user-failed]', {
        uid: uid,
        postId: postId,
        boardId: boardId,
        error: normalizeText_(err && err.message)
      });
    }
  }

  counters.elapsedMs = Date.now() - startedAtMs;
  console.log('[relay-fanout-result]', counters);

  return counters;
}

function parseRequestJson_(e) {
  const raw = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '{}';
  const normalizedRaw = String(raw || '').trim();
  try {
    return JSON.parse(normalizedRaw);
  } catch (_) {
    // Fallback for form/urlencoded relay payloads.
    try {
      var parsed = {};
      normalizedRaw.split('&').forEach(function (pair) {
        if (!pair) return;
        var idx = pair.indexOf('=');
        var key = idx >= 0 ? pair.slice(0, idx) : pair;
        var value = idx >= 0 ? pair.slice(idx + 1) : '';
        parsed[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      });
      var candidate = normalizeText_(parsed.payload || parsed.body || parsed.json || '');
      if (!candidate) return {};
      return JSON.parse(candidate);
    } catch (_) {
      return {};
    }
  }
}

function parseRequestQueryPayload_(e) {
  const params = (e && e.parameter) || {};
  const payloadText = normalizeText_(params.payload || params.body || params.json);
  if (payloadText) {
    try {
      return JSON.parse(payloadText);
    } catch (_) {
      // Fall through to flat parameter parsing.
    }
  }

  const flat = {
    eventType: normalizeText_(params.eventType || params.type),
    idToken: normalizeText_(params.idToken),
    targetUid: normalizeText_(params.targetUid),
    notificationId: normalizeText_(params.notificationId),
    postId: normalizeText_(params.postId),
    boardId: normalizeText_(params.boardId),
    boardName: normalizeText_(params.boardName),
    title: normalizeText_(params.title),
    createdAtMs: Number(params.createdAtMs) || 0
  };

  if (!flat.idToken && !flat.eventType && !flat.notificationId && !flat.postId) {
    return null;
  }
  return flat;
}

function normalizeText_(value) {
  return String(value == null ? '' : value).trim();
}

function getScriptProperty_(key) {
  return normalizeText_(PropertiesService.getScriptProperties().getProperty(key));
}

function getRequiredScriptProperty_(key) {
  const value = getScriptProperty_(key);
  if (!value) {
    throw new Error('missing-script-property:' + key);
  }
  return value;
}

function verifyFirebaseIdToken_(idToken) {
  const webApiKey = getRequiredScriptProperty_(SCRIPT_PROP_KEY.FIREBASE_WEB_API_KEY);
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(webApiKey);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: idToken })
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('id-token-verify-failed:' + code);
  }
  const body = safeJsonParse_(res.getContentText()) || {};
  const users = Array.isArray(body.users) ? body.users : [];
  const first = users.length ? users[0] : null;
  return {
    uid: normalizeText_(first && first.localId),
    email: normalizeText_(first && first.email)
  };
}

function getServiceAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('mentor_forum_push_relay_access_token');
  if (cached) return cached;

  const clientEmail = getRequiredScriptProperty_(SCRIPT_PROP_KEY.GCP_SA_CLIENT_EMAIL);
  const privateKey = getRequiredScriptProperty_(SCRIPT_PROP_KEY.GCP_SA_PRIVATE_KEY).replace(/\\n/g, '\n');
  const nowSec = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: [FIRESTORE_SCOPE, FCM_SCOPE].join(' '),
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  };
  const jwt = createSignedJwt_(claim, privateKey);

  const tokenRes = UrlFetchApp.fetch(GOOGLE_TOKEN_URL, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }
  });
  const code = tokenRes.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('service-access-token-failed:' + code);
  }

  const tokenJson = safeJsonParse_(tokenRes.getContentText()) || {};
  const accessToken = normalizeText_(tokenJson.access_token);
  const expiresIn = Number(tokenJson.expires_in);
  if (!accessToken) {
    throw new Error('service-access-token-empty');
  }
  const ttlSec = Number.isFinite(expiresIn) ? Math.max(120, Math.floor(expiresIn) - 120) : 3300;
  cache.put('mentor_forum_push_relay_access_token', accessToken, ttlSec);
  return accessToken;
}

function createSignedJwt_(claim, privateKey) {
  const headerEncoded = base64UrlEncode_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimEncoded = base64UrlEncode_(JSON.stringify(claim));
  const unsigned = headerEncoded + '.' + claimEncoded;
  const signatureBytes = Utilities.computeRsaSha256Signature(unsigned, privateKey);
  const signatureEncoded = base64UrlEncode_(signatureBytes);
  return unsigned + '.' + signatureEncoded;
}

function base64UrlEncode_(input) {
  const bytes = Array.isArray(input)
    ? input
    : Utilities.newBlob(String(input)).getBytes();
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function firestoreDocPath_(segments) {
  return segments.map(function (part) {
    return encodeURIComponent(String(part));
  }).join('/');
}

function firestoreApiUrl_(segments, queryParams) {
  const projectId = getRequiredScriptProperty_(SCRIPT_PROP_KEY.FIREBASE_PROJECT_ID);
  const base = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents/';
  const docPath = firestoreDocPath_(segments);
  const query = [];
  const q = queryParams || {};
  Object.keys(q).forEach(function (key) {
    const value = q[key];
    if (value == null || value === '') return;
    query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return base + docPath + (query.length ? ('?' + query.join('&')) : '');
}

function firestoreRequest_(method, segments, body, queryParams) {
  const accessToken = getServiceAccessToken_();
  const options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + accessToken
    }
  };
  if (body != null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(firestoreApiUrl_(segments, queryParams), options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code === 404) return { status: 404, body: null };
  if (code < 200 || code >= 300) {
    throw new Error('firestore-request-failed:' + code + ':' + truncateText_(text, 240));
  }
  return { status: code, body: safeJsonParse_(text) };
}

function safeJsonParse_(text) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch (_) {
    return null;
  }
}

function truncateText_(text, maxLen) {
  const src = normalizeText_(text);
  if (src.length <= maxLen) return src;
  return src.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function decodeFirestoreValue_(valueObj) {
  if (!valueObj || typeof valueObj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(valueObj, 'stringValue')) return String(valueObj.stringValue || '');
  if (Object.prototype.hasOwnProperty.call(valueObj, 'booleanValue')) return !!valueObj.booleanValue;
  if (Object.prototype.hasOwnProperty.call(valueObj, 'integerValue')) return Number(valueObj.integerValue);
  if (Object.prototype.hasOwnProperty.call(valueObj, 'doubleValue')) return Number(valueObj.doubleValue);
  if (Object.prototype.hasOwnProperty.call(valueObj, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(valueObj, 'timestampValue')) return String(valueObj.timestampValue || '');
  if (Object.prototype.hasOwnProperty.call(valueObj, 'mapValue')) {
    return decodeFirestoreFields_(valueObj.mapValue && valueObj.mapValue.fields);
  }
  if (Object.prototype.hasOwnProperty.call(valueObj, 'arrayValue')) {
    const values = (valueObj.arrayValue && valueObj.arrayValue.values) || [];
    return values.map(function (entry) {
      return decodeFirestoreValue_(entry);
    });
  }
  return null;
}

function decodeFirestoreFields_(fieldsObj) {
  const out = {};
  const fields = fieldsObj || {};
  Object.keys(fields).forEach(function (key) {
    out[key] = decodeFirestoreValue_(fields[key]);
  });
  return out;
}

function decodeFirestoreDocument_(docObj) {
  if (!docObj || !docObj.name) return null;
  const fields = decodeFirestoreFields_(docObj.fields);
  fields.__name = String(docObj.name || '');
  const segments = fields.__name.split('/');
  fields.__id = segments.length ? segments[segments.length - 1] : '';
  return fields;
}

function getNotificationDoc_(targetUid, notificationId) {
  const res = firestoreRequest_('get', ['users', targetUid, 'notifications', notificationId]);
  if (!res.body) return null;
  return decodeFirestoreDocument_(res.body);
}

function getPostDoc_(postId) {
  const res = firestoreRequest_('get', ['posts', postId]);
  if (!res.body) return null;
  return decodeFirestoreDocument_(res.body);
}

function getBoardDoc_(boardId) {
  const res = firestoreRequest_('get', ['boards', boardId]);
  if (!res.body) return null;
  return decodeFirestoreDocument_(res.body);
}

function listAllUsers_() {
  var rows = [];
  var pageToken = '';
  var guard = 0;
  var seenPageTokens = {};

  while (guard < 1000) {
    guard += 1;
    var queryParams = {
      pageSize: 200
    };
    if (pageToken) queryParams.pageToken = pageToken;

    var res = firestoreRequest_('get', ['users'], null, queryParams);
    var docs = (res.body && Array.isArray(res.body.documents)) ? res.body.documents : [];
    rows = rows.concat(
      docs
        .map(function (docObj) {
          return decodeFirestoreDocument_(docObj);
        })
        .filter(function (doc) {
          return doc && normalizeText_(doc.__id);
        })
        .map(function (doc) {
          return {
            uid: normalizeText_(doc.__id),
            role: normalizeText_(doc.role)
          };
        })
    );

    var nextPageToken = normalizeText_(res.body && res.body.nextPageToken);
    if (!nextPageToken) break;
    if (nextPageToken === pageToken || seenPageTokens[nextPageToken]) {
      console.warn('[list-users-page-token-loop]', {
        guard: guard,
        currentTokenLength: pageToken.length,
        nextTokenLength: nextPageToken.length
      });
      break;
    }
    seenPageTokens[nextPageToken] = true;
    pageToken = nextPageToken;
  }
  return rows;
}

function getNotificationPrefEnabled_(targetUid, prefDocId) {
  const res = firestoreRequest_('get', ['users', targetUid, 'notification_prefs', prefDocId]);
  if (!res.body) return null;
  const doc = decodeFirestoreDocument_(res.body);
  if (!doc) return null;
  return doc.enabled !== false;
}

function isMobilePushEnabledForUser_(targetUid, boardId) {
  const globalEnabled = getNotificationPrefEnabled_(targetUid, MOBILE_PUSH_PREF_GLOBAL);
  if (globalEnabled === false) return false;
  const boardPrefId = MOBILE_PUSH_PREF_BOARD_PREFIX + encodeURIComponent(normalizeText_(boardId));
  const boardEnabled = getNotificationPrefEnabled_(targetUid, boardPrefId);
  if (boardEnabled === false) return false;
  return true;
}

function listEnabledPushTokens_(targetUid) {
  const res = firestoreRequest_('get', ['users', targetUid, 'push_tokens'], null, { pageSize: 100 });
  const docs = (res.body && Array.isArray(res.body.documents)) ? res.body.documents : [];
  return docs
    .map(function (docObj) {
      return decodeFirestoreDocument_(docObj);
    })
    .filter(function (doc) {
      return doc
        && normalizeText_(doc.token)
        && doc.enabled !== false
        && normalizeText_(doc.__id);
    })
    .map(function (doc) {
      return {
        docId: normalizeText_(doc.__id),
        token: normalizeText_(doc.token)
      };
    });
}

function compactRoleToken_(value) {
  return normalizeText_(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function canonicalCoreRole_(rawRole) {
  const token = compactRoleToken_(rawRole);
  if (token === 'superadmin' || token === '개발자') return 'Super_Admin';
  if (token === 'admin' || token === '관리자') return 'Admin';
  if (token === 'staff' || token === '운영진') return 'Staff';
  if (token === 'mentor' || token === '멘토' || token === '토') return 'Mentor';
  if (token === 'newbie' || token === '새싹') return 'Newbie';
  return '';
}

function boardRoleCandidatesByRaw_(rawRole) {
  const source = normalizeText_(rawRole);
  const core = canonicalCoreRole_(source);
  if (core === 'Super_Admin') return ['Super_Admin', 'SUPER_ADMIN', 'super_admin', 'super-admin', 'super admin', '개발자', source];
  if (core === 'Admin') return ['Admin', 'ADMIN', 'admin', '관리자', source];
  if (core === 'Staff') return ['Staff', 'STAFF', 'staff', '운영진', source];
  if (core === 'Mentor') return ['Mentor', 'MENTOR', 'mentor', '멘토', '토', source];
  if (core === 'Newbie') return ['Newbie', 'NEWBIE', 'newbie', '새싹', source];
  return source ? [source] : ['Newbie', 'NEWBIE', 'newbie', '새싹'];
}

function boardAllowsRawRole_(board, rawRole) {
  const allowedRoles = Array.isArray(board && board.allowedRoles) ? board.allowedRoles : [];
  const normalizedAllowed = allowedRoles
    .map(function (value) {
      return normalizeText_(value);
    })
    .filter(function (value) {
      return !!value;
    });

  if (!normalizedAllowed.length) return false;
  const candidates = boardRoleCandidatesByRaw_(rawRole);
  for (var i = 0; i < candidates.length; i += 1) {
    if (normalizedAllowed.indexOf(candidates[i]) >= 0) return true;
  }

  const canonical = canonicalCoreRole_(rawRole);
  if (!canonical) return false;
  for (var j = 0; j < normalizedAllowed.length; j += 1) {
    if (canonicalCoreRole_(normalizedAllowed[j]) === canonical) return true;
  }
  return false;
}

function canUseBoardByRawRole_(board, rawRole) {
  if (!board || board.isDivider === true) return false;
  return boardAllowsRawRole_(board, rawRole);
}

function encodeFirestoreValue_(value) {
  if (value == null) return { nullValue: null };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(function (entry) {
          return encodeFirestoreValue_(entry);
        })
      }
    };
  }

  var valueType = typeof value;
  if (valueType === 'string') return { stringValue: value };
  if (valueType === 'boolean') return { booleanValue: value };
  if (valueType === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (valueType === 'object') {
    return { mapValue: { fields: encodeFirestoreFields_(value) } };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields_(obj) {
  var fields = {};
  var source = obj || {};
  Object.keys(source).forEach(function (key) {
    var value = source[key];
    if (value === undefined) return;
    fields[key] = encodeFirestoreValue_(value);
  });
  return fields;
}

function createNotificationDocIfAbsent_(targetUid, notificationId, notification) {
  const nowIso = new Date().toISOString();
  const notificationDoc = {
    userUid: normalizeText_(targetUid),
    actorUid: normalizeText_(notification.actorUid),
    postId: normalizeText_(notification.postId),
    boardId: normalizeText_(notification.boardId),
    boardName: normalizeText_(notification.boardName),
    type: normalizeText_(notification.type) || 'post',
    subtype: normalizeText_(notification.subtype) || 'post_create',
    title: normalizeText_(notification.title) || '(제목 없음)',
    actorName: normalizeText_(notification.actorName) || '익명',
    body: normalizeText_(notification.body),
    commentId: normalizeText_(notification.commentId),
    createdAtMs: Number(notification.createdAtMs) || Date.now(),
    readAtMs: Number(notification.readAtMs) || 0,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const requestBody = {
    fields: encodeFirestoreFields_(notificationDoc)
  };
  try {
    firestoreRequest_(
      'patch',
      ['users', targetUid, 'notifications', notificationId],
      requestBody,
      { 'currentDocument.exists': 'false' }
    );
    return 'created';
  } catch (err) {
    const msg = normalizeText_(err && err.message).toLowerCase();
    if (msg.indexOf('firestore-request-failed:409') >= 0 || msg.indexOf('firestore-request-failed:412') >= 0) {
      return 'exists';
    }
    throw err;
  }
}

function buildPushPayloadFromNotification_(notification, notificationId) {
  const boardId = normalizeText_(notification.boardId);
  const boardName = normalizeText_(notification.boardName) || boardId;
  const postId = normalizeText_(notification.postId);
  const commentId = normalizeText_(notification.commentId);
  const subtype = normalizeText_(notification.subtype);
  const actorName = normalizeText_(notification.actorName) || '익명';
  const titleText = normalizeText_(notification.title) || '(제목 없음)';
  const bodyText = normalizeText_(notification.body) || fallbackPushBody_(subtype, actorName);
  const clickUrl = buildPostLink_(postId, boardId, commentId);

  return {
    title: '[' + boardName + '] ' + titleText,
    body: bodyText,
    data: {
      notificationId: normalizeText_(notificationId),
      mf_title: '[' + boardName + '] ' + titleText,
      mf_body: bodyText,
      actorName: actorName,
      boardId: boardId,
      postId: postId,
      commentId: commentId,
      subtype: subtype,
      url: clickUrl
    },
    clickUrl: clickUrl
  };
}

function fallbackPushBody_(subtype, actorName) {
  if (subtype === 'post_create') return actorName + '님이 새 게시글을 등록했습니다.';
  if (subtype === 'post_comment') return actorName + '님이 내 게시글에 댓글을 남겼습니다.';
  if (subtype === 'reply_comment') return actorName + '님이 내 댓글에 답글을 남겼습니다.';
  if (subtype === 'mention' || subtype === 'mention_all') return actorName + '님이 회원님을 언급했습니다.';
  return '새 알림이 도착했습니다.';
}

function buildPostLink_(postId, boardId, commentId) {
  const url = APP_BASE_URL + '/post?postId=' + encodeURIComponent(postId || '');
  const boardQuery = boardId
    ? '&boardId=' + encodeURIComponent(boardId) + '&fromBoardId=' + encodeURIComponent(boardId)
    : '';
  const commentQuery = commentId ? '&commentId=' + encodeURIComponent(commentId) : '';
  return url + boardQuery + commentQuery;
}

function sendPushToTokens_(targetUid, tokenRows, pushPayload) {
  const result = { sent: 0, failed: 0, removedTokens: 0 };
  const invalidDocIds = [];

  tokenRows.forEach(function (tokenRow) {
    const sendRes = sendFcmToSingleToken_(tokenRow.token, pushPayload);
    if (sendRes.ok) {
      result.sent += 1;
      return;
    }
    result.failed += 1;
    if (sendRes.invalidToken) {
      invalidDocIds.push(tokenRow.docId);
    }
  });

  invalidDocIds.forEach(function (docId) {
    try {
      firestoreRequest_('delete', ['users', targetUid, 'push_tokens', docId]);
      result.removedTokens += 1;
    } catch (_) {
      // Ignore cleanup failure.
    }
  });

  return result;
}

function sendFcmToSingleToken_(token, pushPayload) {
  const projectId = getRequiredScriptProperty_(SCRIPT_PROP_KEY.FIREBASE_PROJECT_ID);
  const accessToken = getServiceAccessToken_();
  const url = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/messages:send';
  const body = {
    message: {
      token: token,
      notification: {
        title: pushPayload.title,
        body: pushPayload.body
      },
      data: mapValuesToString_(pushPayload.data),
      webpush: {
        fcmOptions: {
          link: pushPayload.clickUrl
        },
        notification: {
          icon: '/favicon.png',
          badge: '/favicon.png',
          tag: 'mentor-forum:' + normalizeText_(pushPayload.data && pushPayload.data.notificationId),
          renotify: false
        },
        headers: {
          Urgency: 'high'
        }
      }
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
    payload: JSON.stringify(body)
  });
  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return { ok: true, invalidToken: false };
  }

  const text = res.getContentText();
  const invalidToken = /UNREGISTERED|invalid registration token|registration token is not a valid/i.test(text);
  console.warn('[send-fcm-failed]', code, truncateText_(text, 220));
  return {
    ok: false,
    invalidToken: invalidToken
  };
}

function mapValuesToString_(obj) {
  const out = {};
  const source = obj || {};
  Object.keys(source).forEach(function (key) {
    out[key] = String(source[key] == null ? '' : source[key]);
  });
  return out;
}

function jsonOutput_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
