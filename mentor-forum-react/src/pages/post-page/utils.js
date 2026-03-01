// PostPage pure helpers and formatting utilities.
// Keep this file React-free so mention parsing, role normalization, and content
// rendering helpers can be reasoned about and reused safely.
import { db, doc } from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { renderRichDeltaToHtml, renderRichPayloadToHtml, sanitizeHttpUrl } from '../../legacy/rich-editor.js';
import {
  ALL_BOARD_ID,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  COVER_FOR_DEFAULT_END_TIME,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_VENUE,
  COVER_FOR_STATUS,
  CORE_ROLE_LEVELS,
  LAST_BOARD_STORAGE_KEY,
  NOTICE_BOARD_ID,
  NOTIFICATION_TYPE,
  ROLE_KEY_ALIASES
} from './constants.js';

const ALLOWED_STORED_HTML_TAGS = new Set([
  'a',
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col'
]);

function sanitizeSpanAttr(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed)) return '';
  return String(Math.max(1, Math.min(40, parsed)));
}

function sanitizeStoredHtmlNode(node, ownerDocument) {
  if (!node || !ownerDocument) return null;

  if (node.nodeType === 3) {
    return ownerDocument.createTextNode(String(node.textContent || ''));
  }

  if (node.nodeType !== 1) return null;

  const tagName = String(node.nodeName || '').toLowerCase();
  const sanitizedChildren = [];
  Array.from(node.childNodes || []).forEach((child) => {
    const next = sanitizeStoredHtmlNode(child, ownerDocument);
    if (!next) return;
    sanitizedChildren.push(next);
  });

  if (!ALLOWED_STORED_HTML_TAGS.has(tagName)) {
    const fragment = ownerDocument.createDocumentFragment();
    sanitizedChildren.forEach((child) => fragment.appendChild(child));
    return fragment;
  }

  const safeEl = ownerDocument.createElement(tagName);
  if (tagName === 'a') {
    const safeHref = sanitizeHttpUrl(node.getAttribute('href') || '');
    if (safeHref) {
      safeEl.setAttribute('href', safeHref);
      safeEl.setAttribute('target', '_blank');
      safeEl.setAttribute('rel', 'noopener noreferrer');
    }
  }

  if (tagName === 'td' || tagName === 'th') {
    const colspan = sanitizeSpanAttr(node.getAttribute('colspan'));
    const rowspan = sanitizeSpanAttr(node.getAttribute('rowspan'));
    const scope = normalizeText(node.getAttribute('scope')).toLowerCase();
    if (colspan) safeEl.setAttribute('colspan', colspan);
    if (rowspan) safeEl.setAttribute('rowspan', rowspan);
    if (scope === 'row' || scope === 'col') safeEl.setAttribute('scope', scope);
  }

  if (tagName === 'col') {
    const span = sanitizeSpanAttr(node.getAttribute('span'));
    if (span) safeEl.setAttribute('span', span);
  }

  sanitizedChildren.forEach((child) => safeEl.appendChild(child));
  return safeEl;
}

export function sanitizeStoredContentHtml(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (typeof DOMParser !== 'function' || typeof document === 'undefined') return '';

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(raw, 'text/html');
    const host = document.createElement('div');
    Array.from(parsed.body?.childNodes || []).forEach((node) => {
      const sanitized = sanitizeStoredHtmlNode(node, document);
      if (!sanitized) return;
      host.appendChild(sanitized);
    });
    return String(host.innerHTML || '').trim();
  } catch (_) {
    return '';
  }
}

export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function normalizeText(value) {
  return String(value || '').trim();
}

export function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(userAgent);
  const desktopIpadUa = /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
  const viewportNarrow = window.matchMedia('(max-width: 900px)').matches || window.innerWidth <= 900;
  const shortestScreen = Math.min(
    Number(window.screen?.width || 0),
    Number(window.screen?.height || 0)
  );
  const screenLooksMobile = shortestScreen > 0 && shortestScreen <= 1024;

  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const hoverNone = window.matchMedia('(hover: none)').matches || window.matchMedia('(any-hover: none)').matches;
  const touchLikeInput = maxTouchPoints > 0 || anyCoarse || hoverNone;

  if (mobileUa || desktopIpadUa || viewportNarrow) return true;
  if (touchLikeInput && screenLooksMobile) return true;

  const desktopLike = hoverFine && pointerFine && !touchLikeInput;
  return !desktopLike;
}

export function stripHtmlToText(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\s+/g, ' ')
    .trim();
  return text;
}

export function isTruthyLegacyValue(value) {
  if (value === true || value === 1) return true;
  const text = normalizeText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'y' || text === 'yes';
}

