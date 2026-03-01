/**
 * Naver Work Schedule Sync extension background worker (MV3).
 *
 * Responsibilities:
 * 1) Schedule/timer orchestration (00/06/12/18 slot checks in Asia/Seoul)
 * 2) Naver list/article scraping in temporary hidden tabs
 * 3) Firestore upsert into work_schedule board
 * 4) Optional shift-alert notification document fanout + relay trigger
 *
 * Note:
 * - Manual sync(force=true) bypasses schedule-window guards.
 * - Same-title article is now force-upserted (content-equality skip removed).
 */
const STORAGE_KEYS = {
  CONFIG: 'syncConfig',
  AUTH: 'syncAuthState',
  STATUS: 'syncStatus',
  LAST_SLOT: 'syncLastSlotKey'
};

const SYNC_ALARM = 'mentor_forum_naver_sync_tick';
const DEFAULT_TICK_MINUTES = 15;
const WORK_SCHEDULE_ALERT_PREF_KEY = 'pref_work_schedule_shift_alert';
const WORK_SCHEDULE_ALERT_SUBTYPE = 'work_schedule_shift_alert';
const DEFAULT_PUSH_RELAY_URL = 'https://script.google.com/macros/s/AKfycbyFoiPgFbVaNHr7wOmXVaDichgheQbzfhiwevt9fHYxqAX-lDAAUQ2Lj5mIuB0TNypq/exec';

const DEFAULT_CONFIG = {
  autoEnabled: true,
  timezone: 'Asia/Seoul',
  scheduleHours: [0, 6, 12, 18],
  menuUrl: 'https://cafe.naver.com/f-e/cafes/31673399/menus/5?viewType=L',
  targetArticleUrls: [],
  cafeId: '31673399',
  menuId: '5',
  maxArticles: 5,
  boardId: 'work_schedule',
  firebaseApiKey: 'AIzaSyCbvxhl6GhRi8nk6FgZtOYz6VwuAepEokI',
  firebaseProjectId: 'guro-mentor-forum',
  pushRelayUrl: DEFAULT_PUSH_RELAY_URL
};

let runningPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await ensureAlarm();
  // 브라우저 재시작 후 장시간 미수집 상태를 보정한다.
  runSync({ reason: 'startup-catchup', force: false }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  runSync({ reason: 'scheduled', force: false }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error || 'unknown error') });
    });
  return true;
});

async function handleMessage(message) {
  const type = String(message?.type || '');

  if (type === 'loadConfig') {
    return await getConfig();
  }

  if (type === 'saveConfig') {
    const next = normalizeConfig(message?.payload || {});
    await setConfig(next);
    await ensureAlarm();
    return next;
  }

  if (type === 'getStatus') {
    return await getStatus();
  }

  if (type === 'authLogin') {
    const apiKey = String(message?.payload?.firebaseApiKey || '').trim();
    const email = String(message?.payload?.email || '').trim();
    const password = String(message?.payload?.password || '');
    if (!apiKey || !email || !password) {
      throw new Error('API Key, 이메일, 비밀번호를 입력하세요.');
    }
    const auth = await signInWithEmailPassword(apiKey, email, password);
    await setAuthState({
      email,
      uid: auth.localId,
      refreshToken: auth.refreshToken,
      createdAtMs: Date.now()
    });
    return { email, uid: auth.localId };
  }

  if (type === 'clearAuth') {
    await clearAuthState();
    return { cleared: true };
  }

  if (type === 'runSyncNow') {
    return await runSync({ reason: 'manual', force: true });
  }

  throw new Error(`Unsupported message type: ${type}`);
}

async function ensureDefaults() {
  const config = await getConfig();
  if (!config || !Object.keys(config).length) {
    await setConfig(DEFAULT_CONFIG);
  }
}

async function ensureAlarm() {
  await chrome.alarms.clear(SYNC_ALARM);
  await chrome.alarms.create(SYNC_ALARM, {
    periodInMinutes: DEFAULT_TICK_MINUTES,
    when: Date.now() + 10_000
  });
}

function normalizeScheduleHours(values) {
  const list = Array.isArray(values)
    ? values
    : String(values || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

  const parsed = list
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23)
    .map((n) => Math.floor(n));

  const unique = [...new Set(parsed)];
  return unique.length ? unique.sort((a, b) => a - b) : [...DEFAULT_CONFIG.scheduleHours];
}

function normalizeUrlList(values) {
  const list = Array.isArray(values)
    ? values
    : String(values || '')
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);

  const normalized = list
    .map((url) => String(url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url));

  return [...new Set(normalized)];
}

function normalizeConfig(raw) {
  const next = {
    ...DEFAULT_CONFIG,
    ...(raw || {})
  };

  next.autoEnabled = Boolean(next.autoEnabled);
  next.timezone = String(next.timezone || DEFAULT_CONFIG.timezone).trim() || DEFAULT_CONFIG.timezone;
  next.scheduleHours = normalizeScheduleHours(next.scheduleHours);
  next.menuUrl = String(next.menuUrl || DEFAULT_CONFIG.menuUrl).trim() || DEFAULT_CONFIG.menuUrl;
  next.targetArticleUrls = normalizeUrlList(next.targetArticleUrls);
  next.cafeId = String(next.cafeId || DEFAULT_CONFIG.cafeId).trim() || DEFAULT_CONFIG.cafeId;
  next.menuId = String(next.menuId || DEFAULT_CONFIG.menuId).trim() || DEFAULT_CONFIG.menuId;
  next.maxArticles = Math.max(1, Math.min(20, Number(next.maxArticles) || DEFAULT_CONFIG.maxArticles));
  next.boardId = String(next.boardId || DEFAULT_CONFIG.boardId).trim() || DEFAULT_CONFIG.boardId;
  next.firebaseApiKey = String(next.firebaseApiKey || DEFAULT_CONFIG.firebaseApiKey).trim() || DEFAULT_CONFIG.firebaseApiKey;
  next.firebaseProjectId = String(next.firebaseProjectId || DEFAULT_CONFIG.firebaseProjectId).trim() || DEFAULT_CONFIG.firebaseProjectId;
  next.pushRelayUrl = String(next.pushRelayUrl || DEFAULT_CONFIG.pushRelayUrl).trim() || DEFAULT_CONFIG.pushRelayUrl;

  return next;
}

