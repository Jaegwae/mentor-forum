/**
 * 리치 에디터 툴바 프리젠테이션/상호작용 레이어.
 * - 버튼 클릭을 editorRef API(exec/setColor/setFontSize...)로 위임한다.
 * - 색상 팝오버와 폰트 크기 직접 입력 UX 상태를 로컬 state로 관리한다.
 */
import React from 'react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  ListIndentDecrease,
  ListIndentIncrease,
  Type,
  Minus,
  Plus,
  Palette,
  Link2,
  Unlink2
} from 'lucide-react';

const DEFAULT_EDITOR_COLOR = '#0f172a';
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 48;
const EDITOR_COLOR_PRESETS = [
  '#0f172a',
  '#475569',
  '#1d4ed8',
  '#0ea5e9',
  '#0f766e',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#8b5cf6',
  '#7c2d12'
];

function ToolButton({ label, onClick, children, id }) {
  return (
    <button
      type="button"
      id={id}
      className="editor-tool-btn"
      title={label}
      aria-label={label}
      // 버튼 클릭이 에디터 selection을 잃지 않도록 mousedown 기본동작을 막는다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RichEditorToolbar({ editorRef, fontSizeLabelRef, ids = {} }) {
  const [colorValue, setColorValue] = React.useState(DEFAULT_EDITOR_COLOR);
  const [colorPaletteOpen, setColorPaletteOpen] = React.useState(false);
  const [customPickerOpen, setCustomPickerOpen] = React.useState(false);
  const [customColorValue, setCustomColorValue] = React.useState(DEFAULT_EDITOR_COLOR);
  const [fontSizeEditing, setFontSizeEditing] = React.useState(false);
  const [fontSizeDraft, setFontSizeDraft] = React.useState('16');
  const colorPopoverRef = React.useRef(null);
  const fontSizeInputRef = React.useRef(null);

  const readCurrentFontSize = React.useCallback(() => {
    // Quill API 우선, fallback으로 label 텍스트를 파싱한다.
    const apiSize = Number(editorRef.current?.getSelectionFontSize?.());
    if (Number.isFinite(apiSize) && apiSize > 0) return Math.round(apiSize);
    const labelText = String(fontSizeLabelRef.current?.textContent || '').trim();
    const parsed = Number(labelText.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    return 16;
  }, [editorRef, fontSizeLabelRef]);

  const clampFontSize = React.useCallback((value) => {
    const safe = Number(value);
    if (!Number.isFinite(safe)) return null;
    return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(safe)));
  }, []);

  const openFontSizeEdit = React.useCallback(() => {
    const current = readCurrentFontSize();
    setFontSizeDraft(String(current));
    setFontSizeEditing(true);
  }, [readCurrentFontSize]);

  const commitFontSizeEdit = React.useCallback((options = {}) => {
    const { close = true } = options;
    const next = clampFontSize(fontSizeDraft);
    if (next == null) {
      setFontSizeDraft(String(readCurrentFontSize()));
      if (close) setFontSizeEditing(false);
      return;
    }
    const applied = Number(editorRef.current?.setFontSize?.(next));
    const safeApplied = Number.isFinite(applied) ? applied : next;
    setFontSizeDraft(String(safeApplied));
    if (close) setFontSizeEditing(false);
  }, [clampFontSize, editorRef, fontSizeDraft, readCurrentFontSize]);

  const applyColor = React.useCallback((nextColor, options = {}) => {
    const { closePalette = true } = options;
    const safeColor = String(nextColor || '').trim();
    if (!safeColor) return;
    setColorValue(safeColor);
    editorRef.current?.setColor(safeColor);
    if (closePalette) {
      setColorPaletteOpen(false);
      setCustomPickerOpen(false);
    }
  }, [editorRef]);

  const applyCustomColor = React.useCallback((nextColor) => {
    const safeColor = String(nextColor || '').trim();
    setCustomColorValue(safeColor);
    if (!HEX_COLOR_PATTERN.test(safeColor)) return;
    setColorValue(safeColor);
    editorRef.current?.setColor(safeColor);
  }, [editorRef]);

  React.useEffect(() => {
    if (!colorPaletteOpen) {
      setCustomPickerOpen(false);
      setCustomColorValue(colorValue);
      return () => {};
    }

    const onPointerDown = (event) => {
      // 바깥 클릭 시 팝오버를 닫아 키보드/마우스 UX를 일관화한다.
      if (!colorPopoverRef.current) return;
      if (colorPopoverRef.current.contains(event.target)) return;
      setColorPaletteOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setColorPaletteOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [colorPaletteOpen]);

  React.useEffect(() => {
    if (!fontSizeEditing) return;
    // 입력 모드 진입 직후 자동 focus/select로 숫자 재입력을 빠르게 한다.
    const id = window.requestAnimationFrame(() => {
      fontSizeInputRef.current?.focus();
      fontSizeInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [fontSizeEditing]);

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="리치 에디터 도구모음">
      <div className="editor-toolbar-group" role="group" aria-label="문자 서식">
        <ToolButton label="굵게" onClick={() => editorRef.current?.exec('bold')}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton label="기울임" onClick={() => editorRef.current?.exec('italic')}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton label="밑줄" onClick={() => editorRef.current?.exec('underline')}>
          <Underline size={14} />
        </ToolButton>
        <ToolButton label="취소선" onClick={() => editorRef.current?.exec('strikeThrough')}>
          <Strikethrough size={14} />
        </ToolButton>
      </div>

      <div className="editor-toolbar-group" role="group" aria-label="문단 서식">
        <ToolButton label="불릿 목록" onClick={() => editorRef.current?.exec('list', 'bullet')}>
          <List size={14} />
        </ToolButton>
        <ToolButton label="번호 목록" onClick={() => editorRef.current?.exec('list', 'ordered')}>
          <ListOrdered size={14} />
        </ToolButton>
        <ToolButton label="인용문" onClick={() => editorRef.current?.exec('blockquote')}>
          <Quote size={14} />
        </ToolButton>
        <ToolButton label="코드 블록" onClick={() => editorRef.current?.exec('code-block')}>
          <Code size={14} />
        </ToolButton>
      </div>

      <div className="editor-toolbar-group" role="group" aria-label="정렬과 들여쓰기">
        <ToolButton label="왼쪽 정렬" onClick={() => editorRef.current?.exec('align', '')}>
          <TextAlignStart size={14} />
        </ToolButton>
        <ToolButton label="가운데 정렬" onClick={() => editorRef.current?.exec('align', 'center')}>
          <TextAlignCenter size={14} />
        </ToolButton>
        <ToolButton label="오른쪽 정렬" onClick={() => editorRef.current?.exec('align', 'right')}>
          <TextAlignEnd size={14} />
        </ToolButton>
        <ToolButton label="내어쓰기" onClick={() => editorRef.current?.exec('indent', -1)}>
          <ListIndentDecrease size={14} />
        </ToolButton>
        <ToolButton label="들여쓰기" onClick={() => editorRef.current?.exec('indent', 1)}>
          <ListIndentIncrease size={14} />
        </ToolButton>
      </div>

      <div className="editor-toolbar-group" role="group" aria-label="글자 크기와 색상">
        <span className="badge editor-font-size">
          <Type size={12} />
          <button
            type="button"
            className={fontSizeEditing ? 'editor-font-size-trigger hidden' : 'editor-font-size-trigger'}
            title="글자 크기 직접 입력"
            aria-label="글자 크기 직접 입력"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openFontSizeEdit}
          >
            <span id={ids.fontSizeLabelId} ref={fontSizeLabelRef}>16px</span>
          </button>
          <input
            ref={fontSizeInputRef}
            type="text"
            inputMode="numeric"
            className={fontSizeEditing ? 'editor-font-size-input' : 'editor-font-size-input hidden'}
            value={fontSizeDraft}
            maxLength={2}
            aria-label="글자 크기(px)"
            onMouseDown={(event) => event.preventDefault()}
            onChange={(event) => {
              const raw = String(event.target.value || '');
              const digitsOnly = raw.replace(/[^\d]/g, '').slice(0, 2);
              setFontSizeDraft(digitsOnly);
            }}
            onBlur={() => {
              commitFontSizeEdit({ close: true });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitFontSizeEdit({ close: true });
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setFontSizeDraft(String(readCurrentFontSize()));
                setFontSizeEditing(false);
              }
            }}
          />
        </span>
        <ToolButton label="글자 작게" id={ids.fontDownId} onClick={() => editorRef.current?.stepFont(-1)}>
          <Minus size={14} />
        </ToolButton>
        <ToolButton label="글자 크게" id={ids.fontUpId} onClick={() => editorRef.current?.stepFont(1)}>
          <Plus size={14} />
        </ToolButton>
        <div className="editor-color-wrap" ref={colorPopoverRef}>
          <button
            type="button"
            id={ids.colorId}
            className="editor-color-picker"
            title="글자색"
            aria-label="글자색"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setColorPaletteOpen((prev) => {
                const next = !prev;
                if (next) setCustomColorValue(colorValue);
                return next;
              });
            }}
          >
            <Palette size={14} />
            <span className="editor-color-swatch" style={{ backgroundColor: colorValue }} aria-hidden="true" />
          </button>
          {colorPaletteOpen ? (
            <div
              className={customPickerOpen ? 'editor-color-popover is-custom-open' : 'editor-color-popover'}
              role="dialog"
              aria-label="글자색 선택"
            >
              {EDITOR_COLOR_PRESETS.map((color) => (
                <button
                  key={`editor-color-${color}`}
                  type="button"
                  className={color === colorValue ? 'editor-color-option is-active' : 'editor-color-option'}
                  style={{ backgroundColor: color }}
                  aria-label={`색상 ${color}`}
                  title={color}
                  onClick={() => applyColor(color)}
                />
              ))}
              <div className="editor-color-actions">
                <button
                  type="button"
                  className="editor-color-reset"
                  onClick={() => applyColor(DEFAULT_EDITOR_COLOR)}
                >
                  기본색
                </button>
                <button
                  type="button"
                  className="editor-color-custom"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCustomPickerOpen((prev) => !prev);
                    setCustomColorValue(colorValue);
                  }}
                  aria-expanded={customPickerOpen ? 'true' : 'false'}
                >
                  직접 선택
                </button>
              </div>
              {customPickerOpen ? (
                <div className="editor-color-custom-panel">
                  <HexColorPicker color={customColorValue} onChange={applyCustomColor} />
                  <div className="editor-color-custom-row">
                    <span className="editor-color-custom-label">HEX</span>
                    <HexColorInput
                      className="editor-color-hex-input"
                      color={customColorValue}
                      onChange={applyCustomColor}
                      prefixed
                      aria-label="HEX 색상값"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="editor-toolbar-group" role="group" aria-label="링크와 초기화">
        <ToolButton
          label="링크 추가"
          id={ids.linkId}
          onClick={() => {
            const url = window.prompt('하이퍼링크 URL(https://...)');
            if (!url) return;
            editorRef.current?.setLink(url);
          }}
        >
          <Link2 size={14} />
        </ToolButton>
        <ToolButton label="링크 해제" id={ids.unlinkId} onClick={() => editorRef.current?.removeLink()}>
          <Unlink2 size={14} />
        </ToolButton>
      </div>
    </div>
  );
}