export function isDeletedPost(post) {
  return !!post && isTruthyLegacyValue(post.deleted);
}

export function normalizeErrMessage(err, fallback) {
  const code = err && err.code ? String(err.code) : '';
  if (code.includes('permission-denied')) {
    return '권한 오류입니다. 현재 등급에서 허용되지 않은 작업입니다.';
  }
  return (err && err.message) ? err.message : fallback;
}

export function isPermissionDeniedError(err) {
  const code = err && err.code ? String(err.code) : '';
  return code.includes('permission-denied');
}

export function shouldLogDebugPayload() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return window.__MENTOR_DEBUG__ === true;
}

export function logErrorWithOptionalDebug(tag, error, debugPayload) {
  if (shouldLogDebugPayload() && debugPayload) {
    console.error(tag, debugPayload);
    return;
  }
  console.error(tag, error);
}

export function debugValueList(values) {
  if (!Array.isArray(values)) return '-';
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalized.length ? normalized.join(',') : '-';
}

export function debugCodePoints(value) {
  const raw = String(value ?? '');
  if (!raw) return '-';
  return Array.from(raw)
    .map((char) => `U+${(char.codePointAt(0) || 0).toString(16).toUpperCase()}`)
    .join(',');
}

export function joinDebugParts(parts) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' | ');
}

export function boardAccessDebugText(boardAccess, profile) {
  return joinDebugParts([
    `boardId=${normalizeText(boardAccess?.boardId) || '-'}`,
    `boardName=${normalizeText(boardAccess?.boardName) || '-'}`,
    `boardExists=${boardAccess?.boardExists ? 'Y' : 'N'}`,
    `isDivider=${boardAccess?.isDivider ? 'Y' : 'N'}`,
    `allowedRoles=${debugValueList(boardAccess?.allowedRoles)}`,
    `boardCanRead=${boardAccess?.allowed ? 'Y' : 'N'}`,
    `boardCanWrite=${boardAccess?.canWrite ? 'Y' : 'N'}`,
    `myRole=${normalizeText(profile?.role) || '-'}`,
    `myRawRole=${normalizeText(profile?.rawRole || profile?.role) || '-'}`
  ]);
}

export function readLastBoardId() {
  try {
    const value = normalizeText(window.sessionStorage.getItem(LAST_BOARD_STORAGE_KEY));
    return value === ALL_BOARD_ID ? '' : value;
  } catch (_) {
    return '';
  }
}

export function writeLastBoardId(boardId) {
  const normalized = normalizeText(boardId);
  if (!normalized || normalized === ALL_BOARD_ID) return;
  try {
    window.sessionStorage.setItem(LAST_BOARD_STORAGE_KEY, normalized);
  } catch (_) {
    // Ignore storage failure.
  }
}

export function isCoverForBoardId(boardId) {
  const normalized = normalizeText(boardId);
  return normalized === COVER_FOR_BOARD_ID || normalized === WORK_SCHEDULE_BOARD_ID;
}

