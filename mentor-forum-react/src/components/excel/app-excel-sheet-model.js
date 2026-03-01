/**
 * App 메인(/app) 화면을 "엑셀 셀 모델"로 변환하는 빌더.
 * - UI 텍스트/액션/활성상태를 셀 메타 데이터로 치환한다.
 * - 렌더러(AppExcelWorkbook)는 이 모델을 소비해 화면을 구성한다.
 */
export const APP_EXCEL_ROW_COUNT = 80;
export const APP_EXCEL_COL_COUNT = 20;

function toText(value) {
  return String(value == null ? '' : value).trim();
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createCell() {
  return {
    kind: 'blank',
    text: '',
    surface: 'sheet',
    borderTop: 1,
    borderRight: 1,
    borderBottom: 1,
    borderLeft: 1,
    actionType: '',
    actionPayload: null,
    trigger: '',
    active: false,
    disabled: false,
    formulaText: '',
    mergeAcross: 0,
    mergeChild: false
  };
}

function createRows(rowCount, colCount) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = { id: `r${rowIndex + 1}` };
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      row[`c${colIndex}`] = createCell();
    }
    return row;
  });
}

function validCell(rowCount, colCount, rowIndex, colIndex) {
  return (
    rowIndex >= 0 &&
    colIndex >= 0 &&
    rowIndex < rowCount &&
    colIndex < colCount
  );
}

function patchCell(rows, rowCount, colCount, rowIndex, colIndex, patch) {
  if (!validCell(rowCount, colCount, rowIndex, colIndex)) return;
  const field = `c${colIndex}`;
  rows[rowIndex][field] = {
    ...rows[rowIndex][field],
    ...patch
  };
}

function applyHorizontalMerge(rows, rowCount, colCount, rowIndex, colIndex, requestedSpan) {
  const span = Math.max(0, Math.floor(Number(requestedSpan) || 0));
  if (span <= 0 || !validCell(rowCount, colCount, rowIndex, colIndex)) return;
  const maxSpan = Math.min(span, colCount - colIndex - 1);
  if (maxSpan <= 0) return;

  const anchorField = `c${colIndex}`;
  const anchorCell = rows[rowIndex][anchorField];
  const rightBorderAtEnd = Number(anchorCell?.borderRight) || 1;

  patchCell(rows, rowCount, colCount, rowIndex, colIndex, {
    mergeAcross: maxSpan,
    mergeChild: false,
    borderRight: 0
  });

  // 머지 child 셀은 anchor의 상호작용 속성(action/trigger/disabled)을 그대로 상속한다.
  for (let offset = 1; offset <= maxSpan; offset += 1) {
    patchCell(rows, rowCount, colCount, rowIndex, colIndex + offset, {
      kind: 'merge-child',
      text: '',
      formulaText: '',
      surface: anchorCell.surface,
      mergeAcross: 0,
      mergeChild: true,
      actionType: anchorCell.actionType,
      actionPayload: anchorCell.actionPayload,
      trigger: anchorCell.trigger,
      active: false,
      disabled: anchorCell.disabled === true,
      borderTop: anchorCell.borderTop,
      borderBottom: anchorCell.borderBottom,
      borderLeft: 0,
      borderRight: offset === maxSpan ? rightBorderAtEnd : 0
    });
  }
}

function applySurfaceRange(rows, rowCount, colCount, startRow, startCol, endRow, endCol, surface) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      patchCell(rows, rowCount, colCount, row, col, { surface });
    }
  }
}

function applyOutlineRange(rows, rowCount, colCount, startRow, startCol, endRow, endCol) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      const patch = {};
      if (row === startRow) patch.borderTop = 2;
      if (row === endRow) patch.borderBottom = 2;
      if (col === startCol) patch.borderLeft = 2;
      if (col === endCol) patch.borderRight = 2;
      patchCell(rows, rowCount, colCount, row, col, patch);
    }
  }
}

