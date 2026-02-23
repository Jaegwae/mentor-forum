// Quill-based rich editor creation, sanitization, and rendering helpers.
import { Quill } from 'react-quill';

const DEFAULT_MIN = 10;
const DEFAULT_MAX = 48;
const DEFAULT_STEP = 2;
const DEFAULT_COLOR = '#0f172a';
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_EDITOR_FORMATS = [
  'bold',
  'italic',
  'strike',
  'underline',
  'size',
  'color',
  'link',
  'header',
  'list',
  'blockquote',
  'code-block',
  'align',
  'indent',
  'mention-chip'
];
const ALLOWED_LIST_VALUES = new Set(['ordered', 'bullet']);
const ALLOWED_ALIGN_VALUES = new Set(['', 'center', 'right', 'justify']);

let deltaRenderQuill = null;
let deltaRenderHost = null;

const SizeStyle = Quill.import('attributors/style/size');
const EmbedBlot = Quill.import('blots/embed');
const SIZE_WHITELIST = [];
for (let size = DEFAULT_MIN; size <= DEFAULT_MAX; size += 1) {
  SIZE_WHITELIST.push(`${size}px`);
}
SizeStyle.whitelist = SIZE_WHITELIST;
Quill.register(SizeStyle, true);

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

class MentionChipBlot extends EmbedBlot {
  static create(value) {
    const node = super.create();
    const mention = sanitizeMentionValue(value);
    if (!mention) return node;
    node.setAttribute('data-mention-uid', mention.uid);
    node.setAttribute('data-mention-nickname', mention.nickname);
    node.setAttribute('contenteditable', 'false');
    node.setAttribute('spellcheck', 'false');
    node.textContent = `@${mention.nickname}`;
    return node;
  }

  static value(node) {
    return sanitizeMentionValue({
      uid: node?.getAttribute?.('data-mention-uid') || '',
      nickname: node?.getAttribute?.('data-mention-nickname') || ''
    });
  }
}
MentionChipBlot.blotName = 'mention-chip';
MentionChipBlot.tagName = 'span';
MentionChipBlot.className = 'ql-mention-chip';
Quill.register(MentionChipBlot, true);

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHttpUrl(url) {
  const s = String(url || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

function cloneStyle(style) {
  return {
    bold: !!style.bold,
    italic: !!style.italic,
    strikethrough: !!style.strikethrough,
    underline: !!style.underline,
    color: style.color || DEFAULT_COLOR,
    fontSize: Number(style.fontSize) || DEFAULT_FONT_SIZE,
    link: style.link || ''
  };
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

function parseInlineStyle(styleText, style) {
  const src = String(styleText || '').toLowerCase();
  const color = src.match(/color\s*:\s*([^;]+)/i);
  const size = src.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i);
  if (color) style.color = String(color[1]).trim();
  if (size) style.fontSize = Math.round(Number(size[1]));
}

function pushRun(runs, text, style) {
  if (!text) return;
  const next = { text, style: cloneStyle(style) };
  const last = runs[runs.length - 1];
  if (last && styleKey(last.style) === styleKey(next.style)) {
    last.text += next.text;
    return;
  }
  runs.push(next);
}

function walk(node, inheritedStyle, runs) {
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    pushRun(runs, node.textContent || '', inheritedStyle);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toUpperCase();
  const style = cloneStyle(inheritedStyle);

  if (tag === 'BR') {
    pushRun(runs, '\n', style);
    return;
  }
  if (tag === 'B' || tag === 'STRONG') style.bold = true;
  if (tag === 'I' || tag === 'EM') style.italic = true;
  if (tag === 'S' || tag === 'STRIKE') style.strikethrough = true;
  if (tag === 'U') style.underline = true;
  if (tag === 'A') style.link = sanitizeHttpUrl(node.getAttribute('href') || '');

  if (node.getAttribute && node.getAttribute('style')) {
    parseInlineStyle(node.getAttribute('style'), style);
  }

  const children = node.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    walk(children[i], style, runs);
  }

  if ((tag === 'DIV' || tag === 'P') && node.nextSibling) {
    pushRun(runs, '\n', style);
  }
}

export function serializeEditorContent(editorEl) {
  const runs = [];
  const baseStyle = {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    color: DEFAULT_COLOR,
    fontSize: DEFAULT_FONT_SIZE,
    link: ''
  };

  const nodes = editorEl ? editorEl.childNodes : [];
  for (let i = 0; i < nodes.length; i++) {
    walk(nodes[i], baseStyle, runs);
  }

  const compactRuns = [];
  let cursor = 0;
  let text = '';
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!r.text) continue;
    const start = cursor;
    text += r.text;
    cursor += r.text.length;
    compactRuns.push({
      start,
      end: cursor,
      style: {
        bold: !!r.style.bold,
        italic: !!r.style.italic,
        strikethrough: !!r.style.strikethrough,
        underline: !!r.style.underline,
        color: r.style.color || DEFAULT_COLOR,
        fontSize: Number(r.style.fontSize) || DEFAULT_FONT_SIZE,
        link: r.style.link || ''
      }
    });
  }

  return { text, runs: compactRuns };
}

