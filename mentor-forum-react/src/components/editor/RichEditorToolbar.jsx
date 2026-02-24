// Toolbar UI for rich-editor formatting actions.
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
  const colorPopoverRef = React.useRef(null);

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
          <span id={ids.fontSizeLabelId} ref={fontSizeLabelRef}>16px</span>
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
