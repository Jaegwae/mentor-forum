/**
 * Quill 런타임 래퍼.
 * - 툴바가 호출하는 명령(exec/setColor/setLink...)을 안정 API로 노출한다.
 * - Delta/Payload 변환은 순수 모듈(`services/editor/rich-editor-transform`)에 위임한다.
 * - 멘션 칩 삽입/삭제 UX, 폰트 라벨 동기화, HTML 렌더 보조 기능을 포함한다.
 */
import Quill from 'quill';
import {
  sanitizeHttpUrl as sanitizeHttpUrlPure,
  sanitizePayloadStyle as sanitizePayloadStylePure,
  quillSizeToPx as quillSizeToPxPure,
  sanitizeDeltaAttributes as sanitizeDeltaAttributesPure,
  sanitizeDelta as sanitizeDeltaPure,
  payloadToQuillDelta as payloadToQuillDeltaPure,
  deltaToPayload as deltaToPayloadPure
} from '../services/editor/rich-editor-transform.js';

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
  return sanitizeHttpUrlPure(url);
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
    return `<span style="color:${DEFAULT_COLOR};font-size:${DEFAULT_FONT_SIZE}px;">${escapeHtml(text).replace(/\n/g, '<br>')}</span>`;
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
  return sanitizePayloadStylePure(style, minSize, maxSize);
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
  return quillSizeToPxPure(value, fallback);
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
  return sanitizeDeltaAttributesPure(attrs, minSize, maxSize);
}

function sanitizeDelta(delta, minSize, maxSize) {
  return sanitizeDeltaPure(delta, minSize, maxSize);
}

function deltaLikeToQuillDelta(deltaLike, minSize, maxSize) {
  if (deltaLike && typeof deltaLike === 'object' && Array.isArray(deltaLike.ops)) {
    return sanitizeDelta(deltaLike, minSize, maxSize);
  }
  return payloadToQuillDelta(deltaLike, minSize, maxSize);
}

function payloadToQuillDelta(payload, minSize, maxSize) {
  return payloadToQuillDeltaPure(payload, minSize, maxSize);
}

function deltaToPayload(delta, minSize, maxSize) {
  return deltaToPayloadPure(delta, minSize, maxSize);
}

function ensureDeltaRenderQuill() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (deltaRenderQuill && deltaRenderHost && document.body.contains(deltaRenderHost)) {
    return deltaRenderQuill;
  }

  const host = document.createElement('div');
  // 화면에는 보이지 않는 오프스크린 Quill 인스턴스를 만들어 Delta -> HTML 렌더에 재사용한다.
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
    // DOM이 없는 경우에도 호출부가 깨지지 않도록 no-op API를 반환한다.
    return {
      exec: () => {},
      setColor: () => {},
      setFontSize: () => DEFAULT_FONT_SIZE,
      stepFont: () => {},
      setLink: () => {},
      removeLink: () => {},
      getPayload: () => ({ text: '', runs: [] }),
      getDelta: () => ({ ops: [{ insert: '\n' }] }),
      getText: () => '',
      getSelectionFontSize: () => DEFAULT_FONT_SIZE,
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
    // 툴바 command 문자열을 Quill format 호출로 매핑한다.
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
      // 선택 영역이 없으면 현재 커서 포맷 기본값으로 리셋한다.
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

  function setFontSize(value) {
    const nextSize = clampSize(quillSizeToPx(value, getSelectionFontSize()));
    quill.focus();
    quill.format('size', `${nextSize}px`, 'user');
    refreshLabel();
    return nextSize;
  }

  function stepFont(delta) {
    const current = getSelectionFontSize();
    setFontSize(current + (delta > 0 ? step : -step));
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
      // 연속 Backspace 두 번째 입력에서 멘션 칩을 실제 삭제한다.
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
      // 커서가 멘션 칩 경계에서 벗어나면 삭제 무장 상태를 자동 해제한다.
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
    setFontSize,
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
    getSelectionFontSize,
    focus: () => quill.focus(),
    getSelection,
    getRawText,
    replaceRange,
    insertMention,
    getQuill: () => quill
  };
}
