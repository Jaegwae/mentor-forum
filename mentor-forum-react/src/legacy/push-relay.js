// Push relay client for GAS webhook integration.
import { MENTOR_FORUM_CONFIG } from './config.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function resolvePushRelayUrl() {
  return normalizeText(MENTOR_FORUM_CONFIG?.app?.pushRelayUrl || '');
}

export function pushRelayConfigured() {
  return !!resolvePushRelayUrl();
}

function detectIosPwa() {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '');
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    if (!isIos) return false;
    const standaloneByLegacy = navigator.standalone === true;
    const standaloneByMedia = typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
    return standaloneByLegacy || standaloneByMedia;
  } catch (_) {
    return false;
  }
}

function buildRelayFormBody(jsonText) {
  const form = new URLSearchParams();
  form.set('payload', String(jsonText || ''));
  return form;
}

function trySendBeacon(endpoint, formBody) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return false;
    }
    return navigator.sendBeacon(endpoint, formBody);
  } catch (_) {
    return false;
  }
}

async function trySendGetFallback(endpoint, jsonText) {
  try {
    const url = new URL(endpoint);
    url.searchParams.set('payload', jsonText);
    url.searchParams.set('relay_transport', 'get_fallback');
    await fetch(url.toString(), {
      method: 'GET',
      mode: 'no-cors',
      keepalive: true
    });
    return { ok: true, skipped: false, transport: 'get-fallback' };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      reason: err?.message || 'get-fallback-failed'
    };
  }
}

async function postToRelayEndpoint(body = {}) {
  const endpoint = resolvePushRelayUrl();
  if (!endpoint) return { ok: false, skipped: true, reason: 'relay-not-configured' };
  const jsonText = JSON.stringify(body);
  const formBody = buildRelayFormBody(jsonText);

  // iOS PWA has inconsistent cross-origin POST delivery.
  // Route through query relay (doGet payload path) for higher reliability.
  if (detectIosPwa()) {
    return trySendGetFallback(endpoint, jsonText);
  }

  // sendBeacon is stable on mobile Safari/PWA for fire-and-forget delivery.
  if (trySendBeacon(endpoint, formBody)) {
    return { ok: true, skipped: false, transport: 'beacon' };
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      body: formBody
    });
  } catch (err) {
    return trySendGetFallback(endpoint, jsonText);
  }
  if (response && response.type === 'opaque') {
    return { ok: true, skipped: false, opaque: true };
  }
  if (response && response.ok === false) {
    return trySendGetFallback(endpoint, jsonText);
  }
  return { ok: response ? response.ok !== false : true, skipped: false };
}

export async function sendPushRelayNotification(payload = {}) {
  const body = {
    idToken: normalizeText(payload.idToken),
    targetUid: normalizeText(payload.targetUid),
    notificationId: normalizeText(payload.notificationId)
  };

  if (!body.idToken || !body.targetUid || !body.notificationId) {
    return { ok: false, skipped: true, reason: 'invalid-payload' };
  }

  return postToRelayEndpoint(body);
}

export async function sendPushRelayPostCreate(payload = {}) {
  const body = {
    eventType: 'post_create_fanout',
    idToken: normalizeText(payload.idToken),
    postId: normalizeText(payload.postId),
    boardId: normalizeText(payload.boardId),
    createdAtMs: Number(payload.createdAtMs) || Date.now()
  };

  if (!body.idToken || !body.postId || !body.boardId) {
    return { ok: false, skipped: true, reason: 'invalid-payload' };
  }

  return postToRelayEndpoint(body);
}