async function getConfig() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  return normalizeConfig(data[STORAGE_KEYS.CONFIG] || DEFAULT_CONFIG);
}

async function setConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: normalizeConfig(config) });
}

async function getAuthState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH);
  const state = data[STORAGE_KEYS.AUTH] || null;
  if (!state) return null;
  const refreshToken = String(state.refreshToken || '').trim();
  const uid = String(state.uid || '').trim();
  const email = String(state.email || '').trim();
  if (!refreshToken || !uid) return null;
  return { refreshToken, uid, email };
}

async function setAuthState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH]: state });
}

async function clearAuthState() {
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

async function getStatus() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.STATUS, STORAGE_KEYS.AUTH, STORAGE_KEYS.CONFIG]);
  return {
    config: normalizeConfig(data[STORAGE_KEYS.CONFIG] || DEFAULT_CONFIG),
    auth: data[STORAGE_KEYS.AUTH]
      ? { email: String(data[STORAGE_KEYS.AUTH].email || ''), uid: String(data[STORAGE_KEYS.AUTH].uid || '') }
      : null,
    status: data[STORAGE_KEYS.STATUS] || {
      running: false,
      lastRunAtMs: 0,
      lastReason: '',
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      message: '아직 실행되지 않았습니다.'
    }
  };
}

async function setStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATUS]: status });
}

function seoulDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const mapped = {};
  fmt.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') mapped[part.type] = part.value;
  });

  return {
    year: Number(mapped.year || 0),
    month: Number(mapped.month || 0),
    day: Number(mapped.day || 0),
    hour: Number(mapped.hour || 0),
    minute: Number(mapped.minute || 0),
    dateKey: `${mapped.year || '0000'}-${mapped.month || '00'}-${mapped.day || '00'}`,
    hourText: mapped.hour || '00'
  };
}

async function shouldRunSchedule(config) {
  // Scheduled mode guardrails. Manual mode(force=true) bypasses this block.
  if (!config.autoEnabled) {
    return { allowed: false, reason: '자동 동기화가 비활성화되어 있습니다.' };
  }

  const now = seoulDateParts(new Date());
  if (!config.scheduleHours.includes(now.hour)) {
    return { allowed: false, reason: '스케줄 시간이 아닙니다.' };
  }

  // 15분 tick 오차를 흡수하기 위해 정각+9분까지 허용.
  if (now.minute > 9) {
    return { allowed: false, reason: '스케줄 허용 분(00~09분) 범위를 벗어났습니다.' };
  }

  const slotKey = `${now.dateKey}-${now.hourText}`;
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_SLOT);
  const lastSlotKey = String(data[STORAGE_KEYS.LAST_SLOT] || '');
  if (slotKey === lastSlotKey) {
    return { allowed: false, reason: '이미 해당 시간 슬롯을 실행했습니다.' };
  }

  return { allowed: true, slotKey };
}

async function runSync({ reason = 'manual', force = false } = {}) {
  if (runningPromise) return runningPromise;

  runningPromise = (async () => {
    const config = await getConfig();
    const auth = await getAuthState();

    if (!auth) {
      const status = {
        running: false,
        lastRunAtMs: Date.now(),
        lastReason: reason,
        successCount: 0,
        skippedCount: 0,
        failedCount: 0,
        message: '로그인 정보가 없습니다. 옵션에서 Firebase 계정 연결이 필요합니다.'
      };
      await setStatus(status);
      return status;
    }

    if (!force) {
      const schedule = await shouldRunSchedule(config);
      if (!schedule.allowed) {
        return {
          running: false,
          lastRunAtMs: Date.now(),
          lastReason: reason,
          successCount: 0,
          skippedCount: 0,
          failedCount: 0,
          message: schedule.reason
        };
      }
    }

    await setStatus({
      running: true,
      lastRunAtMs: Date.now(),
      lastReason: reason,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      message: '동기화 실행 중...'
    });

    let slotKeyToSave = '';
    if (!force) {
      const schedule = await shouldRunSchedule(config);
      if (schedule.allowed) slotKeyToSave = schedule.slotKey;
    }

    try {
      const tokenState = await refreshIdToken(config.firebaseApiKey, auth.refreshToken);
      const uid = String(tokenState.userId || auth.uid || '').trim();
      const idToken = String(tokenState.idToken || '').trim();
      if (!uid || !idToken) throw new Error('Firebase 인증 토큰 갱신 실패');

      const profile = await fetchUserProfile({
        projectId: config.firebaseProjectId,
        uid,
        idToken
      });

      let sourceArticles = [];
      if (Array.isArray(config.targetArticleUrls) && config.targetArticleUrls.length) {
        sourceArticles = config.targetArticleUrls.map((url) => ({
          url,
          articleId: safeArticleIdFromUrl(url),
          title: ''
        }));
      } else {
        const listResult = await extractListArticles(config);
        sourceArticles = Array.isArray(listResult.articles) ? listResult.articles : [];
      }

      if (!sourceArticles.length) {
        const status = {
          running: false,
          lastRunAtMs: Date.now(),
          lastReason: reason,
          successCount: 0,
          skippedCount: 0,
          failedCount: 0,
          message: '가져올 게시글이 없습니다. (링크 설정/로그인 상태/메뉴 URL 확인)'
        };
        await setStatus(status);
        if (slotKeyToSave) {
          await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SLOT]: slotKeyToSave });
        }
        return status;
      }

      const detailedArticles = [];
      for (const article of sourceArticles) {
        const detail = await extractArticleDetail(article.url);
        const merged = { ...article, ...(detail || {}) };
        const resolvedArticleId = String(merged.articleId || safeArticleIdFromUrl(merged.url) || '').trim();
        if (!resolvedArticleId) continue;
        merged.articleId = resolvedArticleId;
        detailedArticles.push(merged);
      }

      const upsertResult = await upsertArticlesToFirestore({
        config,
        idToken,
        uid,
        authorName: profile.authorName,
        authorRole: profile.authorRole,
        articles: detailedArticles
      });

      const status = {
        running: false,
        lastRunAtMs: Date.now(),
        lastReason: reason,
        successCount: upsertResult.successCount,
        skippedCount: upsertResult.skippedCount,
        failedCount: upsertResult.failedCount,
        // Push scheduling/dispatch is intentionally handled by the server-side pipeline.
        // The browser extension is now responsible for work-schedule data sync only.
        message: `동기화 완료: 성공 ${upsertResult.successCount}, 스킵 ${upsertResult.skippedCount}, 실패 ${upsertResult.failedCount}`
      };

      await setStatus(status);
      if (slotKeyToSave) {
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SLOT]: slotKeyToSave });
      }
      return status;
    } catch (error) {
      const status = {
        running: false,
        lastRunAtMs: Date.now(),
        lastReason: reason,
        successCount: 0,
        skippedCount: 0,
        failedCount: 1,
        message: `동기화 실패: ${String(error?.message || error || 'unknown error')}`
      };
      await setStatus(status);
      return status;
    }
  })();

  try {
    return await runningPromise;
  } finally {
    runningPromise = null;
  }
}

