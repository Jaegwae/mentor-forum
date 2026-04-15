// PostPage edit-modal workflow hook.
// - Coordinates edit modal open/close state, work-schedule table editing, and
//   submit behavior for post updates.
import { useCallback, useState } from 'react';

export function usePostEditModal({
  currentPost,
  canModerateCurrentPost,
  currentBoardAccessDebug,
  currentUser,
  currentUserProfile,
  permissions,
  editEditorRef,
  postFirestore,
  normalizeText,
  normalizeEditableTableGrid,
  sanitizeStoredContentHtml,
  extractEditableTableGridFromHtml,
  extractWorkScheduleRowsFromHtml,
  replaceFirstTableInHtml,
  stripHtmlToText,
  plainRichPayload,
  normalizeErrMessage,
  joinDebugParts,
  boardAccessDebugText,
  debugCodePoints,
  serverTimestamp,
  setCurrentPost,
  setMessage,
  isPermissionDeniedError,
  WORK_SCHEDULE_BOARD_ID
}) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHtmlContent, setEditHtmlContent] = useState('');
  const [editWorkScheduleTableRows, setEditWorkScheduleTableRows] = useState([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editMessage, setEditMessage] = useState({ type: '', text: '' });

  const addEditWorkScheduleRow = useCallback(() => {
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const columnCount = Math.max(1, source[0]?.length || 1);
      return [...source, new Array(columnCount).fill('')];
    });
  }, [normalizeEditableTableGrid]);

  const addEditWorkScheduleColumn = useCallback(() => {
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      return source.map((row) => [...row, '']);
    });
  }, [normalizeEditableTableGrid]);

  const updateEditWorkScheduleCell = useCallback((rowIndex, columnIndex, value) => {
    const safeRowIndex = Number(rowIndex);
    const safeColumnIndex = Number(columnIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;
    if (!Number.isFinite(safeColumnIndex) || safeColumnIndex < 0) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      if (!source[safeRowIndex]) return source;
      return source.map((row, rowIdx) => {
        if (rowIdx !== safeRowIndex) return row;
        const nextRow = [...row];
        if (safeColumnIndex >= nextRow.length) {
          while (nextRow.length <= safeColumnIndex) nextRow.push('');
        }
        nextRow[safeColumnIndex] = String(value ?? '');
        return nextRow;
      });
    });
  }, [normalizeEditableTableGrid]);

  const removeEditWorkScheduleRow = useCallback((rowIndex) => {
    const safeRowIndex = Number(rowIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const next = source.filter((_, idx) => idx !== safeRowIndex);
      return normalizeEditableTableGrid(next);
    });
  }, [normalizeEditableTableGrid]);

  const moveEditWorkScheduleRow = useCallback((rowIndex, direction) => {
    const safeRowIndex = Number(rowIndex);
    if (!Number.isFinite(safeRowIndex) || safeRowIndex < 0) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      if (!source[safeRowIndex]) return source;

      const maxIndex = Math.max(0, source.length - 1);
      let targetIndex = safeRowIndex;
      if (direction === 'up') targetIndex = safeRowIndex - 1;
      else if (direction === 'down') targetIndex = safeRowIndex + 1;
      else if (direction === 'up5') targetIndex = safeRowIndex - 5;
      else if (direction === 'down5') targetIndex = safeRowIndex + 5;
      else if (direction === 'top') targetIndex = 0;
      else if (direction === 'bottom') targetIndex = maxIndex;
      else return source;

      targetIndex = Math.max(0, Math.min(maxIndex, targetIndex));
      if (targetIndex === safeRowIndex) return source;

      const next = [...source];
      const [picked] = next.splice(safeRowIndex, 1);
      next.splice(targetIndex, 0, picked);
      return next;
    });
  }, [normalizeEditableTableGrid]);

  const reorderEditWorkScheduleRow = useCallback((fromIndexRaw, toIndexRaw) => {
    const fromIndex = Number(fromIndexRaw);
    const toIndex = Number(toIndexRaw);
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return;

    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const maxIndex = source.length - 1;
      if (maxIndex < 1) return source;

      const safeFrom = Math.max(1, Math.min(maxIndex, Math.floor(fromIndex)));
      const safeTo = Math.max(1, Math.min(maxIndex, Math.floor(toIndex)));
      if (safeFrom === safeTo) return source;

      const next = [...source];
      const [picked] = next.splice(safeFrom, 1);
      next.splice(safeTo, 0, picked);
      return next;
    });
  }, [normalizeEditableTableGrid]);

  const removeEditWorkScheduleColumn = useCallback((columnIndex) => {
    const safeColumnIndex = Number(columnIndex);
    if (!Number.isFinite(safeColumnIndex) || safeColumnIndex < 0) return;
    setEditWorkScheduleTableRows((prev) => {
      const source = normalizeEditableTableGrid(prev);
      const columnCount = source[0]?.length || 1;
      if (columnCount <= 1) return source;
      const next = source.map((row) => row.filter((_, idx) => idx !== safeColumnIndex));
      return normalizeEditableTableGrid(next);
    });
  }, [normalizeEditableTableGrid]);

  const openEditModal = useCallback(() => {
    if (!currentPost || !canModerateCurrentPost) return;

    setEditTitle(currentPost.title || '');
    if (normalizeText(currentPost.boardId) === WORK_SCHEDULE_BOARD_ID) {
      const storedHtml = sanitizeStoredContentHtml(currentPost.contentHtml || '');
      const parsedTable = extractEditableTableGridFromHtml(storedHtml);
      const fallbackRows = Array.isArray(currentPost?.workScheduleRows) ? currentPost.workScheduleRows : [];
      let nextTableRows = parsedTable.rows;
      if (!nextTableRows.length && fallbackRows.length) {
        nextTableRows = [
          ['날짜', '요일', '풀타임', '파트1', '파트2', '파트3', '교육'],
          ...fallbackRows.map((row) => ([
            normalizeText(row?.dateLabel || row?.dateKey),
            normalizeText(row?.weekday),
            normalizeText(row?.fullTime),
            normalizeText(row?.part1),
            normalizeText(row?.part2),
            normalizeText(row?.part3),
            normalizeText(row?.education)
          ]))
        ];
      }
      if (!nextTableRows.length) {
        nextTableRows = [
          ['날짜', '요일', '풀타임', '파트1', '파트2', '파트3', '교육'],
          ['', '', '', '', '', '', '']
        ];
      }
      setEditHtmlContent(storedHtml);
      setEditWorkScheduleTableRows(normalizeEditableTableGrid(nextTableRows));
    } else {
      setEditHtmlContent('');
      setEditWorkScheduleTableRows([]);
    }
    setEditMessage({ type: '', text: '' });
    setEditModalOpen(true);
  }, [
    canModerateCurrentPost,
    currentPost,
    extractEditableTableGridFromHtml,
    normalizeEditableTableGrid,
    normalizeText,
    sanitizeStoredContentHtml,
    WORK_SCHEDULE_BOARD_ID
  ]);

  const submitEditPost = useCallback(async (event) => {
    event.preventDefault();
    if (!currentPost || !canModerateCurrentPost) return;

    const title = normalizeText(editTitle);
    const useTableHtmlEditor = normalizeText(currentPost.boardId) === WORK_SCHEDULE_BOARD_ID;

    let body = '';
    let rich = plainRichPayload('');
    let delta = { ops: [{ insert: '\n' }] };
    let contentHtml = '';
    let workScheduleRows = Array.isArray(currentPost?.workScheduleRows) ? currentPost.workScheduleRows : [];
    let workScheduleDateKeys = Array.isArray(currentPost?.workScheduleDateKeys) ? currentPost.workScheduleDateKeys : [];
    let workScheduleCalendarNotice = '';

    if (useTableHtmlEditor) {
      const normalizedTableRows = normalizeEditableTableGrid(editWorkScheduleTableRows);
      const hasAnyCellText = normalizedTableRows.some((row) => row.some((cell) => normalizeText(cell)));
      if (!hasAnyCellText) {
        setEditMessage({ type: 'error', text: '표가 비어 있습니다. 최소 한 칸 이상 입력해주세요.' });
        return;
      }
      const mergedHtml = replaceFirstTableInHtml(editHtmlContent || currentPost.contentHtml || '', normalizedTableRows);
      contentHtml = sanitizeStoredContentHtml(mergedHtml);
      body = normalizeText(stripHtmlToText(contentHtml));
      const parsedSchedule = extractWorkScheduleRowsFromHtml(contentHtml, title);
      workScheduleRows = parsedSchedule.rows;
      workScheduleDateKeys = parsedSchedule.rows.map((row) => row.dateKey);
      if (parsedSchedule.hasTable && !parsedSchedule.rows.length) {
        workScheduleCalendarNotice = '표는 저장됐지만 캘린더 반영용 열(날짜/풀타임/파트)이 감지되지 않았습니다.';
      }
      rich = plainRichPayload(body);
      delta = { ops: [{ insert: body ? `${body}\n` : '\n' }] };
    } else {
      rich = editEditorRef.current?.getPayload() || plainRichPayload('');
      delta = editEditorRef.current?.getDelta?.() || { ops: [{ insert: '\n' }] };
      body = normalizeText(rich.text);
      contentHtml = '';
    }

    if (!title || !body) {
      setEditMessage({ type: 'error', text: '제목과 본문을 모두 입력해주세요.' });
      return;
    }

    setEditSubmitting(true);
    setEditMessage({ type: '', text: '' });
    try {
      await postFirestore.updatePostDoc(currentPost.id, {
        title,
        contentDelta: delta,
        contentText: rich.text,
        contentRich: rich,
        contentHtml,
        workScheduleRows,
        workScheduleDateKeys,
        updatedAt: serverTimestamp()
      });

      setCurrentPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title,
          contentDelta: delta,
          contentText: rich.text,
          contentRich: rich,
          contentHtml,
          workScheduleRows,
          workScheduleDateKeys
        };
      });

      setMessage({
        type: 'notice',
        text: workScheduleCalendarNotice
          ? `게시글을 수정했습니다. ${workScheduleCalendarNotice}`
          : '게시글을 수정했습니다.'
      });
      setEditModalOpen(false);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestPostDocExists = false;
        let latestPostAuthorUid = '';
        let latestPostAuthorId = '';
        let latestPostUid = '';
        let latestPostCreatedByUid = '';
        try {
          const latestPostSnap = await postFirestore.fetchPostDoc(currentPost.id);
          latestPostDocExists = !!latestPostSnap?.exists?.() && latestPostSnap.exists();
          if (latestPostDocExists) {
            const latestPostData = latestPostSnap.data() || {};
            latestPostAuthorUid = normalizeText(latestPostData.authorUid);
            latestPostAuthorId = normalizeText(latestPostData.authorId);
            latestPostUid = normalizeText(latestPostData.uid);
            latestPostCreatedByUid = normalizeText(
              latestPostData.createdByUid || latestPostData?.createdBy?.uid
            );
          }
        } catch (_) {
          // Keep original permission error when extra debug reads fail.
        }

        const debugText = joinDebugParts([
          'action=post-update',
          boardAccessDebugText(currentBoardAccessDebug, currentUserProfile),
          `runtimeProjectId=${normalizeText(postFirestore.getRuntimeProjectId()) || '-'}`,
          `postId=${normalizeText(currentPost?.id) || '-'}`,
          `postAuthorUid=${normalizeText(currentPost?.authorUid) || '-'}`,
          `postAuthorUidHex=${debugCodePoints(currentPost?.authorUid || '')}`,
          `postAuthorId=${normalizeText(currentPost?.authorId) || '-'}`,
          `postUid=${normalizeText(currentPost?.uid) || '-'}`,
          `postAuthorNestedUid=${normalizeText(currentPost?.author?.uid) || '-'}`,
          `postCreatedByUid=${normalizeText(currentPost?.createdByUid || currentPost?.createdBy?.uid) || '-'}`,
          `myUid=${normalizeText(currentUser?.uid) || '-'}`,
          `myUidHex=${debugCodePoints(currentUser?.uid || '')}`,
          `latestPostDoc=${latestPostDocExists ? 'exists' : 'missing'}`,
          `latestPostAuthorUid=${latestPostAuthorUid || '-'}`,
          `latestPostAuthorUidHex=${debugCodePoints(latestPostAuthorUid || '')}`,
          `latestPostAuthorId=${latestPostAuthorId || '-'}`,
          `latestPostUid=${latestPostUid || '-'}`,
          `latestPostCreatedByUid=${latestPostCreatedByUid || '-'}`,
          `latestOwnerMatch=${latestPostAuthorUid && normalizeText(latestPostAuthorUid) === normalizeText(currentUser?.uid) ? 'Y' : 'N'}`,
          `canModerate=${permissions?.canModerate ? 'Y' : 'N'}`,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[post-update-permission-debug]', err, {
          error: err,
          runtimeProjectId: normalizeText(postFirestore.getRuntimeProjectId()),
          postId: currentPost?.id || '',
          postAuthorUid: currentPost?.authorUid || '',
          postAuthorUidHex: debugCodePoints(currentPost?.authorUid || ''),
          postAuthorId: currentPost?.authorId || '',
          postUid: currentPost?.uid || '',
          postAuthorNestedUid: currentPost?.author?.uid || '',
          postCreatedByUid: currentPost?.createdByUid || currentPost?.createdBy?.uid || '',
          myUid: currentUser?.uid || '',
          myUidHex: debugCodePoints(currentUser?.uid || ''),
          latestPostDocExists,
          latestPostAuthorUid,
          latestPostAuthorUidHex: debugCodePoints(latestPostAuthorUid || ''),
          latestPostAuthorId,
          latestPostUid,
          latestPostCreatedByUid,
          latestOwnerMatch: latestPostAuthorUid && normalizeText(latestPostAuthorUid) === normalizeText(currentUser?.uid),
          canModerate: !!permissions?.canModerate,
          boardAccess: currentBoardAccessDebug,
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          debugText
        });
        setEditMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 수정 실패') });
        return;
      }
      setEditMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 수정 실패') });
    } finally {
      setEditSubmitting(false);
    }
  }, [
    canModerateCurrentPost,
    currentBoardAccessDebug,
    currentPost,
    currentUser,
    currentUserProfile,
    debugCodePoints,
    editEditorRef,
    editHtmlContent,
    editTitle,
    editWorkScheduleTableRows,
    extractWorkScheduleRowsFromHtml,
    isPermissionDeniedError,
    joinDebugParts,
    normalizeEditableTableGrid,
    normalizeErrMessage,
    normalizeText,
    permissions,
    plainRichPayload,
    postFirestore,
    replaceFirstTableInHtml,
    sanitizeStoredContentHtml,
    serverTimestamp,
    setCurrentPost,
    setMessage,
    stripHtmlToText,
    WORK_SCHEDULE_BOARD_ID,
    boardAccessDebugText
  ]);

  return {
    editModalOpen,
    setEditModalOpen,
    editTitle,
    setEditTitle,
    editHtmlContent,
    setEditHtmlContent,
    editWorkScheduleTableRows,
    setEditWorkScheduleTableRows,
    addEditWorkScheduleRow,
    addEditWorkScheduleColumn,
    updateEditWorkScheduleCell,
    removeEditWorkScheduleRow,
    moveEditWorkScheduleRow,
    reorderEditWorkScheduleRow,
    removeEditWorkScheduleColumn,
    editSubmitting,
    setEditSubmitting,
    editMessage,
    setEditMessage,
    openEditModal,
    submitEditPost
  };
}
