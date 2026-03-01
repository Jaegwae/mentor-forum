/**
 * 리치 텍스트 변환 순수 함수 모듈.
 * - Quill Delta <-> 저장 payload(text+runs) 양방향 변환
 * - 속성 sanitize(보안 URL, 폰트 크기 클램프, 허용 포맷 제한)
 * - 런타임/테스트에서 동일 계약을 재사용
 */

export const DEFAULT_MIN = 10;
export const DEFAULT_MAX = 48;
export const DEFAULT_COLOR = '#0f172a';
export const DEFAULT_FONT_SIZE = 16;

const ALLOWED_LIST_VALUES = new Set(['ordered', 'bullet']);
const ALLOWED_ALIGN_VALUES = new Set(['', 'center', 'right', 'justify']);

function sanitizeMentionValue(value) {
  const source = value && typeof value === 'object' ? value : {};
  const uid = String(source.uid || source.id || '').trim();
  const nickname = String(source.nickname || source.label || source.name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  if (!nickname) return null;
  return { uid, nickname };
}

function styleKey(style) {
  return [
    style.bold ? '1' : '0',
    style.italic ? '1' : '0',
    style.strikethrough ? '1' : '0',
    style.underline ? '1' : '0',
    style.color || '',
    Number(style.fontSize) || 0,
    style.link || ''
  ].join('|');
}

export function sanitizeHttpUrl(url) {
  // 제어문자 제거 후 http/https 스킴만 허용한다.
  const s = String(url || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

export function quillSizeToPx(value, fallback = DEFAULT_FONT_SIZE) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const src = String(value || '').trim().toLowerCase();
  if (!src) return fallback;
  if (src.endsWith('px')) {
    const px = Number(src.slice(0, -2));
    return Number.isFinite(px) ? Math.round(px) : fallback;
  }
  const mapped = Number(src);
  return Number.isFinite(mapped) ? Math.round(mapped) : fallback;
}

function clampIndent(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(8, n));
}

export function sanitizePayloadStyle(style, minSize = DEFAULT_MIN, maxSize = DEFAULT_MAX) {
  const n = Number(style?.fontSize);
  const fontSize = Number.isFinite(n) ? Math.max(minSize, Math.min(maxSize, Math.round(n))) : DEFAULT_FONT_SIZE;
  return {
    bold: !!style?.bold,
    italic: !!style?.italic,
    strikethrough: !!style?.strikethrough,
    underline: !!style?.underline,
    color: style?.color || DEFAULT_COLOR,
    fontSize,
    link: sanitizeHttpUrl(style?.link || '')
  };
}

function payloadStyleToQuillAttrs(style, minSize, maxSize) {
  const normalized = sanitizePayloadStyle(style, minSize, maxSize);
  const attrs = {};
  if (normalized.bold) attrs.bold = true;
  if (normalized.italic) attrs.italic = true;
  if (normalized.strikethrough) attrs.strike = true;
  if (normalized.underline) attrs.underline = true;
  if (normalized.color) attrs.color = normalized.color;
  if (normalized.fontSize) attrs.size = `${normalized.fontSize}px`;
  if (normalized.link) attrs.link = normalized.link;
  return attrs;
}

function quillAttrsToPayloadStyle(attrs, minSize, maxSize) {
  const nextSize = quillSizeToPx(attrs?.size, DEFAULT_FONT_SIZE);
  const fontSize = Math.max(minSize, Math.min(maxSize, nextSize));
  return {
    bold: !!attrs?.bold,
    italic: !!attrs?.italic,
    strikethrough: !!attrs?.strike,
    underline: !!attrs?.underline,
    color: attrs?.color || DEFAULT_COLOR,
    fontSize,
    link: sanitizeHttpUrl(attrs?.link || '')
  };
}

function normalizePayloadRuns(text, runs) {
  const sourceText = String(text || '');
  const normalizedRuns = Array.isArray(runs) ? runs : [];
  if (!normalizedRuns.length) {
    if (!sourceText) return [];
    return [{
      start: 0,
      end: sourceText.length,
      style: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        color: DEFAULT_COLOR,
        fontSize: DEFAULT_FONT_SIZE,
        link: ''
      }
    }];
  }

  return normalizedRuns
    .map((item) => ({
      start: Math.max(0, Math.floor(Number(item?.start) || 0)),
      end: Math.max(0, Math.floor(Number(item?.end) || 0)),
      style: item?.style || {}
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

export function sanitizeDeltaAttributes(attrs, minSize = DEFAULT_MIN, maxSize = DEFAULT_MAX) {
  const source = attrs && typeof attrs === 'object' ? attrs : {};
  const next = {};

  if (source.bold) next.bold = true;
  if (source.italic) next.italic = true;
  if (source.strike) next.strike = true;
  if (source.underline) next.underline = true;
  if (source.blockquote) next.blockquote = true;
  if (source['code-block']) next['code-block'] = true;

  const header = Number(source.header);
  if (header === 1 || header === 2) next.header = header;

  const list = String(source.list || '').trim().toLowerCase();
  if (ALLOWED_LIST_VALUES.has(list)) next.list = list;

  const align = String(source.align == null ? '' : source.align).trim().toLowerCase();
  if (ALLOWED_ALIGN_VALUES.has(align)) {
    if (align) next.align = align;
  }

  if (source.indent != null) {
    const indent = clampIndent(source.indent);
    if (indent > 0) next.indent = indent;
  }

  const color = String(source.color || '').trim();
  if (color) next.color = color;

  const size = quillSizeToPx(source.size, DEFAULT_FONT_SIZE);
  next.size = `${Math.max(minSize, Math.min(maxSize, size))}px`;

  const link = sanitizeHttpUrl(source.link || '');
  if (link) next.link = link;

  return next;
}

export function sanitizeDelta(delta, minSize = DEFAULT_MIN, maxSize = DEFAULT_MAX) {
  const sourceOps = Array.isArray(delta?.ops) ? delta.ops : [];
  const ops = [];

  sourceOps.forEach((op) => {
    if (!op || typeof op !== 'object') return;
    if (typeof op.insert === 'string') {
      const text = op.insert;
      if (!text) return;

      ops.push({
        insert: text,
        attributes: sanitizeDeltaAttributes(op.attributes, minSize, maxSize)
      });
      return;
    }

    const mention = sanitizeMentionValue(op.insert?.['mention-chip']);
    if (mention) {
      ops.push({
        insert: {
          'mention-chip': mention
        }
      });
    }
  });

  const lastInsert = ops.length ? ops[ops.length - 1].insert : '';
  const hasTrailingNewLine = typeof lastInsert === 'string' && lastInsert.endsWith('\n');
  // Quill 콘텐츠는 trailing newline이 있어야 selection/format 동작이 안정적이다.
  if (!ops.length || !hasTrailingNewLine) {
    ops.push({ insert: '\n', attributes: sanitizeDeltaAttributes({}, minSize, maxSize) });
  }

  return { ops };
}

export function payloadToQuillDelta(payload, minSize = DEFAULT_MIN, maxSize = DEFAULT_MAX) {
  const text = String(payload?.text || '');
  const runs = normalizePayloadRuns(text, payload?.runs);
  const ops = [];
  const defaultAttrs = payloadStyleToQuillAttrs({}, minSize, maxSize);

  let cursor = 0;
  runs.forEach((run) => {
    const start = Math.max(0, Math.min(text.length, run.start));
    const end = Math.max(0, Math.min(text.length, run.end));
    if (end <= start) return;

    if (start > cursor) {
      // run 사이의 공백 구간은 기본 스타일로 채워 텍스트 길이 정합성을 맞춘다.
      ops.push({ insert: text.slice(cursor, start), attributes: { ...defaultAttrs } });
      cursor = start;
    }

    ops.push({
      insert: text.slice(start, end),
      attributes: payloadStyleToQuillAttrs(run.style, minSize, maxSize)
    });
    cursor = end;
  });

  if (cursor < text.length) {
    ops.push({ insert: text.slice(cursor), attributes: { ...defaultAttrs } });
  }

  if (!ops.length) {
    ops.push({ insert: '' });
  }
  ops.push({ insert: '\n' });
  return sanitizeDelta({ ops }, minSize, maxSize);
}

export function deltaToPayload(delta, minSize = DEFAULT_MIN, maxSize = DEFAULT_MAX) {
  const ops = Array.isArray(delta?.ops) ? delta.ops : [];
  let text = '';
  let cursor = 0;
  const runs = [];

  ops.forEach((op) => {
    if (!op || typeof op !== 'object') return;

    let segment = '';
    if (typeof op.insert === 'string') {
      segment = op.insert;
    } else {
      const mention = sanitizeMentionValue(op.insert?.['mention-chip']);
      if (mention) {
        segment = `@${mention.nickname}`;
      }
    }
    if (!segment) return;

    const style = quillAttrsToPayloadStyle(op.attributes || {}, minSize, maxSize);
    const start = cursor;
    const end = cursor + segment.length;
    text += segment;
    cursor = end;

    const last = runs[runs.length - 1];
    // 동일 스타일 연속 구간은 병합해 run 개수를 최소화한다.
    if (last && styleKey(last.style) === styleKey(style)) {
      last.end = end;
      return;
    }

    runs.push({ start, end, style });
  });

  if (text.endsWith('\n')) {
    text = text.slice(0, -1);
    const nextRuns = runs
      .map((run) => ({
        ...run,
        end: Math.min(run.end, text.length)
      }))
      .filter((run) => run.end > run.start);
    return { text, runs: nextRuns };
  }

  return { text, runs };
}