async function signInWithEmailPassword(apiKey, email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || '로그인 실패');
  }
  return json;
}

async function refreshIdToken(apiKey, refreshToken) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);

  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || '토큰 갱신 실패');
  }

  return {
    idToken: json.id_token,
    userId: json.user_id,
    refreshToken: json.refresh_token
  };
}

function safeArticleIdFromUrl(url) {
  const raw = String(url || '');
  const patterns = [
    /\/ca-fe\/cafes\/\d+\/articles\/(\d+)/i,
    /[?&]articleid=(\d+)/i,
    /\/ArticleRead\.nhn.*[?&]articleid=(\d+)/i
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m && m[1]) return String(m[1]);
  }
  return '';
}

function sanitizeText(value, max = 20000) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function sanitizeHtmlForStorage(value, max = 250000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

function simpleHash(text) {
  const source = String(text || '');
  let hash = 0;
  for (let idx = 0; idx < source.length; idx += 1) {
    hash = ((hash * 31) + source.charCodeAt(idx)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function waitForTabComplete(tabId, timeoutMs = 30_000) {
  const start = Date.now();
  const initial = await chrome.tabs.get(tabId);
  if (initial.status === 'complete') return;

  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setInterval(async () => {
      if (done) return;
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          done = true;
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          done = true;
          clearInterval(timer);
          reject(new Error('탭 로딩 타임아웃'));
        }
      } catch (err) {
        done = true;
        clearInterval(timer);
        reject(err);
      }
    }, 300);
  });
}

async function runInTempTab(url, func, args = []) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id, 35_000);
    await sleep(1200);
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args
    });
    return result?.[0]?.result;
  } finally {
    if (tab?.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractListArticles(config) {
  let listResult = await runInTempTab(config.menuUrl, extractListFromPage, [
    { cafeId: config.cafeId, maxArticles: config.maxArticles }
  ]);

  if (listResult && listResult.iframeSrc) {
    const iframeUrl = toAbsoluteUrl(config.menuUrl, listResult.iframeSrc);
    if (iframeUrl) {
      listResult = await runInTempTab(iframeUrl, extractListFromPage, [
        { cafeId: config.cafeId, maxArticles: config.maxArticles }
      ]);
    }
  }

  return listResult || { articles: [] };
}

async function extractArticleDetail(url) {
  let detail = await runInTempTab(url, extractArticleDetailFromPage, []);

  if (detail && detail.iframeSrc) {
    const iframeUrl = toAbsoluteUrl(url, detail.iframeSrc);
    if (iframeUrl) {
      detail = await runInTempTab(iframeUrl, extractArticleDetailFromPage, []);
    }
  }

  return detail || null;
}

function toAbsoluteUrl(base, target) {
  try {
    return new URL(String(target || ''), String(base || '')).toString();
  } catch (_) {
    return '';
  }
}

function extractListFromPage(args) {
  const safeArgs = args || {};
  const maxArticles = Math.max(1, Math.min(20, Number(safeArgs.maxArticles) || 5));
  const cafeId = String(safeArgs.cafeId || '').trim();

  const iframeEl = document.querySelector('iframe#cafe_main, iframe[name="cafe_main"]');
  if (iframeEl && iframeEl.src) {
    return {
      iframeSrc: iframeEl.src,
      articles: []
    };
  }

  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const seen = new Set();
  const articles = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || '';
    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, location.href).toString();
    } catch (_) {
      continue;
    }

    if (!absoluteUrl.includes('cafe.naver.com')) continue;

    const articleId = (() => {
      const patterns = [
        /\/ca-fe\/cafes\/(\d+)\/articles\/(\d+)/i,
        /[?&]articleid=(\d+)/i,
        /\/ArticleRead\.nhn.*[?&]articleid=(\d+)/i
      ];

      for (const pattern of patterns) {
        const m = absoluteUrl.match(pattern);
        if (!m) continue;
        if (m.length >= 3) {
          const detectedCafeId = String(m[1] || '');
          const detectedArticleId = String(m[2] || '');
          if (cafeId && detectedCafeId && cafeId !== detectedCafeId) return '';
          return detectedArticleId;
        }
        if (m.length >= 2) return String(m[1] || '');
      }
      return '';
    })();

    if (!articleId) continue;
    if (seen.has(articleId)) continue;
    seen.add(articleId);

    const title = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
    articles.push({
      articleId,
      url: absoluteUrl,
      title: title || ''
    });

    if (articles.length >= maxArticles) break;
  }

  return {
    iframeSrc: '',
    articles
  };
}