function setActionCell(rows, rowCount, colCount, rowIndex, colIndex, text, actionType, actionPayload = null, patch = {}) {
  const requestedMergeAcross = Math.max(0, Math.floor(Number(patch.mergeAcross) || 0));
  patchCell(rows, rowCount, colCount, rowIndex, colIndex, {
    kind: patch.kind || 'button',
    text: toText(text),
    actionType: toText(actionType),
    actionPayload,
    trigger: patch.trigger || 'single',
    active: patch.active === true,
    disabled: patch.disabled === true,
    formulaText: patch.formulaText || toText(text),
    ...patch
  });
  applyHorizontalMerge(rows, rowCount, colCount, rowIndex, colIndex, requestedMergeAcross);
}

function setStaticCell(rows, rowCount, colCount, rowIndex, colIndex, text, patch = {}) {
  const requestedMergeAcross = Math.max(0, Math.floor(Number(patch.mergeAcross) || 0));
  patchCell(rows, rowCount, colCount, rowIndex, colIndex, {
    kind: patch.kind || 'text',
    text: toText(text),
    formulaText: patch.formulaText || toText(text),
    ...patch
  });
  applyHorizontalMerge(rows, rowCount, colCount, rowIndex, colIndex, requestedMergeAcross);
}

function normalizeBoardItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => !!item && !item.isDivider && toText(item.id))
    .map((item) => ({
      id: toText(item.id),
      name: toText(item.name) || toText(item.id),
      isSelected: item.isSelected === true
    }));
}

function normalizePosts(posts) {
  return (Array.isArray(posts) ? posts : []).map((post) => ({
    postId: toText(post.postId),
    boardId: toText(post.boardId),
    no: toText(post.no),
    title: toText(post.title) || '(제목 없음)',
    author: toText(post.author) || '-',
    dateText: toText(post.dateText) || '-',
    views: toText(post.views) || '0',
    boardLabel: toText(post.boardLabel) || '-'
  }));
}