export function toDateKey(value) {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromDateKey(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

export function formatDateKeyLabel(key) {
  const date = fromDateKey(key);
  if (!date) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}. ${m}. ${d}.`;
}

export function normalizeDateKeyInput(value) {
  const key = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const parsed = fromDateKey(key);
  if (!parsed) return '';
  return toDateKey(parsed);
}

function normalizeWorkScheduleCellText(value) {
  const text = String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
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
    .replace(/[,;\s]+$/g, '');
}

function splitWorkScheduleEducationParts(value) {
  const raw = normalizeWorkScheduleCellText(value);
  if (!raw) return { member: '', education: '' };

  const educationParts = [];
  let memberRaw = raw;
  memberRaw = memberRaw.replace(/[([]\s*교육\s*[:：]\s*([^\)\]]+)\s*[)\]]/gi, (_matched, captured) => {
    educationParts.push(normalizeWorkScheduleCellText(captured));
    return ' ';
  });
  memberRaw = memberRaw.replace(/(?:^|[\s,;])교육\s*[:：]\s*([^,;]+)/gi, (_matched, captured) => {
    educationParts.push(normalizeWorkScheduleCellText(captured));
    return ' ';
  });

  return {
    member: normalizeWorkScheduleCellText(memberRaw),
    education: normalizeWorkScheduleCellText(educationParts.join(', '))
  };
}

function parseWorkScheduleYearMonthFromTitle(titleText) {
  const match = String(titleText || '').match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function buildDateKey(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseWorkScheduleDateKeyFromCell(rawValue, fallbackYearMonth) {
  const text = normalizeWorkScheduleCellText(rawValue)
    .replace(/[.]/g, '/')
    .replace(/-/g, '/')
    .replace(/\s+/g, '');
  if (!text) return '';

  let match = text.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
  if (match) return buildDateKey(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const year = Number(fallbackYearMonth?.year || new Date().getFullYear());
    return buildDateKey(year, Number(match[1]), Number(match[2]));
  }

  match = text.match(/^(\d{1,2})$/);
  if (match && fallbackYearMonth?.year && fallbackYearMonth?.month) {
    return buildDateKey(Number(fallbackYearMonth.year), Number(fallbackYearMonth.month), Number(match[1]));
  }

  return '';
}

function expandWorkScheduleRowCells(rowEl) {
  const cells = [];
  Array.from(rowEl?.children || []).forEach((cellEl) => {
    const text = normalizeWorkScheduleCellText(cellEl?.textContent || '');
    const colSpanRaw = Number(cellEl?.getAttribute?.('colspan') || 1);
    const colSpan = Number.isFinite(colSpanRaw) && colSpanRaw > 0 ? Math.floor(colSpanRaw) : 1;
    for (let idx = 0; idx < colSpan; idx += 1) cells.push(text);
  });
  return cells;
}

function findWorkScheduleColumnIndex(labels, candidates) {
  const normalized = labels.map((label) => String(label || '').replace(/\s+/g, '').toLowerCase());
  for (let idx = 0; idx < normalized.length; idx += 1) {
    const label = normalized[idx];
    if (!label) continue;
    if (candidates.some((candidate) => label.includes(candidate))) return idx;
  }
  return -1;
}

function mergeWorkScheduleRowsByDate(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byDateKey = new Map();

  source.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const dateKey = normalizeDateKeyInput(row.dateKey || '');
    if (!dateKey) return;
    const nextRow = {
      dateKey,
      dateLabel: normalizeWorkScheduleCellText(row.dateLabel || ''),
      weekday: normalizeWorkScheduleCellText(row.weekday || ''),
      fullTime: normalizeWorkScheduleCellText(row.fullTime || ''),
      part1: normalizeWorkScheduleCellText(row.part1 || ''),
      part2: normalizeWorkScheduleCellText(row.part2 || ''),
      part3: normalizeWorkScheduleCellText(row.part3 || ''),
      education: normalizeWorkScheduleCellText(row.education || '')
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

export function extractWorkScheduleRowsFromHtml(html, titleText = '') {
  const sourceHtml = String(html || '').trim();
  if (!sourceHtml) return { hasTable: false, rows: [] };
  if (typeof DOMParser !== 'function') return { hasTable: /<table[\s>]/i.test(sourceHtml), rows: [] };

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(sourceHtml, 'text/html');
    const tables = Array.from(parsed.querySelectorAll('table'));
    const hasTable = tables.length > 0;
    if (!hasTable) return { hasTable: false, rows: [] };

    const fallbackYearMonth = parseWorkScheduleYearMonthFromTitle(titleText);
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
        const labels = expandWorkScheduleRowCells(tableRows[idx]);
        if (!labels.length) continue;
        const maybeDateCol = findWorkScheduleColumnIndex(labels, ['날짜']);
        const maybeFullTimeCol = findWorkScheduleColumnIndex(labels, ['풀타임']);
        const maybePart1Col = findWorkScheduleColumnIndex(labels, ['파트1']);
        const maybePart2Col = findWorkScheduleColumnIndex(labels, ['파트2']);
        const maybePart3Col = findWorkScheduleColumnIndex(labels, ['파트3']);
        const maybeEducationCol = findWorkScheduleColumnIndex(labels, ['교육']);
        if (maybeDateCol < 0) continue;
        if (maybeFullTimeCol < 0 && maybePart1Col < 0 && maybePart2Col < 0 && maybePart3Col < 0 && maybeEducationCol < 0) continue;

        headerIndex = idx;
        dateCol = maybeDateCol;
        weekdayCol = findWorkScheduleColumnIndex(labels, ['요일']);
        fullTimeCol = maybeFullTimeCol;
        part1Col = maybePart1Col;
        part2Col = maybePart2Col;
        part3Col = maybePart3Col;
        educationCol = maybeEducationCol;
        break;
      }

      if (headerIndex < 0 || dateCol < 0) continue;

      const rows = [];
      for (let rowIdx = headerIndex + 1; rowIdx < tableRows.length; rowIdx += 1) {
        const values = expandWorkScheduleRowCells(tableRows[rowIdx]);
        if (!values.length) continue;

        const dateRaw = values[dateCol] || '';
        const dateKey = parseWorkScheduleDateKeyFromCell(dateRaw, fallbackYearMonth);
        if (!dateKey) continue;

        const fullTimeParts = splitWorkScheduleEducationParts(fullTimeCol >= 0 ? values[fullTimeCol] || '' : '');
        const part1Parts = splitWorkScheduleEducationParts(part1Col >= 0 ? values[part1Col] || '' : '');
        const part2Parts = splitWorkScheduleEducationParts(part2Col >= 0 ? values[part2Col] || '' : '');
        const part3Parts = splitWorkScheduleEducationParts(part3Col >= 0 ? values[part3Col] || '' : '');
        const educationRaw = educationCol >= 0 ? values[educationCol] || '' : '';
        const educationParts = splitWorkScheduleEducationParts(educationRaw);

        const row = {
          dateKey,
          dateLabel: normalizeWorkScheduleCellText(dateRaw),
          weekday: weekdayCol >= 0 ? normalizeWorkScheduleCellText(values[weekdayCol] || '') : '',
          fullTime: fullTimeParts.member,
          part1: part1Parts.member,
          part2: part2Parts.member,
          part3: part3Parts.member,
          education: normalizeWorkScheduleCellText([
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

      const merged = mergeWorkScheduleRowsByDate(rows);
      if (merged.length) return { hasTable: true, rows: merged };
    }

    return { hasTable: true, rows: [] };
  } catch (_) {
    return { hasTable: /<table[\s>]/i.test(sourceHtml), rows: [] };
  }
}

function escapeWorkScheduleHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function weekdayKoFromDateKey(dateKey) {
  const parsed = fromDateKey(dateKey);
  if (!parsed) return '';
  const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return labels[parsed.getDay()] || '';
}

export function normalizeEditableWorkScheduleRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const normalizedRows = source
    .map((row) => {
      const dateKey = normalizeDateKeyInput(row?.dateKey || row?.date || row?.dayKey || '');
      if (!dateKey) return null;
      const parsed = fromDateKey(dateKey);
      const weekdayAuto = weekdayKoFromDateKey(dateKey);
      const dateLabelAuto = parsed ? `${parsed.getMonth() + 1}/${parsed.getDate()}` : '';
      return {
        dateKey,
        dateLabel: normalizeWorkScheduleCellText(row?.dateLabel || row?.dateText || '') || dateLabelAuto,
        weekday: normalizeWorkScheduleCellText(row?.weekday || row?.dayOfWeek || row?.day || '') || weekdayAuto,
        fullTime: normalizeWorkScheduleCellText(row?.fullTime || row?.fulltime || row?.full || ''),
        part1: normalizeWorkScheduleCellText(row?.part1 || ''),
        part2: normalizeWorkScheduleCellText(row?.part2 || ''),
        part3: normalizeWorkScheduleCellText(row?.part3 || ''),
        education: normalizeWorkScheduleCellText(row?.education || '')
      };
    })
    .filter(Boolean);

  return mergeWorkScheduleRowsByDate(normalizedRows);
}

export function buildWorkScheduleTableHtml(rows) {
  const normalizedRows = normalizeEditableWorkScheduleRows(rows);
  if (!normalizedRows.length) return '';

  const hasEducation = normalizedRows.some((row) => normalizeWorkScheduleCellText(row.education));
  const headCells = [
    '<th>날짜</th>',
    '<th>요일</th>',
    '<th>풀타임</th>',
    '<th>파트1</th>',
    '<th>파트2</th>',
    '<th>파트3</th>'
  ];
  if (hasEducation) headCells.push('<th>교육</th>');

  const bodyRows = normalizedRows.map((row) => {
    const cells = [
      `<td>${escapeWorkScheduleHtml(row.dateLabel || row.dateKey)}</td>`,
      `<td>${escapeWorkScheduleHtml(row.weekday || weekdayKoFromDateKey(row.dateKey))}</td>`,
      `<td>${escapeWorkScheduleHtml(row.fullTime || '')}</td>`,
      `<td>${escapeWorkScheduleHtml(row.part1 || '')}</td>`,
      `<td>${escapeWorkScheduleHtml(row.part2 || '')}</td>`,
      `<td>${escapeWorkScheduleHtml(row.part3 || '')}</td>`
    ];
    if (hasEducation) cells.push(`<td>${escapeWorkScheduleHtml(row.education || '')}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  });

  return [
    '<table>',
    `<thead><tr>${headCells.join('')}</tr></thead>`,
    `<tbody>${bodyRows.join('')}</tbody>`,
    '</table>'
  ].join('');
}