function extractArticleDetailFromPage() {
  const BODY_SELECTORS = [
    '#tbody',
    '.se-main-container',
    '.article_viewer',
    '.ContentRenderer',
    '#postViewArea',
    '.article_container'
  ];
  const pickText = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  };

  const pickBodyElement = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const pickBody = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const text = String(el.innerText || el.textContent || '')
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text) return text;
    }
    return '';
  };

  const pickBodyHtml = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const html = String(el.innerHTML || '')
        .replace(/\u0000/g, '')
        .trim();
      if (html) return html;
    }
    return '';
  };

  const normalizeCellText = (value) => {
    const text = String(value || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[，、]/g, ',')
      .replace(/\s*\n+\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/\s*[,;]\s*/g, ',')
      .trim();
    if (!text) return '';
    return text
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .join(', ')
      .replace(/[,;\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const splitEducationParts = (value) => {
    const raw = normalizeCellText(value);
    if (!raw) return { member: '', education: '' };

    const educationParts = [];
    let memberRaw = raw;
    memberRaw = memberRaw.replace(/[([]\s*교육\s*[:：]\s*([^\)\]]+)\s*[)\]]/gi, (_matched, captured) => {
      educationParts.push(normalizeCellText(captured));
      return ' ';
    });
    memberRaw = memberRaw.replace(/(?:^|[\s,;])교육\s*[:：]\s*([^,;]+)/gi, (_matched, captured) => {
      educationParts.push(normalizeCellText(captured));
      return ' ';
    });

    return {
      member: normalizeCellText(memberRaw),
      education: normalizeCellText(educationParts.join(', '))
    };
  };

  const parseYearMonthFromTitle = (value) => {
    const titleText = String(value || '');
    const m = titleText.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (month < 1 || month > 12) return null;
    return { year, month };
  };

  const pad2 = (value) => String(value).padStart(2, '0');
  const buildDateKey = (year, month, day) => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
    if (month < 1 || month > 12) return '';
    if (day < 1 || day > 31) return '';
    return `${String(year)}-${pad2(month)}-${pad2(day)}`;
  };

  const parseDateKeyFromCell = (rawValue, fallbackYearMonth) => {
    const text = normalizeCellText(rawValue)
      .replace(/[.]/g, '/')
      .replace(/-/g, '/')
      .replace(/\s+/g, '');
    if (!text) return '';

    let m = text.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
    if (m) return buildDateKey(Number(m[1]), Number(m[2]), Number(m[3]));

    m = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const year = Number(fallbackYearMonth?.year || new Date().getFullYear());
      return buildDateKey(year, Number(m[1]), Number(m[2]));
    }

    m = text.match(/^(\d{1,2})$/);
    if (m && fallbackYearMonth?.year && fallbackYearMonth?.month) {
      return buildDateKey(Number(fallbackYearMonth.year), Number(fallbackYearMonth.month), Number(m[1]));
    }

    return '';
  };

  const expandRowCells = (row) => {
    const cells = [];
    Array.from(row?.children || []).forEach((cellEl) => {
      const text = normalizeCellText(cellEl?.innerText || cellEl?.textContent || '');
      const colSpanRaw = Number(cellEl?.getAttribute?.('colspan') || 1);
      const colSpan = Number.isFinite(colSpanRaw) && colSpanRaw > 0 ? Math.floor(colSpanRaw) : 1;
      for (let idx = 0; idx < colSpan; idx += 1) {
        cells.push(text);
      }
    });
    return cells;
  };

  const findScheduleColumnIndex = (labels, candidates) => {
    const normalized = labels.map((label) => String(label || '').replace(/\s+/g, '').toLowerCase());
    for (let idx = 0; idx < normalized.length; idx += 1) {
      const label = normalized[idx];
      if (!label) continue;
      if (candidates.some((candidate) => label.includes(candidate))) return idx;
    }
    return -1;
  };

  const extractScheduleRows = (rootEl, titleText) => {
    if (!rootEl) return [];
    const tables = Array.from(rootEl.querySelectorAll('table'));
    if (!tables.length) return [];

    const fallbackYearMonth = parseYearMonthFromTitle(titleText);

    for (const table of tables) {
      const tableRows = Array.from(table.querySelectorAll('tr'));
      if (tableRows.length < 2) continue;

      let headerIndex = -1;
      let dateCol = -1;
      let weekdayCol = -1;
      let fullTimeCol = -1;
      let part1Col = -1;
      let part2Col = -1;
      let part3Col = -1;
      let educationCol = -1;

      for (let idx = 0; idx < Math.min(tableRows.length, 8); idx += 1) {
        const labels = expandRowCells(tableRows[idx]);
        if (!labels.length) continue;
        const maybeDateCol = findScheduleColumnIndex(labels, ['날짜']);
        const maybeFullTimeCol = findScheduleColumnIndex(labels, ['풀타임']);
        const maybePart1Col = findScheduleColumnIndex(labels, ['파트1']);
        const maybePart2Col = findScheduleColumnIndex(labels, ['파트2']);
        const maybePart3Col = findScheduleColumnIndex(labels, ['파트3']);
        const maybeEducationCol = findScheduleColumnIndex(labels, ['교육']);
        if (maybeDateCol < 0) continue;
        if (maybeFullTimeCol < 0 && maybePart1Col < 0 && maybePart2Col < 0 && maybePart3Col < 0 && maybeEducationCol < 0) continue;

        headerIndex = idx;
        dateCol = maybeDateCol;
        weekdayCol = findScheduleColumnIndex(labels, ['요일']);
        fullTimeCol = maybeFullTimeCol;
        part1Col = maybePart1Col;
        part2Col = maybePart2Col;
        part3Col = maybePart3Col;
        educationCol = maybeEducationCol;
        break;
      }

      if (headerIndex < 0 || dateCol < 0) continue;

      const rows = [];
      for (let idx = headerIndex + 1; idx < tableRows.length; idx += 1) {
        const values = expandRowCells(tableRows[idx]);
        if (!values.length) continue;
        const dateRaw = values[dateCol] || '';
        const dateKey = parseDateKeyFromCell(dateRaw, fallbackYearMonth);
        if (!dateKey) continue;

        const fullTimeParts = splitEducationParts(fullTimeCol >= 0 ? values[fullTimeCol] || '' : '');
        const part1Parts = splitEducationParts(part1Col >= 0 ? values[part1Col] || '' : '');
        const part2Parts = splitEducationParts(part2Col >= 0 ? values[part2Col] || '' : '');
        const part3Parts = splitEducationParts(part3Col >= 0 ? values[part3Col] || '' : '');
        const educationRaw = educationCol >= 0 ? values[educationCol] || '' : '';
        const educationParts = splitEducationParts(educationRaw);

        const row = {
          dateKey,
          dateLabel: normalizeCellText(dateRaw),
          weekday: weekdayCol >= 0 ? normalizeCellText(values[weekdayCol] || '') : '',
          fullTime: fullTimeParts.member,
          part1: part1Parts.member,
          part2: part2Parts.member,
          part3: part3Parts.member,
          education: normalizeCellText([
            educationParts.member,
            educationParts.education,
            fullTimeParts.education,
            part1Parts.education,
            part2Parts.education,
            part3Parts.education
          ].join(', '))
        };

        if (!row.fullTime && !row.part1 && !row.part2 && !row.part3 && !row.education) continue;
        rows.push(row);
      }

      if (rows.length) return rows;
    }

    return [];
  };

  const iframeEl = document.querySelector('iframe#cafe_main, iframe[name="cafe_main"]');
  if (iframeEl && iframeEl.src) {
    return {
      iframeSrc: iframeEl.src,
      articleId: '',
      title: '',
      updatedAtText: '',
      bodyText: '',
      bodyHtml: '',
      scheduleRows: []
    };
  }

  const url = location.href;
  const idPatterns = [
    /\/ca-fe\/cafes\/\d+\/articles\/(\d+)/i,
    /[?&]articleid=(\d+)/i,
    /\/ArticleRead\.nhn.*[?&]articleid=(\d+)/i
  ];

  let articleId = '';
  for (const pattern of idPatterns) {
    const m = url.match(pattern);
    if (m && m[1]) {
      articleId = String(m[1]);
      break;
    }
  }

  const title = pickText([
    '.article_title',
    '.ArticleContentBox .title_text',
    'h3.title_text',
    '.title_area .title',
    'h1, h2, h3'
  ]);

  const updatedAtText = pickText([
    '.article_info .date',
    '.WriterInfo .date',
    '.article_head .date',
    '.date'
  ]);
  const bodyEl = pickBodyElement(BODY_SELECTORS);

  const bodyText = pickBody(BODY_SELECTORS);
  const bodyHtml = pickBodyHtml(BODY_SELECTORS);
  const scheduleRows = extractScheduleRows(bodyEl, title);

  return {
    iframeSrc: '',
    articleId,
    title,
    updatedAtText,
    bodyText,
    bodyHtml,
    scheduleRows
  };
}