export function toExcelColumnLabel(index) {
  let n = Math.max(1, Math.floor(index) + 1);
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function buildAppExcelSheetModel(input = {}) {
  const rowCount = Math.max(20, Math.floor(toNumber(input.rowCount, APP_EXCEL_ROW_COUNT)));
  const colCount = Math.max(12, Math.floor(toNumber(input.colCount, APP_EXCEL_COL_COUNT)));
  const rows = createRows(rowCount, colCount);

  const boardItems = normalizeBoardItems(input.boardItems);
  const posts = normalizePosts(input.posts);

  const selectedBoardId = toText(input.selectedBoardId);
  const currentBoardName = toText(input.currentBoardName) || '전체 게시글';
  const userDisplayName = toText(input.userDisplayName) || '사용자';
  const userRoleLabel = toText(input.userRoleLabel) || '-';
  const totalPostCount = Math.max(0, Math.floor(toNumber(input.totalPostCount, 0)));
  const hasUnreadNotifications = input.hasUnreadNotifications === true;
  const isMobilePushEnabled = input.isMobilePushEnabled === true;
  const canAccessAdminSite = input.canAccessAdminSite === true;
  const safeCurrentPage = Math.max(1, Math.floor(toNumber(input.safeCurrentPage, 1)));
  const totalPageCount = Math.max(1, Math.floor(toNumber(input.totalPageCount, 1)));
  const paginationPages = (Array.isArray(input.paginationPages) ? input.paginationPages : [])
    .map((pageNo) => Math.floor(toNumber(pageNo, 0)))
    .filter((pageNo) => pageNo > 0);
  const postListViewMode = toText(input.postListViewMode) === 'popular' ? 'popular' : 'latest';
  const emptyMessage = toText(input.emptyMessage) || '게시글이 없습니다.';
  const showComposerAction = input.showComposerAction !== false;

  // 레이아웃 surface를 먼저 채운 뒤, 섹션별 텍스트/액션 셀을 덮어쓴다.
  applySurfaceRange(rows, rowCount, colCount, 0, 0, 6, 19, 'hero');
  applySurfaceRange(rows, rowCount, colCount, 8, 0, 18, 5, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 19, 0, 32, 5, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 8, 6, 32, 19, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 13, 6, 30, 19, 'table');

  applyOutlineRange(rows, rowCount, colCount, 0, 0, 6, 19);
  applyOutlineRange(rows, rowCount, colCount, 8, 0, 18, 5);
  applyOutlineRange(rows, rowCount, colCount, 19, 0, 32, 5);
  applyOutlineRange(rows, rowCount, colCount, 8, 6, 32, 19);
  applyOutlineRange(rows, rowCount, colCount, 13, 6, 30, 19);

  setActionCell(rows, rowCount, colCount, 1, 1, '멘토스', 'moveHome', null, {
    kind: 'brand',
    surface: 'hero',
    trigger: 'single',
    mergeAcross: 6
  });
  setStaticCell(rows, rowCount, colCount, 2, 1, '멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!', {
    kind: 'subtitle',
    surface: 'hero',
    mergeAcross: 9
  });
  setActionCell(rows, rowCount, colCount, 2, 15, '사용 설명서', 'openGuide', null, {
    surface: 'hero',
    mergeAcross: 1
  });
  setActionCell(rows, rowCount, colCount, 2, 18, '테마 전환', 'toggleTheme', null, {
    surface: 'hero',
    mergeAcross: 0
  });

  setStaticCell(rows, rowCount, colCount, 9, 0, '내 정보', { kind: 'section-title', surface: 'panel', mergeAcross: 2 });
  setActionCell(rows, rowCount, colCount, 9, 4, '로그아웃', 'logout', null, { kind: 'danger', surface: 'panel' });
  setStaticCell(rows, rowCount, colCount, 11, 0, userDisplayName, { kind: 'text-strong', surface: 'panel', mergeAcross: 2 });
  setStaticCell(rows, rowCount, colCount, 12, 0, userRoleLabel, { kind: 'muted', surface: 'panel', mergeAcross: 2 });

  const profileActions = [
    { label: '내가 쓴 글', actionType: 'navigateMyPosts' },
    { label: '내가 쓴 댓글', actionType: 'navigateMyComments' },
    canAccessAdminSite ? { label: '관리자 사이트', actionType: 'navigateAdmin' } : null,
    { label: hasUnreadNotifications ? '알림 센터 N' : '알림 센터', actionType: 'openNotifications' },
    { label: isMobilePushEnabled ? '모바일 알림 켜짐' : '모바일 알림 꺼짐', actionType: 'openMobilePush' }
  ].filter(Boolean);

  // 좌측 패널 액션은 순서 기반 row 매핑을 고정해서 UI 위치를 안정적으로 유지한다.
  profileActions.forEach((item, idx) => {
    const rowIndex = 14 + idx;
    setActionCell(rows, rowCount, colCount, rowIndex, 0, item.label, item.actionType, null, {
      surface: 'panel',
      mergeAcross: 5
    });
  });

  setStaticCell(rows, rowCount, colCount, 20, 0, '게시판', { kind: 'section-title', surface: 'panel', mergeAcross: 2 });
  boardItems.slice(0, 11).forEach((board, idx) => {
    const rowIndex = 21 + idx;
    const selected = board.id === selectedBoardId || board.isSelected;
    setStaticCell(rows, rowCount, colCount, rowIndex, 0, String(idx + 1), {
      kind: 'index',
      surface: 'panel'
    });
    setActionCell(rows, rowCount, colCount, rowIndex, 1, board.name, 'selectBoard', { boardId: board.id }, {
      kind: 'board',
      active: selected,
      surface: selected ? 'board-active' : 'panel',
      mergeAcross: 4
    });
  });

  setStaticCell(rows, rowCount, colCount, 9, 6, currentBoardName, {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 7
  });
  setStaticCell(rows, rowCount, colCount, 9, 17, `${totalPostCount}건`, {
    kind: 'badge',
    surface: 'panel'
  });

  setActionCell(rows, rowCount, colCount, 11, 6, '최신', 'sort', { mode: 'latest' }, {
    kind: 'tab',
    active: postListViewMode === 'latest',
    surface: postListViewMode === 'latest' ? 'tab-active' : 'panel'
  });
  setActionCell(rows, rowCount, colCount, 11, 7, '인기', 'sort', { mode: 'popular' }, {
    kind: 'tab',
    active: postListViewMode === 'popular',
    surface: postListViewMode === 'popular' ? 'tab-active' : 'panel'
  });

  const headers = [
    { col: 6, text: '번호', mergeAcross: 0 },
    { col: 7, text: '제목', mergeAcross: 4 },
    { col: 12, text: '작성자', mergeAcross: 0 },
    { col: 14, text: '작성일', mergeAcross: 1 },
    { col: 16, text: '조회', mergeAcross: 0 },
    { col: 17, text: '게시판', mergeAcross: 2 }
  ];
  headers.forEach((header) => {
    setStaticCell(rows, rowCount, colCount, 13, header.col, header.text, {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: header.mergeAcross
    });
  });

  if (!posts.length) {
    setStaticCell(rows, rowCount, colCount, 15, 7, emptyMessage, {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 10
    });
  } else {
    // 게시글 목록은 최대 16행만 렌더링하고 페이지네이션으로 넘긴다.
    posts.slice(0, 16).forEach((post, idx) => {
      const rowIndex = 14 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, post.no, {
        kind: 'number',
        surface: 'table'
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 7, post.title, 'openPost', {
        postId: post.postId,
        boardId: post.boardId
      }, {
        kind: 'post-title',
        trigger: 'single',
        surface: 'table',
        mergeAcross: 4
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 12, post.author, {
        kind: 'text',
        surface: 'table'
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 14, post.dateText, {
        kind: 'text',
        mergeAcross: 1,
        surface: 'table'
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 16, post.views, {
        kind: 'number',
        surface: 'table'
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 17, post.boardLabel, {
        kind: 'text',
        mergeAcross: 2,
        surface: 'table'
      });
    });
  }

  setActionCell(rows, rowCount, colCount, 32, 6, '이전', 'page', { page: Math.max(1, safeCurrentPage - 1) }, {
    surface: 'panel',
    disabled: safeCurrentPage <= 1
  });
  const pageItems = paginationPages.length ? paginationPages : [safeCurrentPage];
  pageItems.slice(0, 5).forEach((pageNo, idx) => {
    setActionCell(rows, rowCount, colCount, 32, 7 + idx, String(pageNo), 'page', { page: pageNo }, {
      kind: 'page',
      active: pageNo === safeCurrentPage,
      surface: pageNo === safeCurrentPage ? 'tab-active' : 'panel'
    });
  });
  setActionCell(rows, rowCount, colCount, 32, 14, '다음', 'page', { page: Math.min(totalPageCount, safeCurrentPage + 1) }, {
    surface: 'panel',
    disabled: safeCurrentPage >= totalPageCount
  });
  setStaticCell(rows, rowCount, colCount, 32, 16, `${safeCurrentPage}/${totalPageCount}`, {
    kind: 'badge',
    surface: 'panel'
  });
  if (showComposerAction) {
    // 글쓰기 액션은 double-enter 트리거를 사용해 오동작 클릭을 줄인다.
    setActionCell(rows, rowCount, colCount, 32, 18, '글쓰기', 'openComposer', null, {
      kind: 'primary',
      surface: 'panel',
      trigger: 'double-enter',
      mergeAcross: 1
    });
  } else {
    setStaticCell(rows, rowCount, colCount, 32, 18, '', {
      kind: 'blank',
      surface: 'panel',
      mergeAcross: 1
    });
  }

  return {
    rowData: rows,
    rowCount,
    colCount
  };
}