export function replaceWorkScheduleTableInHtml(baseHtml, rows) {
  const tableHtml = buildWorkScheduleTableHtml(rows);
  if (!tableHtml) return '';
  const base = String(baseHtml || '').trim();

  if (typeof DOMParser !== 'function') {
    return base ? `${base}\n${tableHtml}` : tableHtml;
  }

  try {
    const parser = new DOMParser();
    const parsedBase = parser.parseFromString(base || '<div></div>', 'text/html');
    const parsedTable = parser.parseFromString(tableHtml, 'text/html');
    const nextTable = parsedTable.querySelector('table');
    if (!nextTable) return base || tableHtml;

    const currentTable = parsedBase.querySelector('table');
    if (currentTable) {
      currentTable.outerHTML = nextTable.outerHTML;
    } else {
      parsedBase.body.insertAdjacentHTML('beforeend', nextTable.outerHTML);
    }
    return String(parsedBase.body?.innerHTML || '').trim();
  } catch (_) {
    return base ? `${base}\n${tableHtml}` : tableHtml;
  }
}

function normalizeEditableTableCell(value) {
  // Normalization goal: keep user-visible value stable while preventing
  // accidental diff noise from invisible chars/newline formatting.
  return String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandEditableTableRowCells(rowEl) {
  // Expand colspan into virtual cells so the editor can treat rows as a
  // rectangular matrix when loading arbitrary HTML tables.
  const cells = [];
  Array.from(rowEl?.children || []).forEach((cellEl) => {
    const text = normalizeEditableTableCell(cellEl?.textContent || '');
    const colSpanRaw = Number(cellEl?.getAttribute?.('colspan') || 1);
    const colSpan = Number.isFinite(colSpanRaw) && colSpanRaw > 0 ? Math.floor(colSpanRaw) : 1;
    for (let idx = 0; idx < colSpan; idx += 1) cells.push(text);
  });
  return cells;
}

export function normalizeEditableTableGrid(rows) {
  // Guarantee a rectangular 2D array. This simplifies edit operations
  // (add/remove column, drag row reorder, direct cell updates).
  const source = Array.isArray(rows) ? rows : [];
  const normalizedRows = source
    .map((row) => {
      if (!Array.isArray(row)) return null;
      return row.map((cell) => normalizeEditableTableCell(cell));
    })
    .filter(Boolean);

  const maxColumns = Math.max(1, ...normalizedRows.map((row) => row.length || 0));
  if (!normalizedRows.length) return [['']];

  return normalizedRows.map((row) => {
    const cells = [...row];
    while (cells.length < maxColumns) cells.push('');
    return cells.slice(0, Math.max(1, maxColumns));
  });
}

export function extractEditableTableGridFromHtml(html) {
  // Extract only the first visible table shape into editable grid rows.
  // Parsing failure should never block editor open; caller can show fallback.
  const sourceHtml = String(html || '').trim();
  if (!sourceHtml) return { hasTable: false, rows: [] };
  if (typeof DOMParser !== 'function') return { hasTable: /<table[\s>]/i.test(sourceHtml), rows: [] };

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(sourceHtml, 'text/html');
    const table = parsed.querySelector('table');
    if (!table) return { hasTable: false, rows: [] };

    const rows = Array.from(table.querySelectorAll('tr'))
      .map((rowEl) => expandEditableTableRowCells(rowEl))
      .filter((row) => row.length > 0);

    return {
      hasTable: true,
      rows: normalizeEditableTableGrid(rows)
    };
  } catch (_) {
    return { hasTable: /<table[\s>]/i.test(sourceHtml), rows: [] };
  }
}