async function fetchUserProfile({ projectId, uid, idToken }) {
  const doc = await getFirestoreDoc({
    projectId,
    docPath: `users/${encodeURIComponent(uid)}`,
    idToken
  });

  const fields = doc?.fields || {};
  const nickname = fromFirestoreValue(fields.nickname) || '';
  const realName = fromFirestoreValue(fields.realName) || '';
  const email = fromFirestoreValue(fields.email) || '';
  const role = fromFirestoreValue(fields.role) || 'Staff';

  const authorName = String(nickname || realName || email || uid).trim();
  return {
    authorName,
    authorRole: String(role || 'Staff')
  };
}

function sanitizeWorkScheduleRowsForStorage(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byDateKey = new Map();

  const normalizeMemberText = (value) => {
    const text = sanitizeText(value || '', 200)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[，、]/g, ',')
      .replace(/\s+/g, ' ')
      .replace(/\s*[,;]\s*/g, ',')
      .trim();
    if (!text) return '';
    return text
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .join(', ')
      .replace(/[,;\s]+$/g, '');
  };

  source.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const dateKey = String(row.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

    const nextRow = {
      dateKey,
      dateLabel: sanitizeText(row.dateLabel || '', 32),
      weekday: sanitizeText(row.weekday || '', 12),
      fullTime: normalizeMemberText(row.fullTime || ''),
      part1: normalizeMemberText(row.part1 || ''),
      part2: normalizeMemberText(row.part2 || ''),
      part3: normalizeMemberText(row.part3 || ''),
      education: normalizeMemberText(row.education || '')
    };

    if (!byDateKey.has(dateKey)) {
      byDateKey.set(dateKey, nextRow);
      return;
    }

    const existing = byDateKey.get(dateKey);
    byDateKey.set(dateKey, {
      dateKey,
      dateLabel: existing.dateLabel || nextRow.dateLabel,
      weekday: existing.weekday || nextRow.weekday,
      fullTime: existing.fullTime || nextRow.fullTime,
      part1: existing.part1 || nextRow.part1,
      part2: existing.part2 || nextRow.part2,
      part3: existing.part3 || nextRow.part3,
      education: existing.education || nextRow.education
    });
  });

  return [...byDateKey.values()].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey), 'ko'));
}

