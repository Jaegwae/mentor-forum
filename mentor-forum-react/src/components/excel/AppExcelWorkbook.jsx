/**
 * App 화면 엑셀 워크북 렌더/인터랙션 레이어.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';
import {
  getAppExcelCellClassName,
  getAppExcelCellStyle,
  getAppExcelCellText,
  normalizeAppExcelCell
} from './AppExcelCellRenderers.jsx';
import { toExcelColumnLabel } from './app-excel-sheet-model.js';

/**
 * App 화면의 "엑셀 스타일 인터랙션 레이어".
 * - 실제 데이터는 외부에서 row/col 모델로 주입받고, 본 컴포넌트는 렌더/선택/액션만 담당한다.
 * - 셀별 actionType/actionPayload 규약을 해석해 기존 AppPage 이벤트 핸들러로 연결한다.
 */
function canRun(cell, trigger) {
  if (!cell || !cell.actionType || cell.disabled) return false;
  const expected = String(cell.trigger || 'single');
  if (trigger === 'single') return expected === 'single';
  if (trigger === 'double') return expected === 'double' || expected === 'double-enter';
  if (trigger === 'enter') return expected === 'enter' || expected === 'double-enter';
  return false;
}

function toCellName(colIndex, rowIndex) {
  return `${toExcelColumnLabel(colIndex)}${rowIndex + 1}`;
}

function toCoordKey(colIndex, rowIndex) {
  return `${colIndex}:${rowIndex}`;
}