export function buildEditableTableHtmlFromGrid(rows) {
  // row[0] is persisted as <thead>, row[1..] as <tbody>.
  const grid = normalizeEditableTableGrid(rows);
  if (!grid.length) return '';

  const head = grid[0] || [''];
  const body = grid.slice(1);
  const headerHtml = `<thead><tr>${head.map((cell) => `<th>${escapeWorkScheduleHtml(cell)}</th>`).join('')}</tr></thead>`;
  const bodyHtml = body.length
    ? `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeWorkScheduleHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '<tbody></tbody>';

  return `<table>${headerHtml}${bodyHtml}</table>`;
}

export function replaceFirstTableInHtml(baseHtml, rows) {
  // Replace first table only to preserve non-table prose before/after table.
  const tableHtml = buildEditableTableHtmlFromGrid(rows);
  if (!tableHtml) return String(baseHtml || '').trim();
  const base = String(baseHtml || '').trim();

  if (typeof DOMParser !== 'function') {
    return base ? `${base}\n${tableHtml}` : tableHtml;
  }

  try {
    const parser = new DOMParser();
    const parsedBase = parser.parseFromString(base || '<div></div>', 'text/html');
    const parsedTable = parser.parseFromString(tableHtml, 'text/html');
    const nextTable = parsedTable.querySelector('table');
    if (!nextTable) return base || tableHtml;

    const currentTable = parsedBase.querySelector('table');
    if (currentTable) {
      currentTable.outerHTML = nextTable.outerHTML;
    } else {
      parsedBase.body.insertAdjacentHTML('beforeend', nextTable.outerHTML);
    }
    return String(parsedBase.body?.innerHTML || '').trim();
  } catch (_) {
    return base ? `${base}\n${tableHtml}` : tableHtml;
  }
}

export function notificationDocRef(uid, notificationId) {
  return doc(db, 'users', normalizeText(uid), 'notifications', normalizeText(notificationId));
}

export function viewedPostDocRef(uid, postId) {
  return doc(db, 'users', normalizeText(uid), 'viewed_posts', normalizeText(postId));
}

export function normalizeNotificationType(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === NOTIFICATION_TYPE.COMMENT) return NOTIFICATION_TYPE.COMMENT;
  if (type === NOTIFICATION_TYPE.MENTION) return NOTIFICATION_TYPE.MENTION;
  return NOTIFICATION_TYPE.POST;
}

export function normalizeNickname(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

export function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

export function extractMentionNicknames(text) {
  const source = String(text || '');
  const regex = /(^|\s)@([^\s@]{1,20})/g;
  const unique = new Set();
  let match = regex.exec(source);
  while (match) {
    const nickname = normalizeNickname(match[2]);
    if (nickname) unique.add(nickname);
    match = regex.exec(source);
  }
  return [...unique];
}

export function hasAllMentionCommand(text) {
  const source = String(text || '');
  return /(^|\s)@all(?=\s|$)/i.test(source);
}

export function detectMentionContext(text, cursorIndex) {
  const source = String(text || '');
  const safeCursor = Math.max(0, Math.min(source.length, Math.floor(Number(cursorIndex) || 0)));
  const head = source.slice(0, safeCursor);
  const match = head.match(/(?:^|\s)@([^\s@]{0,20})$/);
  if (!match) return null;
  const token = String(match[0] || '');
  const mentionStart = safeCursor - token.length + (token.startsWith('@') ? 0 : 1);
  return {
    start: mentionStart,
    end: safeCursor,
    query: normalizeNickname(match[1] || '')
  };
}

export function notificationIdForEvent(type, postId, commentId, targetUid) {
  const safeType = normalizeText(type) || 'event';
  const safePostId = normalizeText(postId) || 'post';
  const safeCommentId = normalizeText(commentId) || 'root';
  const safeTargetUid = normalizeText(targetUid) || 'target';
  return [safeType, safePostId, safeCommentId, safeTargetUid]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

export function toNotificationBodySnippet(text, maxLength = 110) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function normalizeCoverForVenue(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

export function normalizeTimeInput(value) {
  const text = normalizeText(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return '';
  return text;
}

export function timeValueToMinutes(value) {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return -1;
  const [hourText, minuteText] = normalized.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return (hour * 60) + minute;
}

export function isValidTimeRange(startTimeValue, endTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  const endMinutes = timeValueToMinutes(endTimeValue);
  return startMinutes >= 0 && endMinutes > startMinutes;
}

export function suggestEndTime(startTimeValue) {
  const startMinutes = timeValueToMinutes(startTimeValue);
  if (startMinutes < 0) return COVER_FOR_DEFAULT_END_TIME;
  const nextMinutes = startMinutes + 30;
  if (nextMinutes >= 24 * 60) return '23:59';
  const hour = String(Math.floor(nextMinutes / 60)).padStart(2, '0');
  const minute = String(nextMinutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function normalizeCoverForStatus(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === COVER_FOR_STATUS.COMPLETED) return COVER_FOR_STATUS.COMPLETED;
  if (raw === COVER_FOR_STATUS.CANCELLED) return COVER_FOR_STATUS.CANCELLED;
  return COVER_FOR_STATUS.SEEKING;
}

export function coverForStatusLabel(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  if (status === COVER_FOR_STATUS.COMPLETED) return '완료';
  if (status === COVER_FOR_STATUS.CANCELLED) return '취소';
  return '구하는 중';
}

export function isClosedCoverForStatus(statusValue) {
  const status = normalizeCoverForStatus(statusValue);
  return status === COVER_FOR_STATUS.COMPLETED || status === COVER_FOR_STATUS.CANCELLED;
}

export function normalizeCoverForDateKeys(values, fallbackKey = '') {
  const source = Array.isArray(values) ? values : [];
  const normalized = source
    .map((value) => normalizeDateKeyInput(value))
    .filter(Boolean)
    .slice(0, 6);

  if (!normalized.length) {
    const fallback = normalizeDateKeyInput(fallbackKey);
    if (fallback) normalized.push(fallback);
  }

  return normalized;
}

export function normalizeCoverForDateStatuses(values, size, fallbackStatus = COVER_FOR_STATUS.SEEKING) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForStatus(list[idx] != null ? list[idx] : fallbackStatus));
  }
  return result;
}

export function normalizeCoverForTimeValues(values, size, fallbackTime = COVER_FOR_DEFAULT_START_TIME) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeTimeInput(fallbackTime) || COVER_FOR_DEFAULT_START_TIME;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeTimeInput(list[idx]) || fallback);
  }
  return result;
}

export function normalizeCoverForVenueValues(values, size, fallbackVenue = COVER_FOR_DEFAULT_VENUE) {
  const list = Array.isArray(values) ? values : [];
  const fallback = normalizeCoverForVenue(fallbackVenue) || COVER_FOR_DEFAULT_VENUE;
  const result = [];
  for (let idx = 0; idx < size; idx += 1) {
    result.push(normalizeCoverForVenue(list[idx]) || fallback);
  }
  return result;
}

export function coverForDateEntriesFromPost(post) {
  const fallbackDateKey = toDateKey(post?.createdAt);
  const keys = normalizeCoverForDateKeys(post?.coverForDateKeys, fallbackDateKey);
  if (!keys.length) return [];

  const fallbackStatus = normalizeCoverForStatus(post?.coverForStatus);
  const statuses = normalizeCoverForDateStatuses(post?.coverForDateStatuses, keys.length, fallbackStatus);
  const legacyTimes = normalizeCoverForTimeValues(
    post?.coverForTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_START_TIME
  );
  const startTimes = normalizeCoverForTimeValues(
    post?.coverForStartTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_START_TIME
  );
  const endTimes = normalizeCoverForTimeValues(
    post?.coverForEndTimeValues,
    keys.length,
    COVER_FOR_DEFAULT_END_TIME
  );
  const venues = normalizeCoverForVenueValues(
    post?.coverForVenueValues,
    keys.length,
    normalizeCoverForVenue(post?.coverForVenue) || COVER_FOR_DEFAULT_VENUE
  );
  return keys.map((dateKey, idx) => ({
    startTimeValue: normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME,
    endTimeValue: isValidTimeRange(
      normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME,
      normalizeTimeInput(endTimes[idx]) || COVER_FOR_DEFAULT_END_TIME
    )
      ? (normalizeTimeInput(endTimes[idx]) || COVER_FOR_DEFAULT_END_TIME)
      : suggestEndTime(normalizeTimeInput(startTimes[idx]) || normalizeTimeInput(legacyTimes[idx]) || COVER_FOR_DEFAULT_START_TIME),
    dateKey,
    status: statuses[idx] || COVER_FOR_STATUS.SEEKING,
    venue: normalizeCoverForVenue(venues[idx]) || COVER_FOR_DEFAULT_VENUE
  }));
}

export function summarizeCoverForDateEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    return {
      statusClass: COVER_FOR_STATUS.SEEKING,
      label: coverForStatusLabel(COVER_FOR_STATUS.SEEKING),
      isClosed: false
    };
  }

  const hasSeeking = list.some((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.SEEKING);
  if (hasSeeking) {
    return {
      statusClass: COVER_FOR_STATUS.SEEKING,
      label: coverForStatusLabel(COVER_FOR_STATUS.SEEKING),
      isClosed: false
    };
  }

  const allCompleted = list.every((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.COMPLETED);
  if (allCompleted) {
    return {
      statusClass: COVER_FOR_STATUS.COMPLETED,
      label: coverForStatusLabel(COVER_FOR_STATUS.COMPLETED),
      isClosed: true
    };
  }

  const allCancelled = list.every((entry) => normalizeCoverForStatus(entry?.status) === COVER_FOR_STATUS.CANCELLED);
  if (allCancelled) {
    return {
      statusClass: COVER_FOR_STATUS.CANCELLED,
      label: coverForStatusLabel(COVER_FOR_STATUS.CANCELLED),
      isClosed: true
    };
  }

  return {
    statusClass: 'closed',
    label: '완료/취소',
    isClosed: true
  };
}

export function formatTemporaryLoginRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function commentAuthorName(comment) {
  return comment.authorName || comment.authorUid || '사용자';
}

export function plainRichPayload(text) {
  const safe = String(text || '');
  return {
    text: safe,
    runs: safe ? [{
      start: 0,
      end: safe.length,
      style: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        color: '#0f172a',
        fontSize: 16,
        link: ''
      }
    }] : []
  };
}

export function renderStoredContentHtml(source) {
  const storedHtml = sanitizeStoredContentHtml(source?.contentHtml || '');
  if (storedHtml) return `<div class="stored-html-content">${storedHtml}</div>`;

  const deltaHtml = renderRichDeltaToHtml(source?.contentDelta || null);
  if (deltaHtml) return deltaHtml;
  return renderRichPayloadToHtml(source?.contentRich || plainRichPayload(source?.contentText || ''));
}

export function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  roleDefinitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

export function normalizeRoleKey(roleKey, roleDefMap) {
  const raw = normalizeText(roleKey);
  const alias = ROLE_KEY_ALIASES[raw] || '';
  const lower = raw.toLowerCase();
  const englishAlias = lower === 'super_admin'
    ? 'Super_Admin'
    : lower === 'admin'
      ? 'Admin'
      : lower === 'staff'
        ? 'Staff'
      : lower === 'mentor'
        ? 'Mentor'
        : lower === 'newbie'
          ? 'Newbie'
          : '';
  const key = alias || englishAlias || raw;
  if (!key) return MENTOR_FORUM_CONFIG.app.defaultRole;
  if (Object.prototype.hasOwnProperty.call(CORE_ROLE_LEVELS, key)) return key;
  if (roleDefMap.has(key)) return key;
  return MENTOR_FORUM_CONFIG.app.defaultRole;
}

export function isExplicitNewbieRole(rawRole) {
  const raw = normalizeText(rawRole);
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return raw === 'Newbie' || lower === 'newbie' || raw === '새싹';
}

export function roleMatchCandidates(roleKey, roleDefMap = null) {
  const rawKey = normalizeText(roleKey);
  if (!rawKey) return [];

  const normalizedKey = roleDefMap && typeof roleDefMap.has === 'function'
    ? normalizeRoleKey(rawKey, roleDefMap)
    : rawKey;
  const seeds = normalizedKey && normalizedKey !== rawKey
    ? [rawKey, normalizedKey]
    : [rawKey];

  const candidates = [];
  seeds.forEach((key) => {
    if (key === 'Super_Admin') {
      candidates.push('Super_Admin', 'super_admin', '개발자');
      return;
    }
    if (key === 'Admin') {
      candidates.push('Admin', 'admin', '관리자');
      return;
    }
    if (key === 'Mentor') {
      candidates.push('Mentor', 'mentor', '멘토', '토');
      return;
    }
    if (key === 'Staff') {
      candidates.push('Staff', 'staff', '운영진');
      return;
    }
    if (key === 'Newbie') {
      candidates.push('Newbie', 'newbie', '새싹');
      return;
    }

    const roleDef = roleDefMap && typeof roleDefMap.get === 'function'
      ? roleDefMap.get(key)
      : null;
    const labelKo = normalizeText(roleDef?.labelKo);
    const lower = key.toLowerCase();
    candidates.push(key);
    if (lower && lower !== key) candidates.push(lower);
    if (labelKo) candidates.push(labelKo);
  });

  return [...new Set(candidates.filter(Boolean))];
}

export function isPrivilegedBoardRole(roleKey) {
  const role = normalizeText(roleKey);
  return role === 'Super_Admin' || role === 'Admin';
}

export function isNoticeBoardData(boardId, boardData) {
  const id = normalizeText(boardId || boardData?.id);
  const name = normalizeText(boardData?.name);
  return id === NOTICE_BOARD_ID || name === '공지사항';
}

export function sortCommentsForDisplay(comments) {
  const list = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ ...comment, id: normalizeText(comment.id) }))
    .filter((comment) => !!comment.id);

  const byId = new Map(list.map((comment) => [comment.id, comment]));
  const childrenByParent = new Map();
  const roots = [];

  list.forEach((comment) => {
    const parentId = normalizeText(comment.parentId);
    if (!parentId || parentId === comment.id || !byId.has(parentId)) {
      roots.push(comment);
      return;
    }

    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(comment);
  });

  const byCreatedAt = (a, b) => {
    const diff = toMillis(a.createdAt) - toMillis(b.createdAt);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  };

  roots.sort(byCreatedAt);
  childrenByParent.forEach((items) => items.sort(byCreatedAt));

  const visited = new Set();
  const ordered = [];

  const visit = (comment, depth, parentComment = null) => {
    if (!comment || visited.has(comment.id)) return;
    visited.add(comment.id);

    const normalizedDepth = Math.max(0, depth);
    const row = {
      ...comment,
      _threadDepth: normalizedDepth
    };

    if (normalizedDepth > 0 && !row.replyToAuthorName && parentComment) {
      row.replyToAuthorName = commentAuthorName(parentComment);
    }

    ordered.push(row);

    const children = childrenByParent.get(comment.id) || [];
    children.forEach((child) => visit(child, normalizedDepth + 1, comment));
  };

  roots.forEach((root) => visit(root, 0, null));
  list
    .filter((comment) => !visited.has(comment.id))
    .sort(byCreatedAt)
    .forEach((comment) => visit(comment, 0, null));

  return ordered;
}