async function upsertArticlesToFirestore({ config, idToken, uid, authorName, authorRole, articles }) {
  let successCount = 0;
  // `skippedCount` now means "invalid/unreadable source article" only.
  // Content-equality skip is intentionally removed per 운영 요구사항(강제 덮어쓰기).
  let skippedCount = 0;
  let failedCount = 0;
  const processedArticles = [];

  for (const article of articles) {
    try {
      const articleId = safeArticleIdFromUrl(article.url) || String(article.articleId || '').trim();
      if (!articleId) {
        skippedCount += 1;
        continue;
      }

      const bodyText = sanitizeText(article.bodyText || '', 30_000);
      const bodyHtml = sanitizeHtmlForStorage(article.bodyHtml || '', 250_000);
      const titleText = sanitizeText(article.title || '', 120);
      const updatedAtText = sanitizeText(article.updatedAtText || '', 80);
      const docId = `naver_cafe_${sanitizeId(config.cafeId)}_${sanitizeId(articleId)}`;
      const fallbackDocPath = `posts/${encodeURIComponent(docId)}`;
      const canonicalTitle = titleText ? `[근무일정] ${titleText}` : '[근무일정] (제목 없음)';
      const sourceHash = simpleHash(`${titleText}\n${bodyText}\n${bodyHtml}`);
      const sourceBodyHtmlHash = simpleHash(bodyHtml);
      const workScheduleRows = sanitizeWorkScheduleRowsForStorage(article.scheduleRows);
      const sourceWorkScheduleRowsHash = simpleHash(JSON.stringify(workScheduleRows));

      // 사용자 요구사항:
      // 1) 같은 제목이 이미 존재하면 해당 게시글 문서를 찾는다.
      // 2) 찾은 문서가 있으면 항상 덮어쓴다(내용 비교 skip 없음).
      const titleMatchedDocPath = await findPostDocPathByBoardAndTitle({
        projectId: config.firebaseProjectId,
        boardId: config.boardId,
        title: canonicalTitle,
        idToken
      }).catch(() => '');

      const docPath = titleMatchedDocPath || fallbackDocPath;

      const existingDoc = await getFirestoreDoc({ projectId: config.firebaseProjectId, docPath, idToken });
      const existing = firestoreDocToPlain(existingDoc);

      const nowIso = new Date().toISOString();
      const createdAtIso = typeof existing.createdAt === 'string' && existing.createdAt
        ? existing.createdAt
        : nowIso;

      const payload = {
        boardId: config.boardId,
        title: canonicalTitle,
        visibility: 'mentor',
        contentText: bodyText || '(본문 없음)',
        contentHtml: bodyHtml || '',
        contentRich: {
          text: bodyText || '(본문 없음)',
          runs: []
        },
        contentDelta: {
          ops: [
            { insert: `${bodyText || '(본문 없음)'}\n` }
          ]
        },
        authorUid: uid,
        authorName,
        authorRole,
        createdAt: createdAtIso,
        updatedAt: nowIso,
        deleted: false,
        views: Number.isFinite(Number(existing.views)) ? Number(existing.views) : 0,
        isPinned: Boolean(existing.isPinned),
        pinnedAt: existing.pinnedAt || null,
        pinnedAtMs: Number.isFinite(Number(existing.pinnedAtMs)) ? Number(existing.pinnedAtMs) : 0,
        pinnedByUid: String(existing.pinnedByUid || ''),
        sourceType: 'naver_cafe',
        sourceCafeId: String(config.cafeId || ''),
        sourceMenuId: String(config.menuId || ''),
        sourceArticleId: String(articleId),
        sourceArticleUrl: String(article.url || ''),
        sourceTitle: titleText,
        sourceUpdatedAtText: updatedAtText,
        sourceBodyHash: sourceHash,
        sourceBodyHtmlHash,
        sourceWorkScheduleRowsHash,
        sourceFetchedAtMs: Date.now(),
        // Parsed rows are stored for calendar rendering / shift-alert pipeline.
        workScheduleRows,
        workScheduleDateKeys: workScheduleRows.map((row) => row.dateKey)
      };

      await commitFirestoreDoc({
        projectId: config.firebaseProjectId,
        docPath,
        plainData: payload,
        idToken
      });

      successCount += 1;
      processedArticles.push({
        status: 'success',
        articleId: String(articleId),
        docPath,
        postId: decodeURIComponent(String(docPath).split('/').pop() || ''),
        title: canonicalTitle,
        sourceArticleUrl: String(article.url || ''),
        workScheduleRows
      });
    } catch (_err) {
      failedCount += 1;
    }
  }

  return { successCount, skippedCount, failedCount, articles: processedArticles };
}

function normalizeNameToken(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase()
    .trim();
}

function includesNameToken(text, nameToken) {
  const token = normalizeNameToken(nameToken);
  if (!token || token.length < 2) return false;
  const source = normalizeNameToken(text);
  if (!source) return false;
  return source.includes(token);
}

