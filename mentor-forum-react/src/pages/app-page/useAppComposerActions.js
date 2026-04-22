// AppPage composer command hook.
// - Encapsulates imperative composer actions (`open`, `close`, `reset`,
//   `submit`) that coordinate editor state, validation, Firestore writes, and
//   post-create side effects now run from Firebase Functions.
import { useCallback } from 'react';

export function useAppComposerActions({
  currentBoard,
  currentUser,
  currentUserProfile,
  roleDefMap,
  editorRef,
  appFirestore,
  canWriteBoard,
  canWriteBoardWithProfile,
  normalizeRoleKey,
  normalizeText,
  normalizeErrMessage,
  boardPermissionDebugText,
  debugCodePoints,
  debugValueList,
  joinDebugParts,
  formatDateKeyLabel,
  normalizeCoverForVenue,
  normalizeCoverForDateTimeEntries,
  normalizeDateKeyInput,
  isPermissionDeniedError,
  isValidTimeRange,
  toDateKey,
  buildAuthorName,
  logErrorWithOptionalDebug,
  COVER_FOR_BOARD_ID,
  COVER_FOR_STATUS,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  coverVenueDefault,
  todayDate,
  setCurrentUserProfile,
  setListMessage,
  showAppliedPopup,
  loadPostsForCurrentBoard,
  closeComposerMentionMenu,
  setComposerVenueInputFocusIndex,
  setComposerOpen,
  setComposerMessage,
  setPostTitle,
  setComposerCoverDateKeys,
  setComposerCoverStartTimeValues,
  setComposerCoverEndTimeValues,
  setComposerCoverVenueValues,
  setComposerCoverVenueCustomModes,
  setSubmittingPost,
  postTitle,
  composerCoverDateKeys,
  composerCoverStartTimeValues,
  composerCoverEndTimeValues,
  composerCoverVenueValues,
  serverTimestamp,
  isAllBoardSelected
}) {
  const closeComposer = useCallback(() => {
    closeComposerMentionMenu();
    setComposerVenueInputFocusIndex(-1);
    setComposerOpen(false);
  }, [closeComposerMentionMenu, setComposerOpen, setComposerVenueInputFocusIndex]);

  const resetComposer = useCallback((targetBoard = null) => {
    const board = targetBoard || currentBoard;
    const todayKey = toDateKey(new Date()) || toDateKey(todayDate);
    setPostTitle('');
    setComposerMessage({ type: '', text: '' });
    if (board && normalizeText(board.id) === COVER_FOR_BOARD_ID) {
      setComposerCoverDateKeys(todayKey ? [todayKey] : []);
      setComposerCoverStartTimeValues([COVER_FOR_DEFAULT_START_TIME]);
      setComposerCoverEndTimeValues([COVER_FOR_DEFAULT_END_TIME]);
      setComposerCoverVenueValues([coverVenueDefault]);
      setComposerCoverVenueCustomModes([false]);
      setComposerVenueInputFocusIndex(-1);
    } else {
      setComposerCoverDateKeys([]);
      setComposerCoverStartTimeValues([]);
      setComposerCoverEndTimeValues([]);
      setComposerCoverVenueValues([]);
      setComposerCoverVenueCustomModes([]);
      setComposerVenueInputFocusIndex(-1);
    }

    const editor = editorRef.current;
    if (editor) {
      editor.setPayload({ text: '', runs: [] });
    }
    closeComposerMentionMenu();
  }, [
    COVER_FOR_BOARD_ID,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    closeComposerMentionMenu,
    coverVenueDefault,
    currentBoard,
    editorRef,
    normalizeText,
    setComposerCoverDateKeys,
    setComposerCoverEndTimeValues,
    setComposerCoverStartTimeValues,
    setComposerCoverVenueCustomModes,
    setComposerCoverVenueValues,
    setComposerMessage,
    setComposerVenueInputFocusIndex,
    setPostTitle,
    toDateKey,
    todayDate
  ]);

  const openComposer = useCallback(() => {
    if (isAllBoardSelected) {
      alert('글쓰기는 개별 게시판에서만 가능합니다. 햄버거 버튼에서 게시판을 선택해주세요.');
      return;
    }

    if (!currentBoard || !canWriteBoard(currentBoard)) {
      alert('선택한 게시판에 글 작성 권한이 없습니다.');
      return;
    }

    resetComposer(currentBoard);
    setComposerOpen(true);
  }, [canWriteBoard, currentBoard, isAllBoardSelected, resetComposer, setComposerOpen]);

  const submitPost = useCallback(async (event) => {
    event.preventDefault();

    if (!currentUser || !currentUserProfile) {
      setComposerMessage({ type: 'error', text: '로그인 정보가 만료되었습니다. 다시 로그인해주세요.' });
      return;
    }

    if (!currentBoard || !canWriteBoard(currentBoard)) {
      setComposerMessage({ type: 'error', text: '선택한 게시판에 접근할 수 없습니다.' });
      return;
    }

    const editor = editorRef.current;
    const payload = editor ? editor.getPayload() : { text: '', runs: [] };
    const delta = editor?.getDelta?.() || { ops: [{ insert: '\n' }] };
    const cleanTitle = normalizeText(postTitle);
    const isCoverRequestBoard = normalizeText(currentBoard.id) === COVER_FOR_BOARD_ID;
    const coverEntryCompositeValues = isCoverRequestBoard
      ? normalizeCoverForDateTimeEntries(
        composerCoverDateKeys,
        composerCoverStartTimeValues,
        composerCoverEndTimeValues,
        composerCoverVenueValues,
        '',
        COVER_FOR_DEFAULT_START_TIME,
        COVER_FOR_DEFAULT_END_TIME,
        coverVenueDefault
      ).map((entry) => {
        const venue = normalizeCoverForVenue(entry.venue);
        return `${entry.dateKey}|${entry.startTimeValue}|${entry.endTimeValue}|${venue}`;
      })
      : [];
    const duplicateCoverEntryValues = isCoverRequestBoard
      ? [...new Set(
        coverEntryCompositeValues.filter((entryValue, idx) => coverEntryCompositeValues.indexOf(entryValue) !== idx)
      )]
      : [];
    const coverDateFallbackKey = toDateKey(new Date()) || toDateKey(todayDate);
    const nextCoverDateTimeEntries = isCoverRequestBoard
      ? normalizeCoverForDateTimeEntries(
        composerCoverDateKeys,
        composerCoverStartTimeValues,
        composerCoverEndTimeValues,
        composerCoverVenueValues,
        coverDateFallbackKey,
        COVER_FOR_DEFAULT_START_TIME,
        COVER_FOR_DEFAULT_END_TIME,
        coverVenueDefault
      )
      : [];
    const nextCoverDateKeys = nextCoverDateTimeEntries.map((entry) => entry.dateKey);
    const nextCoverStartTimeValues = nextCoverDateTimeEntries.map((entry) => entry.startTimeValue);
    const nextCoverEndTimeValues = nextCoverDateTimeEntries.map((entry) => entry.endTimeValue);
    const nextCoverVenueValues = nextCoverDateTimeEntries.map((entry) => normalizeCoverForVenue(entry.venue));

    if (!cleanTitle) {
      setComposerMessage({ type: 'error', text: '제목을 입력해주세요.' });
      return;
    }

    if (!normalizeText(payload.text)) {
      setComposerMessage({ type: 'error', text: '본문을 입력해주세요.' });
      return;
    }

    if (isCoverRequestBoard && duplicateCoverEntryValues.length) {
      const duplicateDateText = duplicateCoverEntryValues
        .map((entryValue) => {
          const [dateKey = '', startTimeValue = '', endTimeValue = '', venue = ''] = String(entryValue).split('|');
          return `${formatDateKeyLabel(dateKey)} ${startTimeValue}~${endTimeValue} [${venue}]`;
        })
        .join(', ');
      setComposerMessage({
        type: 'error',
        text: `동일한 날짜/시간/체험관 조합은 1번만 등록할 수 있습니다. 중복 항목: ${duplicateDateText}`
      });
      return;
    }

    if (isCoverRequestBoard && !nextCoverDateKeys.length) {
      setComposerMessage({ type: 'error', text: '캘린더 게시판 일정 날짜를 최소 1개 선택해주세요.' });
      return;
    }

    if (
      isCoverRequestBoard
      && nextCoverDateTimeEntries.some((entry) => !normalizeCoverForVenue(entry.venue))
    ) {
      setComposerMessage({ type: 'error', text: '각 날짜별 체험관을 선택해주세요.' });
      return;
    }

    if (
      isCoverRequestBoard
      && nextCoverDateTimeEntries.some((entry) => !isValidTimeRange(entry.startTimeValue, entry.endTimeValue))
    ) {
      setComposerMessage({ type: 'error', text: '요청 시간은 시작 시간보다 늦은 종료 시간을 선택해주세요.' });
      return;
    }

    closeComposerMentionMenu();
    setSubmittingPost(true);
    setComposerMessage({ type: '', text: '' });

    let createdPostId = '';
    let payloadToCreate = null;
    try {
      payloadToCreate = {
        boardId: currentBoard.id,
        title: cleanTitle,
        visibility: currentBoard.visibility || 'mentor',
        contentDelta: delta,
        contentText: payload.text,
        contentRich: payload,
        authorUid: currentUser.uid,
        authorName: buildAuthorName(currentUserProfile),
        authorRole: currentUserProfile.role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deleted: false,
        views: 0
      };

      if (isCoverRequestBoard) {
        payloadToCreate.coverForStatus = COVER_FOR_STATUS.SEEKING;
        payloadToCreate.coverForDateKeys = nextCoverDateKeys;
        payloadToCreate.coverForDateStatuses = nextCoverDateKeys.map(() => COVER_FOR_STATUS.SEEKING);
        payloadToCreate.coverForStartTimeValues = nextCoverStartTimeValues;
        payloadToCreate.coverForEndTimeValues = nextCoverEndTimeValues;
        payloadToCreate.coverForTimeValues = nextCoverStartTimeValues;
        payloadToCreate.coverForVenueValues = nextCoverVenueValues;
        payloadToCreate.coverForVenue = normalizeCoverForVenue(nextCoverVenueValues[0]) || coverVenueDefault;
      }

      payloadToCreate.isPinned = false;
      payloadToCreate.pinnedAt = null;
      payloadToCreate.pinnedAtMs = 0;
      payloadToCreate.pinnedByUid = '';

      const createdRef = await appFirestore.createPost(payloadToCreate);
      createdPostId = normalizeText(createdRef?.id);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        let latestUserDocExists = false;
        let latestBoardDocExists = false;
        let latestRawRoleExact = '';
        let latestRawRole = '';
        let latestRole = '';
        let latestBoardAllowedRoles = [];
        let latestBoardIsDivider = null;
        let latestCanWriteByClientEval = null;

        try {
          const [latestUserSnap, latestBoardSnap] = await Promise.all([
            appFirestore.fetchUserDoc(currentUser.uid),
            appFirestore.fetchBoardDoc(currentBoard?.id || '')
          ]);

          latestUserDocExists = !!latestUserSnap?.exists?.() && latestUserSnap.exists();
          latestBoardDocExists = !!latestBoardSnap?.exists?.() && latestBoardSnap.exists();

          let latestProfileData = null;
          if (latestUserDocExists) {
            latestProfileData = latestUserSnap.data() || {};
            latestRawRoleExact = String((latestProfileData || {}).role ?? '');
            latestRawRole = normalizeText(latestRawRoleExact);
            latestRole = normalizeRoleKey(latestRawRole, roleDefMap);

            const syncedRawRole = latestRawRole || normalizeText(currentUserProfile.rawRole || currentUserProfile.role);
            const syncedRole = latestRole || normalizeRoleKey(syncedRawRole, roleDefMap);
            const localRawRole = normalizeText(currentUserProfile.rawRole || currentUserProfile.role);
            const localRole = normalizeRoleKey(currentUserProfile.role, roleDefMap);

            if (syncedRawRole !== localRawRole || syncedRole !== localRole) {
              setCurrentUserProfile((prev) => (prev ? {
                ...prev,
                ...latestProfileData,
                role: syncedRole,
                rawRole: syncedRawRole
              } : prev));
            }
          }

          if (latestBoardDocExists) {
            const latestBoardData = latestBoardSnap.data() || {};
            latestBoardAllowedRoles = Array.isArray(latestBoardData.allowedRoles) ? latestBoardData.allowedRoles : [];
            latestBoardIsDivider = latestBoardData.isDivider === true;

            const profileForEval = latestUserDocExists
              ? {
                ...currentUserProfile,
                ...(latestProfileData || {}),
                role: latestRole || normalizeRoleKey(normalizeText((latestProfileData || {}).role), roleDefMap),
                rawRole: latestRawRole || normalizeText((latestProfileData || {}).role)
              }
              : currentUserProfile;

            latestCanWriteByClientEval = canWriteBoardWithProfile(
              { id: latestBoardSnap.id, ...latestBoardData },
              profileForEval,
              roleDefMap
            );
          }
        } catch (_) {
          // Keep original permission error when extra debug reads fail.
        }

        const invalidRangeIndexes = nextCoverDateTimeEntries
          .map((entry, idx) => (isValidTimeRange(entry.startTimeValue, entry.endTimeValue) ? '' : String(idx + 1)))
          .filter(Boolean);
        const coverDebugText = isCoverRequestBoard
          ? joinDebugParts([
            `coverDateCount=${nextCoverDateKeys.length}`,
            `coverDates=${debugValueList(nextCoverDateKeys)}`,
            `coverStarts=${debugValueList(nextCoverStartTimeValues)}`,
            `coverEnds=${debugValueList(nextCoverEndTimeValues)}`,
            `coverVenues=${debugValueList(nextCoverVenueValues)}`,
            `invalidRanges=${invalidRangeIndexes.length ? invalidRangeIndexes.join(',') : '-'}`
          ])
          : '';
        const latestDebugText = joinDebugParts([
          `localCanWrite=${canWriteBoardWithProfile(currentBoard, currentUserProfile, roleDefMap) ? 'yes' : 'no'}`,
          `payloadBoardId=${normalizeText(payloadToCreate?.boardId) || '-'}`,
          `payloadAuthorUid=${normalizeText(payloadToCreate?.authorUid) || '-'}`,
          `payloadAuthorUidMatchesAuth=${normalizeText(payloadToCreate?.authorUid) === normalizeText(currentUser?.uid) ? 'yes' : 'no'}`,
          `payloadDeleted=${String(payloadToCreate?.deleted)}`,
          `payloadDeletedType=${typeof payloadToCreate?.deleted}`,
          `payloadCoverStatus=${normalizeText(payloadToCreate?.coverForStatus) || '-'}`,
          `payloadCoverVenue=${normalizeText(payloadToCreate?.coverForVenue) || '-'}`,
          `latestUserDoc=${latestUserDocExists ? 'exists' : 'missing'}`,
          `latestMyRole=${latestRole || '-'}`,
          `latestMyRawRole=${latestRawRole || '-'}`,
          `latestMyRawRoleHex=${debugCodePoints(latestRawRoleExact)}`,
          `latestBoardDoc=${latestBoardDocExists ? 'exists' : 'missing'}`,
          `latestBoardAllowedRoles=${debugValueList(latestBoardAllowedRoles)}`,
          `latestBoardIsDivider=${latestBoardIsDivider == null ? '-' : String(latestBoardIsDivider)}`,
          `latestCanWrite=${latestCanWriteByClientEval == null ? '-' : (latestCanWriteByClientEval ? 'yes' : 'no')}`
        ]);
        const debugText = joinDebugParts([
          'action=post-create',
          'errorStage=post-add',
          boardPermissionDebugText(currentBoard, currentUserProfile),
          coverDebugText,
          latestDebugText,
          `errorCode=${normalizeText(err?.code) || '-'}`
        ]);
        logErrorWithOptionalDebug('[post-create-permission-debug]', err, {
          error: err,
          boardId: currentBoard?.id || '',
          boardName: currentBoard?.name || '',
          allowedRoles: Array.isArray(currentBoard?.allowedRoles) ? currentBoard.allowedRoles : [],
          userRole: currentUserProfile?.role || '',
          userRawRole: currentUserProfile?.rawRole || currentUserProfile?.role || '',
          userRawRoleHex: debugCodePoints(currentUserProfile?.rawRole || currentUserProfile?.role || ''),
          localCanWrite: canWriteBoardWithProfile(currentBoard, currentUserProfile, roleDefMap),
          latestUserDocExists,
          latestRole,
          latestRawRole,
          latestRawRoleHex: debugCodePoints(latestRawRoleExact),
          latestBoardDocExists,
          latestBoardAllowedRoles,
          latestBoardIsDivider,
          latestCanWriteByClientEval,
          payloadBoardId: normalizeText(payloadToCreate?.boardId),
          payloadAuthorUid: normalizeText(payloadToCreate?.authorUid),
          payloadAuthorUidMatchesAuth: normalizeText(payloadToCreate?.authorUid) === normalizeText(currentUser?.uid),
          payloadDeleted: payloadToCreate?.deleted,
          payloadDeletedType: typeof payloadToCreate?.deleted,
          payloadCoverStatus: normalizeText(payloadToCreate?.coverForStatus),
          payloadCoverVenue: normalizeText(payloadToCreate?.coverForVenue),
          payloadCoverVenueValues: Array.isArray(payloadToCreate?.coverForVenueValues) ? payloadToCreate.coverForVenueValues : [],
          createdPostId,
          coverForDateKeys: nextCoverDateKeys,
          coverForStartTimeValues: nextCoverStartTimeValues,
          coverForEndTimeValues: nextCoverEndTimeValues,
          coverForVenueValues: nextCoverVenueValues,
          invalidRangeIndexes,
          debugText
        });
        setComposerMessage({ type: 'error', text: normalizeErrMessage(err, '저장 실패') });
        setSubmittingPost(false);
        return;
      }
      setComposerMessage({ type: 'error', text: normalizeErrMessage(err, '저장 실패') });
      setSubmittingPost(false);
      return;
    }

    resetComposer(currentBoard);
    closeComposer();

    try {
      await loadPostsForCurrentBoard();
    } catch (err) {
      logErrorWithOptionalDebug('[post-create-list-refresh-failed]', err, {
        error: err,
        boardId: currentBoard?.id || '',
        boardName: currentBoard?.name || '',
        createdPostId
      });
      setListMessage({
        type: 'error',
        text: '게시글은 등록되었지만 목록을 갱신하지 못했습니다. 새로고침 후 확인해주세요.'
      });
    }

    showAppliedPopup('게시글 등록이 완료되었습니다.');
    setSubmittingPost(false);
  }, [
    COVER_FOR_BOARD_ID,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_STATUS,
    appFirestore,
    boardPermissionDebugText,
    buildAuthorName,
    canWriteBoard,
    canWriteBoardWithProfile,
    closeComposer,
    closeComposerMentionMenu,
    composerCoverDateKeys,
    composerCoverEndTimeValues,
    composerCoverStartTimeValues,
    composerCoverVenueValues,
    coverVenueDefault,
    currentBoard,
    currentUser,
    currentUserProfile,
    debugCodePoints,
    debugValueList,
    editorRef,
    formatDateKeyLabel,
    isPermissionDeniedError,
    isValidTimeRange,
    joinDebugParts,
    loadPostsForCurrentBoard,
    logErrorWithOptionalDebug,
    normalizeCoverForDateTimeEntries,
    normalizeCoverForVenue,
    normalizeErrMessage,
    normalizeRoleKey,
    normalizeText,
    postTitle,
    resetComposer,
    roleDefMap,
    serverTimestamp,
    setComposerMessage,
    setCurrentUserProfile,
    setListMessage,
    setSubmittingPost,
    showAppliedPopup,
    toDateKey,
    todayDate
  ]);

  return {
    closeComposer,
    resetComposer,
    openComposer,
    submitPost
  };
}
