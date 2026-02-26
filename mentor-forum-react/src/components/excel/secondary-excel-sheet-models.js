export const EXCEL_STANDARD_ROW_COUNT = 120;
export const EXCEL_STANDARD_COL_COUNT = 20;

function toText(value) {
  return String(value == null ? '' : value).trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function limitText(value, maxLength = 84) {
  const text = toText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
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
  return rowIndex >= 0 && colIndex >= 0 && rowIndex < rowCount && colIndex < colCount;
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

function createBaseRows(rowCount, colCount) {
  const rows = createRows(rowCount, colCount);

  applySurfaceRange(rows, rowCount, colCount, 0, 0, 6, 19, 'hero');
  applySurfaceRange(rows, rowCount, colCount, 8, 0, 34, 5, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 8, 6, 34, 19, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 13, 6, 32, 19, 'table');

  applyOutlineRange(rows, rowCount, colCount, 0, 0, 6, 19);
  applyOutlineRange(rows, rowCount, colCount, 8, 0, 34, 5);
  applyOutlineRange(rows, rowCount, colCount, 8, 6, 34, 19);
  applyOutlineRange(rows, rowCount, colCount, 13, 6, 32, 19);

  return rows;
}

function applyHero(rows, rowCount, colCount, input = {}) {
  const title = toText(input.title) || '멘토스';
  const subtitle = toText(input.subtitle) || '멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!';
  const showGuide = input.showGuide !== false;
  const showTheme = input.showTheme !== false;

  setActionCell(rows, rowCount, colCount, 1, 1, title, 'moveHome', null, {
    kind: 'brand',
    surface: 'hero',
    mergeAcross: 6
  });
  setStaticCell(rows, rowCount, colCount, 2, 1, subtitle, {
    kind: 'subtitle',
    surface: 'hero',
    mergeAcross: 10
  });

  if (showGuide) {
    setActionCell(rows, rowCount, colCount, 2, 15, '사용 설명서', 'openGuide', null, {
      surface: 'hero',
      mergeAcross: 1
    });
  }

  if (showTheme) {
    setActionCell(rows, rowCount, colCount, 2, 18, '테마 전환', 'toggleTheme', null, {
      surface: 'hero'
    });
  }
}

function applyProfile(rows, rowCount, colCount, input = {}) {
  const userDisplayName = toText(input.userDisplayName) || '사용자';
  const userRoleLabel = toText(input.userRoleLabel) || '-';
  const actions = Array.isArray(input.actions) ? input.actions : [];

  setStaticCell(rows, rowCount, colCount, 9, 0, '내 정보', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 2
  });

  setActionCell(rows, rowCount, colCount, 9, 4, '로그아웃', 'logout', null, {
    kind: 'danger',
    surface: 'panel'
  });

  setStaticCell(rows, rowCount, colCount, 11, 0, userDisplayName, {
    kind: 'text-strong',
    surface: 'panel',
    mergeAcross: 2
  });

  setStaticCell(rows, rowCount, colCount, 12, 0, userRoleLabel, {
    kind: 'muted',
    surface: 'panel',
    mergeAcross: 2
  });

  actions.slice(0, 7).forEach((item, idx) => {
    const rowIndex = 14 + idx;
    setActionCell(rows, rowCount, colCount, rowIndex, 0, item.label, item.actionType, item.actionPayload || null, {
      kind: item.kind || 'button',
      active: item.active === true,
      disabled: item.disabled === true,
      surface: item.active ? 'board-active' : 'panel',
      mergeAcross: 5
    });
  });
}

function buildPagination(rows, rowCount, colCount, baseRow, input = {}) {
  const safeCurrentPage = Math.max(1, Math.floor(toNumber(input.safeCurrentPage, 1)));
  const totalPageCount = Math.max(1, Math.floor(toNumber(input.totalPageCount, 1)));
  const pageItemsRaw = Array.isArray(input.paginationPages) ? input.paginationPages : [safeCurrentPage];
  const pageItems = pageItemsRaw
    .map((item) => Math.floor(toNumber(item, 0)))
    .filter((item) => item > 0)
    .slice(0, 5);

  setActionCell(rows, rowCount, colCount, baseRow, 6, '이전', 'page', { page: Math.max(1, safeCurrentPage - 1) }, {
    surface: 'panel',
    disabled: safeCurrentPage <= 1
  });

  pageItems.forEach((pageNo, idx) => {
    setActionCell(rows, rowCount, colCount, baseRow, 7 + idx, String(pageNo), 'page', { page: pageNo }, {
      kind: 'page',
      active: pageNo === safeCurrentPage,
      surface: pageNo === safeCurrentPage ? 'tab-active' : 'panel'
    });
  });

  setActionCell(rows, rowCount, colCount, baseRow, 14, '다음', 'page', { page: Math.min(totalPageCount, safeCurrentPage + 1) }, {
    surface: 'panel',
    disabled: safeCurrentPage >= totalPageCount
  });

  setStaticCell(rows, rowCount, colCount, baseRow, 16, `${safeCurrentPage}/${totalPageCount}`, {
    kind: 'badge',
    surface: 'panel'
  });
}

export function buildMyPostsExcelSheetModel(input = {}) {
  const rowCount = EXCEL_STANDARD_ROW_COUNT;
  const colCount = EXCEL_STANDARD_COL_COUNT;
  const rows = createBaseRows(rowCount, colCount);

  applyHero(rows, rowCount, colCount, {
    title: '멘토스',
    subtitle: '멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!'
  });

  applyProfile(rows, rowCount, colCount, {
    userDisplayName: input.userDisplayName,
    userRoleLabel: input.userRoleLabel,
    actions: [
      { label: '포럼으로', actionType: 'moveHome' },
      { label: '내가 쓴 글', actionType: 'navigateMyPosts', active: true },
      { label: '내가 쓴 댓글', actionType: 'navigateMyComments' }
    ]
  });

  const posts = Array.isArray(input.posts) ? input.posts : [];
  const totalCount = posts.length;

  setStaticCell(rows, rowCount, colCount, 9, 6, '작성한 글 목록', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 7
  });
  setStaticCell(rows, rowCount, colCount, 9, 17, `${totalCount}건`, {
    kind: 'badge',
    surface: 'panel'
  });

  const headers = [
    { col: 6, text: '번호', mergeAcross: 0 },
    { col: 7, text: '제목', mergeAcross: 5 },
    { col: 13, text: '게시판', mergeAcross: 1 },
    { col: 15, text: '작성일', mergeAcross: 1 },
    { col: 17, text: '조회', mergeAcross: 0 }
  ];
  headers.forEach((header) => {
    setStaticCell(rows, rowCount, colCount, 13, header.col, header.text, {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: header.mergeAcross
    });
  });

  if (!posts.length) {
    setStaticCell(rows, rowCount, colCount, 15, 7, toText(input.emptyMessage) || '작성한 게시글이 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 9
    });
  } else {
    posts.slice(0, 16).forEach((post, idx) => {
      const rowIndex = 14 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, String(post.no || totalCount - idx), {
        kind: 'number',
        surface: 'table'
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 7, limitText(post.title || '(제목 없음)', 46), 'openPost', {
        postId: toText(post.postId || post.id),
        boardId: toText(post.boardId)
      }, {
        kind: 'post-title',
        surface: 'table',
        mergeAcross: 5
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 13, limitText(post.boardLabel || post.boardName || '-', 14), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 1
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 15, limitText(post.dateText || post.date || '-', 18), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 1
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 17, String(toNumber(post.views, 0)), {
        kind: 'number',
        surface: 'table'
      });
    });
  }

  buildPagination(rows, rowCount, colCount, 32, input);

  return { rowData: rows, rowCount, colCount };
}