function formatDateLabelFromDateKey(dateKey, fallbackLabel = '') {
  const fallback = sanitizeText(fallbackLabel, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return fallback || '-';
  const parts = String(dateKey).split('-');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return fallback || '-';
  return `${month}/${day}`;
}

function summarizeRoleMatches(row, realName) {
  const fields = [
    { key: 'fullTime', label: '풀타임' },
    { key: 'part1', label: '파트1' },
    { key: 'part2', label: '파트2' },
    { key: 'part3', label: '파트3' },
    { key: 'education', label: '교육' }
  ];

  const matches = [];
  fields.forEach((field) => {
    const value = sanitizeText(row?.[field.key] || '', 160);
    if (!value) return;
    if (!includesNameToken(value, realName)) return;
    matches.push(`${field.label}: ${value}`);
  });
  return matches;
}

function addDaysToDateKey(dateKey, days) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  const next = new Date(year, month - 1, day + Number(days || 0));
  if (Number.isNaN(next.getTime())) return '';
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function listUsersForWorkScheduleAlerts({ projectId, idToken }) {
  const rows = await runFirestoreStructuredQuery({
    projectId,
    idToken,
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      limit: 2000
    }
  });

  const users = [];
  rows.forEach((row) => {
    const doc = row?.document;
    if (!doc?.name) return;
    const docPath = docNameToDocPath(projectId, doc.name);
    const uid = String(docPath || '').split('/')[1] || '';
    if (!uid) return;
    const fields = doc.fields || {};
    const realName = sanitizeText(fromFirestoreValue(fields.realName) || '', 40);
    if (!realName) return;
    users.push({
      uid,
      realName
    });
  });

  return users;
}

async function listWorkScheduleAlertPrefByUser({ projectId, idToken }) {
  const rows = await runFirestoreStructuredQuery({
    projectId,
    idToken,
    structuredQuery: {
      from: [{ collectionId: 'notification_prefs', allDescendants: true }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'boardId' },
          op: 'EQUAL',
          value: { stringValue: WORK_SCHEDULE_ALERT_PREF_KEY }
        }
      },
      limit: 4000
    }
  });

  const prefByUser = new Map();
  rows.forEach((row) => {
    const doc = row?.document;
    if (!doc?.name) return;
    const docPath = docNameToDocPath(projectId, doc.name);
    const pathParts = String(docPath || '').split('/');
    const uid = pathParts[0] === 'users' ? String(pathParts[1] || '') : '';
    if (!uid) return;
    const fields = doc.fields || {};
    const enabledValue = fromFirestoreValue(fields.enabled);
    prefByUser.set(uid, enabledValue !== false);
  });
  return prefByUser;
}

function buildWorkScheduleNotificationId({ articleId, uid, dateKey, phase }) {
  return `work_schedule_${sanitizeId(articleId)}_${sanitizeId(dateKey)}_${sanitizeId(phase)}_${sanitizeId(uid)}`;
}

async function sendPushRelayNotificationFromExtension({ pushRelayUrl, idToken, targetUid, notificationId }) {
  const endpoint = String(pushRelayUrl || '').trim();
  if (!endpoint) return { ok: false, skipped: true, reason: 'relay-not-configured' };

  const payload = JSON.stringify({
    idToken: String(idToken || '').trim(),
    targetUid: String(targetUid || '').trim(),
    notificationId: String(notificationId || '').trim()
  });
  if (!payload) return { ok: false, skipped: true, reason: 'invalid-payload' };

  const body = new URLSearchParams();
  body.set('payload', payload);

  try {
    await fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      body
    });
    return { ok: true, skipped: false };
  } catch (_err) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('payload', payload);
      url.searchParams.set('relay_transport', 'get_fallback');
      await fetch(url.toString(), {
        method: 'GET',
        mode: 'no-cors'
      });
      return { ok: true, skipped: false };
    } catch (err) {
      return { ok: false, skipped: false, reason: String(err?.message || err || 'relay-failed') };
    }
  }
}

