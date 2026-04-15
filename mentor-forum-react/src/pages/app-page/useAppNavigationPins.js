// AppPage navigation/pin command hook.
// - Groups list navigation commands with pinned-post selection/update behavior
//   so feed loading can stay separate from navigation-side effects.
import { useCallback, useMemo, useState } from 'react';

export function useAppNavigationPins({
  ALL_BOARD_ID,
  appPage,
  currentBoard,
  currentUserUid,
  selectedBoardId,
  visiblePostById,
  isPinnedPost,
  canManagePinInCurrentBoard,
  pinUpdatePost,
  normalizeText,
  normalizeErrMessage,
  readRememberedBoardId,
  writeRememberedBoardId,
  navigate,
  locationSearch,
  setSelectedBoardId,
  pendingBoardIdRef,
  setVisiblePosts,
  setPageMessage
}) {
  const [selectedPinPostIdMap, setSelectedPinPostIdMap] = useState({});
  const [pinActionPending, setPinActionPending] = useState(false);

  const selectedPinPostIds = useMemo(() => {
    return Object.keys(selectedPinPostIdMap).filter((postId) => (
      selectedPinPostIdMap[postId] && visiblePostById.has(postId)
    ));
  }, [selectedPinPostIdMap, visiblePostById]);

  const selectedPinPostCount = selectedPinPostIds.length;

  const selectedPinMode = useMemo(() => {
    let hasPinned = false;
    let hasUnpinned = false;

    selectedPinPostIds.forEach((postId) => {
      const post = visiblePostById.get(postId);
      if (!post) return;
      if (isPinnedPost(post)) hasPinned = true;
      else hasUnpinned = true;
    });

    if (hasPinned && hasUnpinned) return 'mixed';
    if (hasPinned) return 'pinned';
    if (hasUnpinned) return 'unpinned';
    return '';
  }, [isPinnedPost, selectedPinPostIds, visiblePostById]);

  const showPinToolbar = canManagePinInCurrentBoard && selectedPinPostCount > 0;

  const handleMovePost = useCallback((postId, postBoardId = '', focusCommentId = '') => {
    const qs = new URLSearchParams();
    qs.set('postId', String(postId || ''));
    const normalizedCommentId = normalizeText(focusCommentId);
    if (normalizedCommentId) qs.set('commentId', normalizedCommentId);

    const normalizedPostBoardId = normalizeText(postBoardId);
    const selectedId = normalizeText(selectedBoardId);
    const rememberedBoardId = readRememberedBoardId();
    const fromBoardId = (selectedId && selectedId !== ALL_BOARD_ID)
      ? selectedId
      : (normalizedPostBoardId || rememberedBoardId);
    const resolvedPostBoardId = normalizedPostBoardId || fromBoardId || rememberedBoardId || ALL_BOARD_ID;

    if (resolvedPostBoardId && resolvedPostBoardId !== ALL_BOARD_ID) {
      try {
        const listQs = new URLSearchParams(locationSearch);
        listQs.set('boardId', resolvedPostBoardId);
        listQs.delete('fromBoardId');
        const nextListUrl = listQs.toString() ? `${appPage}?${listQs.toString()}` : appPage;
        const historyState = (window.history && typeof window.history.state === 'object' && window.history.state)
          ? window.history.state
          : {};
        const historyUsr = (historyState && typeof historyState.usr === 'object' && historyState.usr)
          ? historyState.usr
          : {};
        window.history.replaceState(
          { ...historyState, usr: { ...historyUsr, preferredBoardId: resolvedPostBoardId } },
          '',
          nextListUrl
        );
      } catch (_) {
        // Ignore history replacement failures.
      }
    }

    qs.set('boardId', resolvedPostBoardId);
    if (fromBoardId) qs.set('fromBoardId', fromBoardId);
    writeRememberedBoardId(fromBoardId);

    const postPage = '/post';
    navigate(`${postPage}?${qs.toString()}`, {
      state: {
        fromBoardId: fromBoardId || '',
        postBoardId: resolvedPostBoardId || ''
      }
    });
  }, [ALL_BOARD_ID, appPage, locationSearch, navigate, normalizeText, readRememberedBoardId, selectedBoardId, writeRememberedBoardId]);

  const handleSelectBoard = useCallback((nextBoardId) => {
    const normalizedBoardId = normalizeText(nextBoardId) || ALL_BOARD_ID;
    setSelectedBoardId(normalizedBoardId);
    pendingBoardIdRef.current = normalizedBoardId === ALL_BOARD_ID ? '' : normalizedBoardId;

    if (normalizedBoardId !== ALL_BOARD_ID) {
      writeRememberedBoardId(normalizedBoardId);
    }

    const listQs = new URLSearchParams(locationSearch);
    if (normalizedBoardId === ALL_BOARD_ID) listQs.delete('boardId');
    else listQs.set('boardId', normalizedBoardId);
    listQs.delete('fromBoardId');

    navigate(
      {
        pathname: appPage,
        search: listQs.toString() ? `?${listQs.toString()}` : ''
      },
      {
        replace: true,
        state: normalizedBoardId === ALL_BOARD_ID ? {} : { preferredBoardId: normalizedBoardId }
      }
    );
  }, [ALL_BOARD_ID, appPage, locationSearch, navigate, normalizeText, pendingBoardIdRef, setSelectedBoardId, writeRememberedBoardId]);

  const handleMoveHome = useCallback(() => {
    navigate(appPage);
  }, [appPage, navigate]);

  const handleBrandTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleMoveHome();
  }, [handleMoveHome]);

  const isPostPinSelectionDisabled = useCallback((post) => {
    if (!canManagePinInCurrentBoard || pinActionPending) return true;
    const postId = normalizeText(post?.id);
    if (!postId) return true;
    if (selectedPinPostIdMap[postId]) return false;
    if (!selectedPinMode || selectedPinMode === 'mixed') return false;
    const pinned = isPinnedPost(post);
    return selectedPinMode === 'pinned' ? !pinned : pinned;
  }, [canManagePinInCurrentBoard, isPinnedPost, normalizeText, pinActionPending, selectedPinMode, selectedPinPostIdMap]);

  const handleTogglePinSelect = useCallback((post, checked) => {
    if (!canManagePinInCurrentBoard) return;
    const normalizedPostId = normalizeText(post?.id);
    if (!normalizedPostId) return;
    const targetPinned = isPinnedPost(post);

    setSelectedPinPostIdMap((prev) => {
      if (!checked) {
        if (!prev[normalizedPostId]) return prev;
        const next = { ...prev };
        delete next[normalizedPostId];
        return next;
      }
      if (prev[normalizedPostId]) return prev;

      let currentMode = '';
      Object.keys(prev).forEach((postId) => {
        if (!prev[postId]) return;
        const selectedPost = visiblePostById.get(postId);
        if (!selectedPost) return;
        currentMode = isPinnedPost(selectedPost) ? 'pinned' : 'unpinned';
      });

      const targetMode = targetPinned ? 'pinned' : 'unpinned';
      if (currentMode && currentMode !== targetMode) return prev;
      return { ...prev, [normalizedPostId]: true };
    });
  }, [canManagePinInCurrentBoard, isPinnedPost, normalizeText, visiblePostById]);

  const handleBulkPinUpdate = useCallback(async (nextPinned) => {
    if (!canManagePinInCurrentBoard) {
      alert('상단 고정은 개별 게시판에서만 가능합니다.');
      return;
    }
    const targetPostIds = selectedPinPostIds.map((postId) => normalizeText(postId)).filter(Boolean);
    if (!targetPostIds.length) {
      alert('상단 고정할 게시글을 먼저 선택해주세요.');
      return;
    }
    if (!selectedPinMode || selectedPinMode === 'mixed') {
      alert('같은 상태(고정/일반)의 게시글만 선택해주세요.');
      return;
    }
    if (selectedPinMode === 'unpinned' && !nextPinned) {
      alert('선택한 게시글은 현재 고정되지 않아 고정 해제할 수 없습니다.');
      return;
    }
    if (selectedPinMode === 'pinned' && nextPinned) {
      alert('선택한 게시글은 이미 상단 고정 상태입니다.');
      return;
    }

    setPinActionPending(true);
    const nowMs = Date.now();
    try {
      const results = await Promise.allSettled(targetPostIds.map((postId) => pinUpdatePost(postId, nextPinned, nowMs, currentUserUid)));
      const successIds = [];
      const failedIds = [];
      results.forEach((result, index) => {
        const postId = targetPostIds[index];
        if (result.status === 'fulfilled') successIds.push(postId);
        else failedIds.push(postId);
      });

      if (successIds.length) {
        const successIdSet = new Set(successIds);
        setVisiblePosts((prev) => prev.map((post) => {
          const postId = normalizeText(post?.id);
          if (!successIdSet.has(postId)) return post;
          return {
            ...post,
            isPinned: nextPinned,
            pinnedAtMs: nextPinned ? nowMs : 0,
            pinnedAt: nextPinned ? post?.pinnedAt : null,
            pinnedByUid: nextPinned ? currentUserUid : ''
          };
        }));
      }

      setSelectedPinPostIdMap((prev) => {
        if (!successIds.length) return prev;
        const next = { ...prev };
        successIds.forEach((postId) => { delete next[postId]; });
        return next;
      });

      if (!failedIds.length) {
        setPageMessage({
          type: 'notice',
          text: nextPinned
            ? `${successIds.length}개 게시글을 상단 고정했습니다.`
            : `${successIds.length}개 게시글의 상단 고정을 해제했습니다.`
        });
        return;
      }

      setPageMessage({
        type: 'error',
        text: `${successIds.length}개 처리, ${failedIds.length}개 실패했습니다.`
      });
    } catch (err) {
      setPageMessage({
        type: 'error',
        text: normalizeErrMessage(err, nextPinned ? '상단 고정 실패' : '상단 고정 해제 실패')
      });
    } finally {
      setPinActionPending(false);
    }
  }, [canManagePinInCurrentBoard, currentUserUid, normalizeErrMessage, normalizeText, pinUpdatePost, selectedPinMode, selectedPinPostIds, setPageMessage, setVisiblePosts]);

  return {
    selectedPinPostIdMap,
    setSelectedPinPostIdMap,
    pinActionPending,
    selectedPinPostIds,
    selectedPinPostCount,
    selectedPinMode,
    showPinToolbar,
    handleMovePost,
    handleSelectBoard,
    handleMoveHome,
    handleBrandTitleKeyDown,
    isPostPinSelectionDisabled,
    handleTogglePinSelect,
    handleBulkPinUpdate
  };
}