export function buildMyCommentsExcelSheetModel(input = {}) {
  const rowCount = EXCEL_STANDARD_ROW_COUNT;
  const colCount = EXCEL_STANDARD_COL_COUNT;
  const rows = createBaseRows(rowCount, colCount);

  applyHero(rows, rowCount, colCount, {
    title: '멘토스',
    subtitle: '멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!'
  });

  applyProfile(rows, rowCount, colCount, {
    userDisplayName: input.userDisplayName,
    userRoleLabel: input.userRoleLabel,
    actions: [
      { label: '포럼으로', actionType: 'moveHome' },
      { label: '내가 쓴 글', actionType: 'navigateMyPosts' },
      { label: '내가 쓴 댓글', actionType: 'navigateMyComments', active: true }
    ]
  });

  const comments = Array.isArray(input.comments) ? input.comments : [];

  setStaticCell(rows, rowCount, colCount, 9, 6, '작성한 댓글 목록', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 7
  });
  setStaticCell(rows, rowCount, colCount, 9, 17, `${comments.length}건`, {
    kind: 'badge',
    surface: 'panel'
  });

  const headers = [
    { col: 6, text: '번호', mergeAcross: 0 },
    { col: 7, text: '댓글 내용', mergeAcross: 3 },
    { col: 11, text: '게시글', mergeAcross: 3 },
    { col: 15, text: '게시판', mergeAcross: 1 },
    { col: 17, text: '작성일', mergeAcross: 2 }
  ];
  headers.forEach((header) => {
    setStaticCell(rows, rowCount, colCount, 13, header.col, header.text, {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: header.mergeAcross
    });
  });

  if (!comments.length) {
    setStaticCell(rows, rowCount, colCount, 15, 7, toText(input.emptyMessage) || '작성한 댓글이 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 10
    });
  } else {
    comments.slice(0, 16).forEach((comment, idx) => {
      const rowIndex = 14 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, String(comment.no || comments.length - idx), {
        kind: 'number',
        surface: 'table'
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 7, limitText(comment.commentText || comment.contentText || '-', 28), 'openCommentPost', {
        commentId: toText(comment.commentId || comment.id),
        postId: toText(comment.postId),
        boardId: toText(comment.boardId)
      }, {
        kind: 'post-title',
        surface: 'table',
        mergeAcross: 3
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 11, limitText(comment.postTitle || '-', 28), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 3
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 15, limitText(comment.boardName || '-', 14), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 1
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 17, limitText(comment.dateText || comment.date || '-', 20), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 2
      });
    });
  }

  buildPagination(rows, rowCount, colCount, 32, input);

  return { rowData: rows, rowCount, colCount };
}