async function dispatchWorkScheduleAlerts({
  config,
  idToken,
  actorUid,
  actorName,
  upsertedArticles
}) {
  const result = {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    relaySentCount: 0
  };

  const articles = Array.isArray(upsertedArticles) ? upsertedArticles : [];
  const candidates = articles
    .filter((item) => item && Array.isArray(item.workScheduleRows) && item.workScheduleRows.length)
    .map((item) => ({
      ...item,
      workScheduleRows: sanitizeWorkScheduleRowsForStorage(item.workScheduleRows)
    }))
    .filter((item) => item.workScheduleRows.length);

  if (!candidates.length) return result;

  let users = [];
  try {
    users = await listUsersForWorkScheduleAlerts({
      projectId: config.firebaseProjectId,
      idToken
    });
  } catch (_err) {
    return result;
  }
  if (!users.length) return result;

  let prefByUser = new Map();
  try {
    prefByUser = await listWorkScheduleAlertPrefByUser({
      projectId: config.firebaseProjectId,
      idToken
    });
  } catch (_err) {
    prefByUser = new Map();
  }

  const todayKey = seoulDateParts(new Date()).dateKey;
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const targetPhaseByDateKey = new Map([
    [todayKey, 'today'],
    [tomorrowKey, 'tomorrow']
  ]);

  for (const article of candidates) {
    const safeArticleId = String(article.articleId || '').trim();
    const safePostId = String(article.postId || '').trim();
    if (!safePostId) continue;

    for (const row of article.workScheduleRows) {
      const dateKey = String(row?.dateKey || '').trim();
      const phase = targetPhaseByDateKey.get(dateKey);
      if (!phase) continue;

      for (const user of users) {
        const uid = String(user.uid || '').trim();
        const realName = sanitizeText(user.realName || '', 40);
        if (!uid || !realName) continue;
        if (prefByUser.has(uid) && prefByUser.get(uid) === false) continue;

        const roleMatches = summarizeRoleMatches(row, realName);
        if (!roleMatches.length) continue;

        const phaseLabel = phase === 'today' ? '당일' : '전날';
        const dateLabel = formatDateLabelFromDateKey(dateKey, row?.dateLabel || '');
        const weekday = sanitizeText(row?.weekday || '', 12);
        const bodyParts = [
          `${phaseLabel} 근무 알림`,
          `${dateLabel}${weekday ? ` (${weekday})` : ''}`,
          roleMatches.join(' / ')
        ].filter(Boolean);
        const body = sanitizeText(bodyParts.join(' · '), 220);
        const title = `[근무일정] ${dateLabel} 근무 안내`;
        const notificationId = buildWorkScheduleNotificationId({
          articleId: safeArticleId || safePostId,
          uid,
          dateKey,
          phase
        });
        const docPath = `users/${encodeURIComponent(uid)}/notifications/${encodeURIComponent(notificationId)}`;

        try {
          const existingDoc = await getFirestoreDoc({
            projectId: config.firebaseProjectId,
            docPath,
            idToken
          });
          const existing = firestoreDocToPlain(existingDoc);
          const nowIso = new Date().toISOString();
          const createdAtIso = typeof existing.createdAt === 'string' && existing.createdAt
            ? existing.createdAt
            : nowIso;
          const createdAtMs = Date.now();

          const sameContent = !!existingDoc
            && String(existing.body || '') === body
            && String(existing.title || '') === title
            && String(existing.postId || '') === safePostId
            && String(existing.boardId || '') === String(config.boardId || '');
          if (sameContent) {
            result.skippedCount += 1;
            continue;
          }

          await commitFirestoreDoc({
            projectId: config.firebaseProjectId,
            docPath,
            idToken,
            plainData: {
              userUid: uid,
              actorUid: String(actorUid || '').trim(),
              actorName: sanitizeText(actorName || '근무일정 동기화', 60),
              type: 'post',
              subtype: WORK_SCHEDULE_ALERT_SUBTYPE,
              postId: safePostId,
              commentId: '',
              boardId: String(config.boardId || '').trim(),
              boardName: '근무일정',
              title,
              body,
              createdAtMs,
              readAtMs: 0,
              createdAt: createdAtIso,
              updatedAt: nowIso
            }
          });

          if (existingDoc) result.updatedCount += 1;
          else result.createdCount += 1;

          const relay = await sendPushRelayNotificationFromExtension({
            pushRelayUrl: config.pushRelayUrl,
            idToken,
            targetUid: uid,
            notificationId
          });
          if (relay.ok) result.relaySentCount += 1;
        } catch (_err) {
          result.failedCount += 1;
        }
      }
    }
  }

  return result;
}

function sanitizeId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}

function docNameToDocPath(projectId, docName) {
  const prefix = `projects/${projectId}/databases/(default)/documents/`;
  const name = String(docName || '');
  if (!name.startsWith(prefix)) return '';
  return name.slice(prefix.length);
}

async function runFirestoreStructuredQuery({ projectId, structuredQuery, idToken }) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ structuredQuery })
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || 'Firestore runQuery failed');
  }

  return Array.isArray(json) ? json : [];
}

async function findPostDocPathByBoardAndTitle({ projectId, boardId, title, idToken }) {
  const safeBoardId = String(boardId || '').trim();
  const safeTitle = String(title || '').trim();
  if (!safeBoardId || !safeTitle) return '';

  const rows = await runFirestoreStructuredQuery({
    projectId,
    idToken,
    structuredQuery: {
      from: [{ collectionId: 'posts' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'boardId' },
                op: 'EQUAL',
                value: { stringValue: safeBoardId }
              }
            },
            {
              fieldFilter: {
                field: { fieldPath: 'title' },
                op: 'EQUAL',
                value: { stringValue: safeTitle }
              }
            }
          ]
        }
      },
      limit: 1
    }
  });

  for (const row of rows) {
    const docName = row?.document?.name;
    const docPath = docNameToDocPath(projectId, docName);
    if (docPath) return docPath;
  }
  return '';
}

async function getFirestoreDoc({ projectId, docPath, idToken }) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${docPath}`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${idToken}`
    }
  });

  if (res.status === 404) return null;

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || 'Firestore document fetch failed');
  }

  return json;
}

async function commitFirestoreDoc({ projectId, docPath, plainData, idToken }) {
  const docName = `projects/${projectId}/databases/(default)/documents/${decodeURIComponent(docPath)}`;
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;

  const body = {
    writes: [
      {
        update: {
          name: docName,
          fields: toFirestoreFields(plainData)
        }
      }
    ]
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || 'Firestore commit failed');
  }
  return json;
}

function toFirestoreFields(obj) {
  const fields = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    const firestoreValue = toFirestoreValue(value);
    if (firestoreValue) {
      fields[key] = firestoreValue;
    }
  });
  return fields;
}

function toFirestoreValue(value) {
  if (value === undefined) return null;
  if (value === null) return { nullValue: null };

  if (typeof value === 'string') {
    // RFC3339 형태는 timestampValue로 저장한다.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && value.endsWith('Z')) {
      return { timestampValue: value };
    }
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item)).filter(Boolean)
      }
    };
  }

  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(value)
      }
    };
  }

  return { stringValue: String(value) };
}

function firestoreDocToPlain(doc) {
  if (!doc || !doc.fields) return {};
  const out = {};
  Object.entries(doc.fields).forEach(([key, value]) => {
    out[key] = fromFirestoreValue(value);
  });
  return out;
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return !!value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue || 0);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue || 0);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return String(value.timestampValue || '');

  if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map((item) => fromFirestoreValue(item));
  }

  if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
    const out = {};
    const fields = value.mapValue?.fields || {};
    Object.entries(fields).forEach(([key, inner]) => {
      out[key] = fromFirestoreValue(inner);
    });
    return out;
  }

  return null;
}
