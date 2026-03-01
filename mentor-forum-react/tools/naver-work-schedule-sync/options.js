/**
 * Extension options page controller.
 * - Reads/writes sync config from background storage.
 * - Handles Firebase account connect/disconnect.
 * - Exposes manual "run sync now" trigger for operator validation.
 */
const el = {
  firebaseApiKey: document.getElementById('firebaseApiKey'),
  firebaseProjectId: document.getElementById('firebaseProjectId'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginBtn: document.getElementById('loginBtn'),
  clearAuthBtn: document.getElementById('clearAuthBtn'),
  authInfo: document.getElementById('authInfo'),
  menuUrl: document.getElementById('menuUrl'),
  targetArticleUrls: document.getElementById('targetArticleUrls'),
  cafeId: document.getElementById('cafeId'),
  menuId: document.getElementById('menuId'),
  maxArticles: document.getElementById('maxArticles'),
  autoEnabled: document.getElementById('autoEnabled'),
  scheduleHours: document.getElementById('scheduleHours'),
  saveBtn: document.getElementById('saveBtn'),
  syncNowBtn: document.getElementById('syncNowBtn'),
  status: document.getElementById('status')
};

function setStatus(text, tone = 'normal') {
  // Keep feedback consistent across all actions (save/login/sync).
  el.status.textContent = String(text || '');
  el.status.style.color = tone === 'error' ? '#b91c1c' : tone === 'ok' ? '#166534' : '#20342a';
}

function setAuthInfo(auth) {
  if (auth && auth.email) {
    el.authInfo.textContent = `연결됨: ${auth.email} (${auth.uid || '-'})`;
    return;
  }
  el.authInfo.textContent = '연결된 Firebase 계정이 없습니다.';
}

function parseHours(value) {
  // "0,6,12,18" -> [0,6,12,18], with guard rails.
  return String(value || '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23)
    .map((n) => Math.floor(n));
}

function parseTargetUrls(value) {
  // One URL per line; ignore invalid/non-http entries.
  return String(value || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => /^https?:\/\//i.test(v));
}

function fillConfig(config) {
  el.firebaseApiKey.value = config.firebaseApiKey || '';
  el.firebaseProjectId.value = config.firebaseProjectId || '';
  el.menuUrl.value = config.menuUrl || '';
  el.targetArticleUrls.value = Array.isArray(config.targetArticleUrls)
    ? config.targetArticleUrls.join('\n')
    : '';
  el.cafeId.value = config.cafeId || '';
  el.menuId.value = config.menuId || '';
  el.maxArticles.value = String(config.maxArticles || 5);
  el.autoEnabled.checked = !!config.autoEnabled;
  el.scheduleHours.value = Array.isArray(config.scheduleHours)
    ? config.scheduleHours.join(',')
    : '0,6,12,18';
}

async function sendMessage(type, payload = {}) {
  // All option actions are delegated to background.js via runtime message bus.
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || '요청 실패');
  }
  return response.result;
}

async function loadAll() {
  const result = await sendMessage('getStatus');
  fillConfig(result.config || {});
  setAuthInfo(result.auth || null);

  const status = result.status || {};
  const text = status.message || '상태 없음';
  const tone = String(text).includes('실패') ? 'error' : String(text).includes('완료') ? 'ok' : 'normal';
  setStatus(text, tone);
}

async function saveConfig() {
  const payload = {
    firebaseApiKey: el.firebaseApiKey.value.trim(),
    firebaseProjectId: el.firebaseProjectId.value.trim(),
    menuUrl: el.menuUrl.value.trim(),
    targetArticleUrls: parseTargetUrls(el.targetArticleUrls.value),
    cafeId: el.cafeId.value.trim(),
    menuId: el.menuId.value.trim(),
    maxArticles: Number(el.maxArticles.value || 5),
    autoEnabled: el.autoEnabled.checked,
    scheduleHours: parseHours(el.scheduleHours.value)
  };

  await sendMessage('saveConfig', payload);
  setStatus('설정이 저장되었습니다.', 'ok');
}

async function loginAuth() {
  const payload = {
    firebaseApiKey: el.firebaseApiKey.value.trim(),
    email: el.loginEmail.value.trim(),
    password: el.loginPassword.value
  };
  const result = await sendMessage('authLogin', payload);
  el.loginPassword.value = '';
  setAuthInfo(result);
  setStatus('Firebase 계정 연결이 완료되었습니다.', 'ok');
}

async function clearAuth() {
  await sendMessage('clearAuth', {});
  setAuthInfo(null);
  setStatus('계정 연결이 해제되었습니다.', 'ok');
}

async function runSyncNow() {
  setStatus('수동 동기화 실행 중...');
  const result = await sendMessage('runSyncNow', {});
  const text = result?.message || '실행 완료';
  const tone = String(text).includes('실패') ? 'error' : String(text).includes('완료') ? 'ok' : 'normal';
  setStatus(text, tone);
}

el.saveBtn.addEventListener('click', () => {
  saveConfig().catch((error) => setStatus(error.message, 'error'));
});

el.loginBtn.addEventListener('click', () => {
  loginAuth().catch((error) => setStatus(error.message, 'error'));
});

el.clearAuthBtn.addEventListener('click', () => {
  clearAuth().catch((error) => setStatus(error.message, 'error'));
});

el.syncNowBtn.addEventListener('click', () => {
  runSyncNow().catch((error) => setStatus(error.message, 'error'));
});

loadAll().catch((error) => setStatus(error.message, 'error'));