function applyStyleToText(text, style) {
  let out = text;
  if (style.bold) out = `<strong>${out}</strong>`;
  if (style.italic) out = `<em>${out}</em>`;
  if (style.strikethrough) out = `<s>${out}</s>`;
  if (style.underline) out = `<u>${out}</u>`;

  const span = [];
  if (style.color) span.push(`color:${escapeHtml(style.color)}`);
  if (style.fontSize) span.push(`font-size:${Math.round(Number(style.fontSize) || DEFAULT_FONT_SIZE)}px`);
  if (span.length) out = `<span style="${span.join(';')};">${out}</span>`;

  const safeLink = sanitizeHttpUrl(style.link);
  if (safeLink) {
    out = `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
  }
  return out;
}

export function renderRichPayloadToHtml(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const text = String(payload.text || '');
  if (!text) return '';
  const runs = Array.isArray(payload.runs) ? payload.runs : [];
  if (!runs.length) {
    return `<span>${escapeHtml(text).replace(/\n/g, '<br>')}</span>`;
  }

  const parts = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const s = Math.max(0, Math.floor(Number(r.start) || 0));
    const e = Math.min(text.length, Math.floor(Number(r.end) || 0));
    if (e <= s) continue;
    const runText = escapeHtml(text.slice(s, e)).replace(/\n/g, '<br>');
    parts.push(applyStyleToText(runText, r.style || {}));
  }
  return parts.join('');
}

function sanitizePayloadStyle(style, minSize, maxSize) {
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

function quillSizeToPx(value, fallback) {
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

function clampIndent(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(8, n));
}

function sanitizeDeltaAttributes(attrs, minSize, maxSize) {
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

function sanitizeDelta(delta, minSize, maxSize) {
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
  if (!ops.length || !hasTrailingNewLine) {
    ops.push({ insert: '\n', attributes: sanitizeDeltaAttributes({}, minSize, maxSize) });
  }

  return { ops };
}

function deltaLikeToQuillDelta(deltaLike, minSize, maxSize) {
  if (deltaLike && typeof deltaLike === 'object' && Array.isArray(deltaLike.ops)) {
    return sanitizeDelta(deltaLike, minSize, maxSize);
  }
  return payloadToQuillDelta(deltaLike, minSize, maxSize);
}

function payloadToQuillDelta(payload, minSize, maxSize) {
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

function deltaToPayload(delta, minSize, maxSize) {
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

function ensureDeltaRenderQuill() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (deltaRenderQuill && deltaRenderHost && document.body.contains(deltaRenderHost)) {
    return deltaRenderQuill;
  }

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  deltaRenderHost = host;
  deltaRenderQuill = new Quill(host, {
    theme: 'snow',
    readOnly: true,
    modules: { toolbar: false },
    formats: DEFAULT_EDITOR_FORMATS
  });
  return deltaRenderQuill;
}

export function renderRichDeltaToHtml(delta, options = {}) {
  const minSize = Number(options.minSize) || DEFAULT_MIN;
  const maxSize = Number(options.maxSize) || DEFAULT_MAX;
  const renderer = ensureDeltaRenderQuill();
  if (!renderer) return '';

  try {
    const safeDelta = sanitizeDelta(delta, minSize, maxSize);
    renderer.setContents(safeDelta, 'silent');
    const html = renderer.root?.innerHTML || '';
    if (!html) return '';
    return `<div class="ql-editor">${html}</div>`;
  } catch (_) {
    return '';
  }
}

export function createRichEditor(options) {
  const editorEl = options.editorEl;
  const fontSizeLabelEl = options.fontSizeLabelEl;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const onSelectionChange = typeof options.onSelectionChange === 'function' ? options.onSelectionChange : () => {};
  const minSize = Number(options.minSize) || DEFAULT_MIN;
  const maxSize = Number(options.maxSize) || DEFAULT_MAX;
  const step = Number(options.step) || DEFAULT_STEP;

  if (!editorEl) {
    return {
      exec: () => {},
      setColor: () => {},
      stepFont: () => {},
      setLink: () => {},
      removeLink: () => {},
      getPayload: () => ({ text: '', runs: [] }),
      getDelta: () => ({ ops: [{ insert: '\n' }] }),
      getText: () => '',
      setPayload: () => {},
      setDelta: () => {},
      getHtml: () => '',
      refreshLabel: () => {},
      focus: () => {},
      getSelection: () => ({ index: 0, length: 0 }),
      getRawText: () => '',
      replaceRange: () => 0,
      insertMention: () => 0,
      getQuill: () => null
    };
  }

  editorEl.innerHTML = '';
  const quill = new Quill(editorEl, {
    theme: 'snow',
    modules: {
      toolbar: false,
      clipboard: { matchVisual: false }
    },
    formats: DEFAULT_EDITOR_FORMATS
  });
  let armedMentionDeleteIndex = -1;
  let lastKnownRange = { index: 0, length: 0 };

  function normalizeRange(range) {
    const index = Math.max(0, Math.floor(Number(range?.index) || 0));
    const length = Math.max(0, Math.floor(Number(range?.length) || 0));
    return { index, length };
  }

  function clearMentionDeleteArmedState() {
    if (armedMentionDeleteIndex < 0) return;
    try {
      const [leaf] = quill.getLeaf(armedMentionDeleteIndex);
      if (leaf?.domNode && leaf.domNode.classList) {
        leaf.domNode.classList.remove('is-delete-armed');
      }
    } catch (_) {
      // Ignore stale blot lookup.
    }
    armedMentionDeleteIndex = -1;
  }

  function findMentionAt(index) {
    const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
    const [leaf] = quill.getLeaf(safeIndex);
    if (!leaf || leaf.statics?.blotName !== 'mention-chip') return null;
    const mentionIndex = quill.getIndex(leaf);
    const mentionValue = sanitizeMentionValue(leaf.value?.() || leaf.domNode);
    return {
      blot: leaf,
      index: mentionIndex,
      mention: mentionValue
    };
  }

  function armMentionDelete(index) {
    const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
    clearMentionDeleteArmedState();
    const mentionEntry = findMentionAt(safeIndex);
    if (!mentionEntry) return false;
    if (mentionEntry.blot.domNode?.classList) {
      mentionEntry.blot.domNode.classList.add('is-delete-armed');
    }
    armedMentionDeleteIndex = mentionEntry.index;
    return true;
  }

  function clampSize(n) {
    return Math.max(minSize, Math.min(maxSize, Math.round(Number(n) || DEFAULT_FONT_SIZE)));
  }

  function refreshLabel() {
    const size = getSelectionFontSize();
    if (fontSizeLabelEl) fontSizeLabelEl.textContent = `${size}px`;
  }

  function getSelectionFontSize() {
    const range = quill.getSelection();
    if (!range) return DEFAULT_FONT_SIZE;
    const format = quill.getFormat(range);
    return clampSize(quillSizeToPx(format?.size, DEFAULT_FONT_SIZE));
  }

  function exec(command, value) {
    quill.focus();
    const range = quill.getSelection(true);
    if (!range) return;

    const cmd = String(command || '').toLowerCase();
    const formats = quill.getFormat(range);
    if (cmd === 'bold') {
      quill.format('bold', !formats.bold, 'user');
    } else if (cmd === 'italic') {
      quill.format('italic', !formats.italic, 'user');
    } else if (cmd === 'strikethrough') {
      quill.format('strike', !formats.strike, 'user');
    } else if (cmd === 'underline') {
      quill.format('underline', !formats.underline, 'user');
    } else if (cmd === 'header') {
      const target = Number(value) === 1 ? 1 : (Number(value) === 2 ? 2 : false);
      quill.format('header', formats.header === target ? false : target, 'user');
    } else if (cmd === 'list') {
      const targetList = String(value || '').toLowerCase();
      if (!ALLOWED_LIST_VALUES.has(targetList)) {
        quill.format('list', false, 'user');
      } else {
        quill.format('list', formats.list === targetList ? false : targetList, 'user');
      }
    } else if (cmd === 'blockquote') {
      quill.format('blockquote', !formats.blockquote, 'user');
    } else if (cmd === 'code-block' || cmd === 'codeblock') {
      quill.format('code-block', !formats['code-block'], 'user');
    } else if (cmd === 'align') {
      const align = String(value == null ? '' : value).trim().toLowerCase();
      if (!ALLOWED_ALIGN_VALUES.has(align)) return;
      quill.format('align', align || false, 'user');
    } else if (cmd === 'indent') {
      const nowIndent = clampIndent(formats.indent || 0);
      const dir = Number(value);
      const nextIndent = clampIndent(nowIndent + (dir > 0 ? 1 : -1));
      quill.format('indent', nextIndent > 0 ? nextIndent : false, 'user');
    } else if (cmd === 'clean') {
      const len = Math.max(0, Number(range.length) || 0);
      if (len > 0) {
        quill.removeFormat(range.index, len, 'user');
      } else {
        quill.format('bold', false, 'user');
        quill.format('italic', false, 'user');
        quill.format('strike', false, 'user');
        quill.format('underline', false, 'user');
        quill.format('size', `${DEFAULT_FONT_SIZE}px`, 'user');
        quill.format('color', DEFAULT_COLOR, 'user');
        quill.format('link', false, 'user');
        quill.format('header', false, 'user');
        quill.format('list', false, 'user');
        quill.format('blockquote', false, 'user');
        quill.format('code-block', false, 'user');
        quill.format('align', false, 'user');
        quill.format('indent', false, 'user');
      }
    } else if (cmd === 'format' && value && typeof value === 'object') {
      Object.entries(value).forEach(([key, nextValue]) => {
        quill.format(key, nextValue, 'user');
      });
    }

    refreshLabel();
  }

  function setColor(color) {
    const safe = String(color || '').trim();
    if (!safe) return;
    quill.focus();
    quill.format('color', safe, 'user');
    refreshLabel();
  }

  function stepFont(delta) {
    const range = quill.getSelection(true);
    if (!range || range.length <= 0) {
      refreshLabel();
      return;
    }

    const current = getSelectionFontSize();
    const next = clampSize(current + (delta > 0 ? step : -step));
    quill.format('size', `${next}px`, 'user');
    refreshLabel();
  }

  function setLink(url) {
    const safe = sanitizeHttpUrl(url);
    if (!safe) return;
    quill.focus();
    const range = quill.getSelection(true);
    if (!range) return;

    if (range.length <= 0) {
      quill.insertText(range.index, safe, { link: safe }, 'user');
      quill.setSelection(range.index + safe.length, 0, 'silent');
      refreshLabel();
      return;
    }

    quill.format('link', safe, 'user');
    refreshLabel();
  }

  function removeLink() {
    quill.focus();
    quill.format('link', false, 'user');
    refreshLabel();
  }

  function setPayload(payload) {
    const delta = deltaLikeToQuillDelta(payload, minSize, maxSize);
    clearMentionDeleteArmedState();
    quill.setContents(delta, 'silent');
    refreshLabel();
    onChange();
  }

  function setDelta(delta) {
    const safeDelta = sanitizeDelta(delta, minSize, maxSize);
    clearMentionDeleteArmedState();
    quill.setContents(safeDelta, 'silent');
    refreshLabel();
    onChange();
  }

  function getDelta() {
    return sanitizeDelta(quill.getContents(), minSize, maxSize);
  }

  function getPayload() {
    return deltaToPayload(getDelta(), minSize, maxSize);
  }

  function getHtml() {
    const html = renderRichDeltaToHtml(getDelta(), { minSize, maxSize });
    return html || '';
  }

  function getText() {
    return String(getPayload().text || '').trim();
  }

  function getSelection() {
    const range = quill.getSelection();
    if (range) {
      lastKnownRange = normalizeRange(range);
    }
    return {
      index: lastKnownRange.index,
      length: lastKnownRange.length
    };
  }

  function getRawText() {
    return String(quill.getText() || '');
  }

  function replaceRange(start, length, text) {
    const safeStart = Math.max(0, Math.floor(Number(start) || 0));
    const safeLength = Math.max(0, Math.floor(Number(length) || 0));
    const safeText = String(text || '');
    clearMentionDeleteArmedState();
    quill.focus();
    if (safeLength > 0) {
      quill.deleteText(safeStart, safeLength, 'user');
    }
    if (safeText) {
      quill.insertText(safeStart, safeText, 'user');
    }
    const nextIndex = safeStart + safeText.length;
    quill.setSelection(nextIndex, 0, 'silent');
    refreshLabel();
    onChange();
    return nextIndex;
  }

  function insertMention(start, length, mentionValue) {
    const mention = sanitizeMentionValue(mentionValue);
    if (!mention) return 0;
    const safeStart = Math.max(0, Math.floor(Number(start) || 0));
    const safeLength = Math.max(0, Math.floor(Number(length) || 0));
    clearMentionDeleteArmedState();
    quill.focus();

    if (safeLength > 0) {
      quill.deleteText(safeStart, safeLength, 'user');
    }

    quill.insertEmbed(safeStart, 'mention-chip', mention, 'user');
    quill.insertText(safeStart + 1, ' ', 'user');
    const nextIndex = safeStart + 2;
    quill.setSelection(nextIndex, 0, 'silent');
    refreshLabel();
    onChange();
    return nextIndex;
  }

  function setPlainText(text) {
    const value = String(text || '');
    clearMentionDeleteArmedState();
    const nextDelta = sanitizeDelta({ ops: [{ insert: value }, { insert: '\n' }] }, minSize, maxSize);
    quill.setContents(nextDelta, 'silent');
    refreshLabel();
    onChange();
  }

  function clear() {
    clearMentionDeleteArmedState();
    const emptyDelta = sanitizeDelta({ ops: [{ insert: '\n' }] }, minSize, maxSize);
    quill.setContents(emptyDelta, 'silent');
    refreshLabel();
    onChange();
  }

  function setPayloadOrText(input) {
    if (typeof input === 'string') {
      setPlainText(input);
      return;
    }

    const delta = deltaLikeToQuillDelta(input, minSize, maxSize);
    clearMentionDeleteArmedState();
    quill.setContents(delta, 'silent');
    refreshLabel();
    onChange();
  }

  quill.keyboard.addBinding({ key: 8 }, (range) => {
    if (!range || Number(range.length) > 0) {
      clearMentionDeleteArmedState();
      return true;
    }

    const cursorIndex = Math.max(0, Math.floor(Number(range.index) || 0));
    if (cursorIndex <= 0) {
      clearMentionDeleteArmedState();
      return true;
    }

    const mentionEntry = findMentionAt(cursorIndex - 1);
    if (!mentionEntry) {
      clearMentionDeleteArmedState();
      return true;
    }

    if (armedMentionDeleteIndex === mentionEntry.index) {
      quill.deleteText(mentionEntry.index, 1, 'user');
      clearMentionDeleteArmedState();
      return false;
    }

    armMentionDelete(mentionEntry.index);
    return false;
  });

  quill.on('text-change', () => {
    clearMentionDeleteArmedState();
    refreshLabel();
    onChange();
  });
  quill.on('selection-change', (range) => {
    if (range && Number.isFinite(Number(range.index))) {
      lastKnownRange = normalizeRange(range);
    }
    if (armedMentionDeleteIndex >= 0) {
      const cursorIndex = Number(range?.index);
      const rangeLength = Number(range?.length);
      if (!Number.isFinite(cursorIndex) || cursorIndex !== armedMentionDeleteIndex + 1 || Number.isFinite(rangeLength) && rangeLength > 0) {
        clearMentionDeleteArmedState();
      }
    }
    refreshLabel();
    onSelectionChange();
  });

  refreshLabel();

  return {
    exec,
    setColor,
    stepFont,
    setLink,
    removeLink,
    getPayload,
    getDelta,
    getHtml,
    getText,
    setPayload: setPayloadOrText,
    setDelta,
    clear,
    refreshLabel,
    focus: () => quill.focus(),
    getSelection,
    getRawText,
    replaceRange,
    insertMention,
    getQuill: () => quill
  };
}