function parseCoordFromCellElement(target) {
  const baseElement = target && typeof target.closest === 'function'
    ? target
    : target?.parentElement || null;
  const td = baseElement?.closest?.('td[data-x][data-y]');
  if (!td) return null;
  const x = Number(td.getAttribute('data-x'));
  const y = Number(td.getAttribute('data-y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function applyWorksheetPresentation(root, cellMetaMap) {
  if (!root) return;
  // jspreadsheet 기본 셀 DOM에 커스텀 class/style/content를 매번 주입해
  // 앱 전용 시각 규칙(merge, action 상태, surface 색상)을 반영한다.
  const cells = root.querySelectorAll('td[data-x][data-y]');
  cells.forEach((td) => {
    const x = Number(td.getAttribute('data-x'));
    const y = Number(td.getAttribute('data-y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const cell = normalizeAppExcelCell(cellMetaMap.get(toCoordKey(x, y)));
    const classList = getAppExcelCellClassName(cell).split(' ').filter(Boolean);
    classList.forEach((className) => td.classList.add(className));

    const style = getAppExcelCellStyle(cell);
    Object.entries(style).forEach(([name, value]) => {
      if (name.startsWith('--')) {
        td.style.setProperty(name, String(value));
      } else {
        // DOM style object expects camelCase keys.
        td.style[name] = String(value);
      }
    });

    td.textContent = '';
    if (!cell.mergeChild) {
      const span = document.createElement('span');
      span.className = 'app-excel-cell-content';
      span.textContent = cell.text || '';
      td.appendChild(span);
      if (cell.text) td.setAttribute('title', cell.text);
    } else {
      td.removeAttribute('title');
    }
  });
}

export function AppExcelWorkbook({
  sheetRows = [],
  rowCount = 40,
  colCount = 20,
  onSelectCell,
  onOpenPost,
  onSelectBoard,
  onOpenComposer,
  onNavigateMyPosts,
  onNavigateMyComments,
  onNavigateAdmin,
  onOpenGuide,
  onToggleTheme,
  onLogout,
  onSortChange,
  onPageChange,
  onMoveHome,
  onOpenNotifications,
  onOpenMobilePush,
  onAction
}) {
  const containerRef = useRef(null);
  const selectionRef = useRef({ x: -1, y: -1 });
  const skipInitialSelectionRef = useRef(true);
  const pendingPointerCellRef = useRef(null);
  const [cellWidth, setCellWidth] = useState(84);
  const dispatchActionRef = useRef(null);
  const onSelectCellRef = useRef(null);

  const workbookModel = useMemo(() => {
    // sheetRows -> jspreadsheet 입력 데이터 + merge 메타 구조로 1회 변환한다.
    const data = [];
    const mergeCells = {};
    const cellMetaMap = new Map();
    const mergeAnchorMap = new Map();

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = [];
      const sourceRow = sheetRows[rowIndex] || {};
      let rowMergeAnchorCol = -1;
      let rowMergeRemaining = 0;
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        const field = `c${colIndex}`;
        const cell = normalizeAppExcelCell(sourceRow[field]);
        const key = toCoordKey(colIndex, rowIndex);
        cellMetaMap.set(key, cell);
        row.push(cell.mergeChild ? '' : cell.text);

        if (!cell.mergeChild && cell.mergeAcross > 0) {
          // 머지 anchor 셀은 jspreadsheet mergeCells 스펙으로 등록한다.
          const cellName = toCellName(colIndex, rowIndex);
          const spanWidth = Math.max(1, Math.min(cell.mergeAcross + 1, colCount - colIndex));
          mergeCells[cellName] = [spanWidth, 1];
          rowMergeAnchorCol = colIndex;
          rowMergeRemaining = cell.mergeAcross;
        } else if (cell.mergeChild && rowMergeRemaining > 0 && rowMergeAnchorCol >= 0) {
          // 머지 child 셀 좌표는 anchor 좌표로 역참조할 수 있게 별도 인덱스를 만든다.
          mergeAnchorMap.set(key, toCoordKey(rowMergeAnchorCol, rowIndex));
          rowMergeRemaining -= 1;
        } else {
          rowMergeAnchorCol = -1;
          rowMergeRemaining = 0;
        }
      }
      data.push(row);
    }

    return { data, mergeCells, cellMetaMap, mergeAnchorMap };
  }, [sheetRows, rowCount, colCount]);

  const dispatchAction = useCallback((cellValue) => {
    // 시트 모델에서 정의한 actionType 문자열을 페이지 콜백으로 라우팅한다.
    const cell = normalizeAppExcelCell(cellValue);
    const payload = cell.actionPayload || {};

    switch (cell.actionType) {
      case 'openGuide':
        onOpenGuide?.();
        break;
      case 'toggleTheme':
        onToggleTheme?.();
        break;
      case 'moveHome':
        onMoveHome?.();
        break;
      case 'logout':
        onLogout?.();
        break;
      case 'navigateMyPosts':
        onNavigateMyPosts?.();
        break;
      case 'navigateMyComments':
        onNavigateMyComments?.();
        break;
      case 'navigateAdmin':
        onNavigateAdmin?.();
        break;
      case 'openNotifications':
        onOpenNotifications?.();
        break;
      case 'openMobilePush':
        onOpenMobilePush?.();
        break;
      case 'selectBoard':
        if (payload.boardId) onSelectBoard?.(payload.boardId);
        break;
      case 'sort':
        if (payload.mode) onSortChange?.(payload.mode);
        break;
      case 'page':
        if (Number.isFinite(Number(payload.page))) onPageChange?.(Number(payload.page));
        break;
      case 'openComposer':
        onOpenComposer?.();
        break;
      case 'openPost':
        if (payload.postId) onOpenPost?.(payload.postId, payload.boardId || '');
        break;
      default:
        onAction?.(cell.actionType, payload, cell);
        break;
    }
  }, [
    onAction,
    onMoveHome,
    onNavigateAdmin,
    onNavigateMyComments,
    onNavigateMyPosts,
    onLogout,
    onOpenComposer,
    onOpenGuide,
    onOpenMobilePush,
    onOpenNotifications,
    onOpenPost,
    onPageChange,
    onSelectBoard,
    onSortChange,
    onToggleTheme
  ]);

  useLayoutEffect(() => { dispatchActionRef.current = dispatchAction; }, [dispatchAction]);
  useLayoutEffect(() => { onSelectCellRef.current = onSelectCell; }, [onSelectCell]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const updateCellWidth = () => {
      // 열 개수에 맞춰 셀 폭을 재계산하여 작은 뷰포트에서도 최소 가독성을 유지한다.
      const availableWidth = Math.max(0, root.clientWidth || 0);
      const nextWidth = Math.max(84, Math.ceil(availableWidth / Math.max(1, colCount)));
      setCellWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    updateCellWidth();

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateCellWidth());
      observer.observe(root);
    }

    window.addEventListener('resize', updateCellWidth);

    return () => {
      window.removeEventListener('resize', updateCellWidth);
      if (observer) observer.disconnect();
    };
  }, [colCount]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-excel-cell-width', `${cellWidth}px`);
    return () => {
      document.documentElement.style.removeProperty('--app-excel-cell-width');
    };
  }, [cellWidth]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    root.innerHTML = '';
    root.classList.add('app-excel-jss-root');
    root.setAttribute('tabindex', '0');
    root.style.setProperty('--app-excel-cell-width', `${cellWidth}px`);
    skipInitialSelectionRef.current = true;
    pendingPointerCellRef.current = null;

    const resolveAnchorCoord = (coord) => {
      if (!coord) return null;
      const key = toCoordKey(coord.x, coord.y);
      const anchorKey = workbookModel.mergeAnchorMap.get(key);
      // 머지 child를 클릭/선택한 경우 실제 액션 대상은 anchor 셀로 통일한다.
      if (!anchorKey) return coord;
      const [ax, ay] = anchorKey.split(':').map((value) => Number(value));
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) return coord;
      return { x: ax, y: ay };
    };

    const columns = Array.from({ length: colCount }, () => ({
      type: 'text',
      width: cellWidth,
      align: 'left',
      readOnly: true
    }));

    const worksheetLike = jspreadsheet(root, {
      data: workbookModel.data,
      columns,
      editable: false,
      allowExport: false,
      allowInsertColumn: false,
      allowDeleteColumn: false,
      allowInsertRow: false,
      allowDeleteRow: false,
      allowRenameColumn: false,
      columnSorting: false,
      columnDrag: false,
      rowDrag: false,
      selectionCopy: false,
      minDimensions: [colCount, rowCount],
      tableOverflow: true,
      tableWidth: `${colCount * cellWidth}px`,
      tableHeight: `${Math.max(rowCount * 24 + 2, 640)}px`,
      defaultColWidth: cellWidth,
      defaultRowHeight: 24,
      mergeCells: workbookModel.mergeCells,
      onload: () => {
        applyWorksheetPresentation(root, workbookModel.cellMetaMap);
      },
      onselection: (_instance, x1, y1) => {
        const x = Number(x1);
        const y = Number(y1);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        if (skipInitialSelectionRef.current) {
          return;
        }

        const resolvedCoord = resolveAnchorCoord({ x, y }) || { x, y };
        selectionRef.current = resolvedCoord;
        root.classList.add('has-user-selection');
        root.focus();
        const cell = workbookModel.cellMetaMap.get(toCoordKey(resolvedCoord.x, resolvedCoord.y));
        onSelectCellRef.current?.({
          label: toCellName(resolvedCoord.x, resolvedCoord.y),
          text: getAppExcelCellText(cell)
        });

        const pending = pendingPointerCellRef.current;
        if (pending && pending.x === resolvedCoord.x && pending.y === resolvedCoord.y) {
          // pointer down -> selection으로 이어진 정상 클릭에 대해서만 single 액션을 실행한다.
          if (canRun(cell, 'single')) {
            dispatchActionRef.current(cell);
          }
          pendingPointerCellRef.current = null;
        }
      }
    });

    const worksheet = Array.isArray(worksheetLike) ? worksheetLike[0] : worksheetLike;

    if (worksheet && typeof worksheet.hideIndex === 'function') {
      try {
        worksheet.hideIndex();
      } catch (_) {
        // ignore if this version does not support hideIndex safely
      }
    }

    requestAnimationFrame(() => {
      applyWorksheetPresentation(root, workbookModel.cellMetaMap);
      requestAnimationFrame(() => applyWorksheetPresentation(root, workbookModel.cellMetaMap));
    });

    const pickCellFromEvent = (target) => {
      const coord = parseCoordFromCellElement(target);
      if (!coord) return null;
      const resolvedCoord = resolveAnchorCoord(coord);
      if (!resolvedCoord) return null;
      const cell = workbookModel.cellMetaMap.get(toCoordKey(resolvedCoord.x, resolvedCoord.y));
      if (!cell) return null;
      return { coord: resolvedCoord, cell };
    };

    const onMouseDown = (event) => {
      skipInitialSelectionRef.current = false;
      if (event?.isTrusted === false) return;
      if (event.button !== 0) return;
      const found = pickCellFromEvent(event.target);
      if (!found) {
        pendingPointerCellRef.current = null;
        return;
      }
      pendingPointerCellRef.current = found.coord;
      root.classList.add('has-user-selection');
      root.focus();
      if (worksheet && typeof worksheet.removeCopySelection === 'function') {
        try {
          worksheet.removeCopySelection();
        } catch (_) {
          // ignore safety cleanup failure
        }
      }
      if (worksheet) {
        worksheet.selectedCorner = false;
      }
    };

    const onDoubleClick = (event) => {
      if (event?.isTrusted === false) return;
      const found = pickCellFromEvent(event.target);
      if (!found) return;
      // double 트리거는 브라우저 기본 더블클릭 이벤트를 기준으로 처리한다.
      if (canRun(found.cell, 'double')) dispatchActionRef.current(found.cell);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Enter') return;
      if (!root.classList.contains('has-user-selection')) return;
      const { x, y } = selectionRef.current;
      const cell = workbookModel.cellMetaMap.get(toCoordKey(x, y));
      if (!cell) return;
      if (canRun(cell, 'enter')) {
        // Enter 액션은 셀 편집 모드가 아니라 "선택된 액션 실행" 의미로 고정한다.
        event.preventDefault();
        dispatchActionRef.current(cell);
      }
    };

    root.addEventListener('mousedown', onMouseDown, true);
    root.addEventListener('dblclick', onDoubleClick, true);
    root.addEventListener('keydown', onKeyDown);

    selectionRef.current = { x: -1, y: -1 };
    root.classList.remove('has-user-selection');
    onSelectCellRef.current?.({
      label: '',
      text: '='
    });

    return () => {
      root.removeEventListener('mousedown', onMouseDown, true);
      root.removeEventListener('dblclick', onDoubleClick, true);
      root.removeEventListener('keydown', onKeyDown);
      try {
        if (worksheet && typeof worksheet.destroy === 'function') {
          worksheet.destroy();
        }
      } catch (_) {
        // ignore cleanup failure
      }
      root.innerHTML = '';
    };
  }, [cellWidth, colCount, rowCount, workbookModel]);

  return (
    <section className="app-excel-workbook" aria-label="앱 엑셀 워크북">
      <div className="app-excel-grid">
        <div ref={containerRef} />
      </div>
      <div className="app-excel-sheet-hint">
        <span>셀 선택: 방향키 이동 가능 · 게시글 제목은 클릭 또는 Enter</span>
        <span>{rowCount}행 × {colCount}열</span>
      </div>
    </section>
  );
}