export function buildPostDetailExcelSheetModel(input = {}) {
  const rowCount = EXCEL_STANDARD_ROW_COUNT;
  const colCount = EXCEL_STANDARD_COL_COUNT;
  const rows = createRows(rowCount, colCount);

  // --- Compute dynamic layout metrics (pure math, no cell writes) ---
  const bodyText = toText(input.bodyText) || '내용이 없습니다.';
  const bodyLines = bodyText
    .replace(/\s+/g, ' ')
    .match(/.{1,84}/g) || ['내용이 없습니다.'];
  const maxBodyLines = Math.min(bodyLines.length, 40);
  const bodyEndRow = 18 + maxBodyLines;

  const comments = Array.isArray(input.comments) ? input.comments : [];
  const commentHeaderRow = bodyEndRow + 2;
  const commentWriteRow = commentHeaderRow + 1 + Math.max(comments.length, 2) + 1;

  const isCoverFor = input.isCoverForPost === true;
  const coverEntries = isCoverFor ? (Array.isArray(input.coverDateEntries) ? input.coverDateEntries : []) : [];
  const lastContentRow = isCoverFor
    ? commentWriteRow + 4 + Math.max(coverEntries.length, 1)
    : commentWriteRow + 1;

  // --- Apply surface/outline ranges using dynamic extents ---
  applySurfaceRange(rows, rowCount, colCount, 0, 0, 6, 19, 'hero');
  applySurfaceRange(rows, rowCount, colCount, 8, 0, lastContentRow, 5, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 8, 6, lastContentRow, 19, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 13, 6, lastContentRow, 19, 'table');

  applyOutlineRange(rows, rowCount, colCount, 0, 0, 6, 19);
  applyOutlineRange(rows, rowCount, colCount, 8, 0, lastContentRow, 5);
  applyOutlineRange(rows, rowCount, colCount, 8, 6, lastContentRow, 19);
  applyOutlineRange(rows, rowCount, colCount, 13, 6, lastContentRow, 19);

  applyHero(rows, rowCount, colCount, {
    title: '멘토스',
    subtitle: '멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!'
  });

  applyProfile(rows, rowCount, colCount, {
    userDisplayName: input.userDisplayName,
    userRoleLabel: input.userRoleLabel,
    actions: [
      { label: '포럼으로', actionType: 'moveHome' },
      { label: '내가 쓴 글', actionType: 'navigateMyPosts' },
      { label: '내가 쓴 댓글', actionType: 'navigateMyComments' },
      input.canAccessAdminSite ? { label: '관리자 사이트', actionType: 'navigateAdmin' } : null
    ].filter(Boolean)
  });

  setStaticCell(rows, rowCount, colCount, 9, 6, limitText(input.boardLabel || '게시글 상세', 28), {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 7
  });
  setStaticCell(rows, rowCount, colCount, 9, 17, `${Math.max(0, toNumber(input.commentCount, 0))}건`, {
    kind: 'badge',
    surface: 'panel'
  });

  setActionCell(rows, rowCount, colCount, 10, 6, '목록으로', 'backToList', null, {
    surface: 'panel',
    mergeAcross: 1
  });

  if (input.canModerate === true) {
    setActionCell(rows, rowCount, colCount, 10, 17, '수정', 'openEdit', null, {
      surface: 'panel'
    });
    setActionCell(rows, rowCount, colCount, 10, 18, '삭제', 'deletePost', null, {
      kind: 'danger',
      surface: 'panel'
    });
  }

  setStaticCell(rows, rowCount, colCount, 12, 6, '제목', {
    kind: 'table-header',
    surface: 'table-header'
  });
  setStaticCell(rows, rowCount, colCount, 13, 6, limitText(input.title || '(제목 없음)', 86), {
    kind: 'text-strong',
    surface: 'table',
    mergeAcross: 12
  });

  setStaticCell(rows, rowCount, colCount, 15, 6, limitText(input.metaLine || '-', 96), {
    kind: 'muted',
    surface: 'table',
    mergeAcross: 12
  });

  setStaticCell(rows, rowCount, colCount, 17, 6, '내용', {
    kind: 'table-header',
    surface: 'table-header'
  });

  bodyLines.slice(0, maxBodyLines).forEach((line, idx) => {
    setStaticCell(rows, rowCount, colCount, 18 + idx, 6, line, {
      kind: idx === 0 ? 'text' : 'muted',
      surface: 'table',
      mergeAcross: 12
    });
  });

  setStaticCell(rows, rowCount, colCount, bodyEndRow + 1, 6, `댓글 ${Math.max(0, toNumber(input.commentCount, 0))}건`, {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 6
  });

  const commentHeaders = [
    { col: 6, text: '번호', mergeAcross: 0 },
    { col: 7, text: '작성자', mergeAcross: 2 },
    { col: 10, text: '작성일', mergeAcross: 2 },
    { col: 13, text: '내용', mergeAcross: 3 },
    { col: 17, text: '답글', mergeAcross: 0 },
    { col: 18, text: '삭제', mergeAcross: 0 }
  ];
  commentHeaders.forEach((header) => {
    setStaticCell(rows, rowCount, colCount, commentHeaderRow, header.col, header.text, {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: header.mergeAcross
    });
  });

  if (!comments.length) {
    setStaticCell(rows, rowCount, colCount, commentHeaderRow + 2, 7, '댓글이 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 10
    });
  } else {
    comments.slice(0, 8).forEach((comment, idx) => {
      const rowIndex = commentHeaderRow + 1 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, String(idx + 1), {
        kind: 'number',
        surface: 'table'
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 7, limitText(comment.author || '-', 16), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 2
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 10, limitText(comment.dateText || '-', 20), {
        kind: 'text',
        surface: 'table',
        mergeAcross: 2
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 13, limitText(comment.contentText || '-', 38), 'focusComment', {
        commentId: toText(comment.commentId || comment.id)
      }, {
        kind: 'post-title',
        surface: 'table',
        mergeAcross: 3,
        disabled: !toText(comment.commentId || comment.id)
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 17, '답글', 'replyToComment', {
        commentId: toText(comment.commentId || comment.id),
        authorName: toText(comment.author),
        depth: toNumber(comment.depth, 0)
      }, {
        surface: 'table',
        disabled: comment.canReply !== true
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 18, '삭제', 'deleteComment', {
        commentId: toText(comment.commentId || comment.id)
      }, {
        kind: 'danger',
        surface: 'table',
        disabled: comment.canDelete !== true
      });
    });
  }

  if (input.canWriteComment === true) {
    setActionCell(rows, rowCount, colCount, commentWriteRow, 18, '댓글 작성', 'openCommentComposer', null, {
      kind: 'primary',
      surface: 'panel',
      mergeAcross: 1,
      trigger: 'double-enter'
    });
  }

  if (isCoverFor) {

    setStaticCell(rows, rowCount, colCount, commentWriteRow + 2, 6, '요청 날짜 상태', {
      kind: 'section-title',
      surface: 'panel',
      mergeAcross: 6
    });
    setStaticCell(rows, rowCount, colCount, commentWriteRow + 2, 17, `${coverEntries.length}건`, {
      kind: 'badge',
      surface: 'panel'
    });

    setStaticCell(rows, rowCount, colCount, commentWriteRow + 3, 6, '날짜', {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: 2
    });
    setStaticCell(rows, rowCount, colCount, commentWriteRow + 3, 9, '시간', {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: 2
    });
    setStaticCell(rows, rowCount, colCount, commentWriteRow + 3, 12, '장소', {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: 2
    });
    setStaticCell(rows, rowCount, colCount, commentWriteRow + 3, 15, '상태', {
      kind: 'table-header',
      surface: 'table-header'
    });
    if (input.canChangeCoverStatus) {
      setStaticCell(rows, rowCount, colCount, commentWriteRow + 3, 17, '작업', {
        kind: 'table-header',
        surface: 'table-header',
        mergeAcross: 1
      });
    }

    coverEntries.slice(0, 6).forEach((entry, idx) => {
      const rowIndex = commentWriteRow + 4 + idx;
      const dateStatus = toText(entry.status) || 'seeking';
      const startTime = toText(entry.startTime) || '09:00';
      const endTime = toText(entry.endTime) || '18:00';

      setStaticCell(rows, rowCount, colCount, rowIndex, 6, toText(entry.dateKey), {
        surface: 'table',
        mergeAcross: 2
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 9, `${startTime}~${endTime}`, {
        surface: 'table',
        mergeAcross: 2
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 12, toText(entry.venue), {
        surface: 'table',
        mergeAcross: 2
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 15, toText(entry.statusLabel || entry.status), {
        kind: 'badge',
        surface: 'table'
      });

      if (input.canChangeCoverStatus) {
        if (dateStatus === 'completed') {
          if (input.canResetCoverToSeeking) {
            setActionCell(rows, rowCount, colCount, rowIndex, 17, '구하는 중', 'updateCoverStatus', {
              index: idx,
              nextStatus: 'seeking'
            }, {
              surface: 'table'
            });
          }
        } else if (dateStatus !== 'cancelled') {
          setActionCell(rows, rowCount, colCount, rowIndex, 17, '완료', 'updateCoverStatus', {
            index: idx,
            nextStatus: 'completed'
          }, {
            surface: 'table'
          });
        }

        if (dateStatus === 'cancelled') {
          if (input.canResetCoverToSeeking) {
            setActionCell(rows, rowCount, colCount, rowIndex, 18, '구하는 중', 'updateCoverStatus', {
              index: idx,
              nextStatus: 'seeking'
            }, {
              surface: 'table'
            });
          }
        } else if (dateStatus !== 'completed') {
          setActionCell(rows, rowCount, colCount, rowIndex, 18, '취소', 'updateCoverStatus', {
            index: idx,
            nextStatus: 'cancelled'
          }, {
            kind: 'danger',
            surface: 'table'
          });
        }
      }
    });
  }

  return { rowData: rows, rowCount, colCount };
}

export function buildAdminExcelSheetModel(input = {}) {
  const rowCount = EXCEL_STANDARD_ROW_COUNT;
  const colCount = EXCEL_STANDARD_COL_COUNT;
  const rows = createRows(rowCount, colCount);

  applySurfaceRange(rows, rowCount, colCount, 0, 0, 6, 19, 'hero');
  applySurfaceRange(rows, rowCount, colCount, 8, 0, 54, 5, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 8, 6, 54, 19, 'panel');
  applySurfaceRange(rows, rowCount, colCount, 11, 19, 20, 19, 'table');
  applySurfaceRange(rows, rowCount, colCount, 24, 6, 31, 19, 'table');
  applySurfaceRange(rows, rowCount, colCount, 35, 6, 43, 19, 'table');
  applySurfaceRange(rows, rowCount, colCount, 48, 6, 58, 19, 'table');

  applyOutlineRange(rows, rowCount, colCount, 0, 0, 6, 19);
  applyOutlineRange(rows, rowCount, colCount, 8, 0, 54, 5);
  applyOutlineRange(rows, rowCount, colCount, 8, 6, 54, 19);
  applyOutlineRange(rows, rowCount, colCount, 11, 6, 20, 19);
  applyOutlineRange(rows, rowCount, colCount, 24, 6, 31, 19);
  applyOutlineRange(rows, rowCount, colCount, 35, 6, 43, 19);
  applyOutlineRange(rows, rowCount, colCount, 48, 6, 58, 19);

  applyHero(rows, rowCount, colCount, {
    title: '관리자 사이트',
    subtitle: 'Admin / Super_Admin 권한 관리 화면',
    showGuide: false,
    showTheme: true
  });

  applyProfile(rows, rowCount, colCount, {
    userDisplayName: input.adminNickname,
    userRoleLabel: input.adminRoleText,
    actions: [
      { label: '포럼으로', actionType: 'moveHome' },
      { label: '로그아웃', actionType: 'logout', kind: 'danger' }
    ]
  });

  const boardRows = Array.isArray(input.boardRows) ? input.boardRows : [];
  const venueRows = Array.isArray(input.venueRows) ? input.venueRows : [];
  const roleRows = Array.isArray(input.roleRows) ? input.roleRows : [];
  const userRows = Array.isArray(input.userRows) ? input.userRows : [];

  setStaticCell(rows, rowCount, colCount, 9, 6, '게시판 관리', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 5
  });
  setStaticCell(rows, rowCount, colCount, 9, 16, `${boardRows.length}개`, {
    kind: 'badge',
    surface: 'panel'
  });
  setActionCell(rows, rowCount, colCount, 9, 17, '새로고침', 'refreshBoards', null, { surface: 'panel' });
  setActionCell(rows, rowCount, colCount, 9, 18, '수정', 'openBoardEdit', null, { surface: 'panel' });
  setActionCell(rows, rowCount, colCount, 9, 19, '생성', 'openBoardCreate', null, { kind: 'primary', surface: 'panel' });

  const boardHeaders = [
    { col: 6, text: 'ID', mergeAcross: 1 },
    { col: 8, text: '이름', mergeAcross: 1 },
    { col: 10, text: '설명', mergeAcross: 5 },
    { col: 16, text: '허용 등급', mergeAcross: 3 }
  ];
  boardHeaders.forEach((header) => {
    setStaticCell(rows, rowCount, colCount, 11, header.col, header.text, {
      kind: 'table-header',
      surface: 'table-header',
      mergeAcross: header.mergeAcross
    });
  });

  if (!boardRows.length) {
    setStaticCell(rows, rowCount, colCount, 13, 8, '게시판이 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 8
    });
  } else {
    boardRows.slice(0, 8).forEach((board, idx) => {
      const rowIndex = 12 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, limitText(board.id || '-', 16), { surface: 'table', mergeAcross: 1 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 8, limitText(board.name || '-', 16), { surface: 'table', mergeAcross: 1 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 10, limitText(board.description || '-', 44), { surface: 'table', mergeAcross: 5 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 16, limitText(board.allowedRolesText || '-', 28), { surface: 'table', mergeAcross: 3 });
    });
  }

  setStaticCell(rows, rowCount, colCount, 22, 6, '체험관', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 4
  });
  setStaticCell(rows, rowCount, colCount, 22, 16, `${venueRows.length}개`, {
    kind: 'badge',
    surface: 'panel'
  });
  setActionCell(rows, rowCount, colCount, 22, 18, '새로고침', 'refreshVenues', null, { surface: 'panel', mergeAcross: 1 });

  setStaticCell(rows, rowCount, colCount, 24, 6, '번호', { kind: 'table-header', surface: 'table-header' });
  setStaticCell(rows, rowCount, colCount, 24, 7, '체험관 이름', { kind: 'table-header', surface: 'table-header', mergeAcross: 7 });
  setStaticCell(rows, rowCount, colCount, 24, 15, '작업', { kind: 'table-header', surface: 'table-header', mergeAcross: 2 });

  if (!venueRows.length) {
    setStaticCell(rows, rowCount, colCount, 26, 8, '등록된 체험관이 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 7
    });
  } else {
    venueRows.slice(0, 6).forEach((venue, idx) => {
      const rowIndex = 25 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, String(idx + 1), { kind: 'number', surface: 'table' });
      setStaticCell(rows, rowCount, colCount, rowIndex, 7, limitText(venue.label || venue.name || '-', 34), { surface: 'table', mergeAcross: 7 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 15, '저장/삭제', { kind: 'muted', surface: 'table', mergeAcross: 2 });
    });
  }

  setStaticCell(rows, rowCount, colCount, 33, 6, '등급(Role) 정의', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 4
  });
  setStaticCell(rows, rowCount, colCount, 33, 16, `${roleRows.length}개`, {
    kind: 'badge',
    surface: 'panel'
  });
  setActionCell(rows, rowCount, colCount, 33, 17, '등급 수정', 'openRoleEdit', null, { surface: 'panel', mergeAcross: 1 });
  setActionCell(rows, rowCount, colCount, 33, 19, '등급 생성', 'openRoleCreate', null, { kind: 'primary', surface: 'panel' });

  setStaticCell(rows, rowCount, colCount, 35, 6, 'Role', { kind: 'table-header', surface: 'table-header', mergeAcross: 1 });
  setStaticCell(rows, rowCount, colCount, 35, 8, '표시명', { kind: 'table-header', surface: 'table-header', mergeAcross: 2 });
  setStaticCell(rows, rowCount, colCount, 35, 11, 'Level', { kind: 'table-header', surface: 'table-header' });
  setStaticCell(rows, rowCount, colCount, 35, 12, '권한 요약', { kind: 'table-header', surface: 'table-header', mergeAcross: 7 });

  if (!roleRows.length) {
    setStaticCell(rows, rowCount, colCount, 37, 8, 'Role 정의가 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 7
    });
  } else {
    roleRows.slice(0, 7).forEach((roleRow, idx) => {
      const rowIndex = 36 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, limitText(roleRow.role || '-', 16), { surface: 'table', mergeAcross: 1 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 8, limitText(roleRow.labelKo || '-', 18), { surface: 'table', mergeAcross: 2 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 11, String(toNumber(roleRow.level, 0) || '-'), { surface: 'table' });
      setStaticCell(rows, rowCount, colCount, rowIndex, 12, limitText(roleRow.summary || '-', 52), { surface: 'table', mergeAcross: 7 });
    });
  }

  setStaticCell(rows, rowCount, colCount, 46, 6, '회원 등급 변경', {
    kind: 'section-title',
    surface: 'panel',
    mergeAcross: 4
  });
  setStaticCell(rows, rowCount, colCount, 46, 16, `${userRows.length}명`, {
    kind: 'badge',
    surface: 'panel'
  });
  setActionCell(rows, rowCount, colCount, 46, 17, '새로고침', 'refreshUsers', null, { surface: 'panel' });
  setActionCell(rows, rowCount, colCount, 46, 18, '닉네임 동기화', 'syncNicknameIndex', null, { surface: 'panel', mergeAcross: 1 });

  setStaticCell(rows, rowCount, colCount, 48, 6, '이메일', { kind: 'table-header', surface: 'table-header', mergeAcross: 3 });
  setStaticCell(rows, rowCount, colCount, 48, 10, '이름', { kind: 'table-header', surface: 'table-header', mergeAcross: 1 });
  setStaticCell(rows, rowCount, colCount, 48, 12, '현재 등급', { kind: 'table-header', surface: 'table-header', mergeAcross: 1 });
  setStaticCell(rows, rowCount, colCount, 48, 14, '변경할 등급', { kind: 'table-header', surface: 'table-header', mergeAcross: 2 });
  setStaticCell(rows, rowCount, colCount, 48, 17, '상태', { kind: 'table-header', surface: 'table-header' });
  setStaticCell(rows, rowCount, colCount, 48, 18, '적용', { kind: 'table-header', surface: 'table-header' });

  if (!userRows.length) {
    setStaticCell(rows, rowCount, colCount, 50, 8, '회원 데이터가 없습니다.', {
      kind: 'muted',
      surface: 'table',
      mergeAcross: 8
    });
  } else {
    userRows.slice(0, 9).forEach((user, idx) => {
      const rowIndex = 49 + idx;
      setStaticCell(rows, rowCount, colCount, rowIndex, 6, limitText(user.email || '-', 28), { surface: 'table', mergeAcross: 3 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 10, limitText(user.name || '-', 14), { surface: 'table', mergeAcross: 1 });
      setStaticCell(rows, rowCount, colCount, rowIndex, 12, limitText(user.currentRole || '-', 14), { surface: 'table', mergeAcross: 1 });
      setActionCell(rows, rowCount, colCount, rowIndex, 14, limitText(user.draftRole || user.currentRole || '-', 18), 'cycleUserRole', {
        uid: toText(user.uid)
      }, {
        kind: 'button',
        surface: 'table',
        mergeAcross: 2,
        disabled: user.locked === true
      });
      setStaticCell(rows, rowCount, colCount, rowIndex, 17, limitText(user.state || '-', 10), {
        kind: user.canSave ? 'primary' : 'muted',
        surface: 'table'
      });
      setActionCell(rows, rowCount, colCount, rowIndex, 18, '적용', 'saveUserRoleExcel', {
        uid: toText(user.uid)
      }, {
        kind: 'primary',
        surface: 'table',
        disabled: user.canSave !== true
      });
    });
  }

  return { rowData: rows, rowCount, colCount };
}
