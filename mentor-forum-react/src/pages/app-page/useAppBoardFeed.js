// AppPage board/feed state machine.
// - Owns the selected board, visible post list, pagination, and comment-count
//   hydration for the main forum feed.
// - Keeps list-level UX state near the data-loading path so the top-level
//   controller can remain mostly orchestration-focused.
import { useCallback, useEffect, useMemo, useState } from 'react';

export function useAppBoardFeed({
  ALL_BOARD_ID,
  POSTS_PER_PAGE,
  POST_LIST_VIEW_MODE,
  currentUserProfile,
  roleDefMap,
  isAdminOrSuper = false,
  currentUserUid,
  viewedPostIdMap = {},
  NEW_POST_LOOKBACK_MS,
  postsLoadRequestRef,
  numberOrZero,
  normalizeText,
  toMillis,
  boardAllowedRoles,
  boardAutoVisibility,
  comparePostsWithPinnedPriority,
  getVisiblePosts,
  mergePostsByCreatedAtDesc,
  isPinnedPost,
  canUseBoard,
  queryPostsForBoard,
  fetchCommentCount,
  normalizeErrMessage,
  isCalendarBoardId
}) {
  const [boardList, setBoardList] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(ALL_BOARD_ID);
  const [visiblePosts, setVisiblePosts] = useState([]);
  const [commentCountByPost, setCommentCountByPost] = useState({});
  const [listMessage, setListMessage] = useState({ type: '', text: '' });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [postListViewMode, setPostListViewMode] = useState(POST_LIST_VIEW_MODE.LATEST);

  const boardLookup = useMemo(() => {
    const next = new Map();
    boardList.forEach((board) => {
      const boardId = normalizeText(board?.id);
      if (!boardId) return;
      next.set(boardId, board);
    });
    return next;
  }, [boardList, normalizeText]);
  const boardNavItems = boardList;

  const currentBoard = useMemo(() => {
    const boardId = normalizeText(selectedBoardId);
    if (!boardId) return null;
    return boardLookup.get(boardId) || null;
  }, [boardLookup, selectedBoardId, normalizeText]);

  const isAllBoardSelected = normalizeText(selectedBoardId) === ALL_BOARD_ID;

  const currentBoardName = useMemo(() => {
    if (isAllBoardSelected) return '전체 게시글';
    if (currentBoard) return currentBoard.name || currentBoard.id;
    return normalizeText(selectedBoardId) || '-';
  }, [ALL_BOARD_ID, currentBoard, isAllBoardSelected, selectedBoardId, normalizeText]);

  const currentBoardRoles = useMemo(() => {
    if (!currentBoard) return [];
    return boardAllowedRoles(currentBoard, roleDefMap);
  }, [boardAllowedRoles, currentBoard, roleDefMap]);

  const currentBoardVisibility = useMemo(() => {
    if (!currentBoard) return 'mentor';
    return boardAutoVisibility(currentBoard, roleDefMap);
  }, [boardAutoVisibility, currentBoard, roleDefMap]);

  const canManagePinInCurrentBoard = isAdminOrSuper && !isAllBoardSelected && !!currentBoard;

  const visiblePostById = useMemo(() => {
    const map = new Map();
    visiblePosts.forEach((post) => {
      const postId = normalizeText(post?.id);
      if (!postId) return;
      map.set(postId, post);
    });
    return map;
  }, [visiblePosts, normalizeText]);

  const listedPosts = useMemo(() => {
    const sorted = [...visiblePosts];
    return sorted.sort((a, b) => comparePostsWithPinnedPriority(a, b, postListViewMode));
  }, [comparePostsWithPinnedPriority, postListViewMode, visiblePosts]);

  const totalPostCount = listedPosts.length;

  const latestTenPosts = useMemo(() => {
    return [...visiblePosts]
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, 10);
  }, [toMillis, visiblePosts]);

  const recentUnreadPostIdSet = useMemo(() => {
    const nowMs = Date.now();
    const next = new Set();
    latestTenPosts.forEach((post) => {
      const postId = normalizeText(post?.id);
      if (!postId) return;
      const createdAtMs = toMillis(post?.createdAt);
      if (!createdAtMs || nowMs - createdAtMs > NEW_POST_LOOKBACK_MS) return;
      if (viewedPostIdMap[postId]) return;
      next.add(postId);
    });
    return next;
  }, [NEW_POST_LOOKBACK_MS, latestTenPosts, normalizeText, toMillis, viewedPostIdMap]);

  const totalPageCount = Math.max(1, Math.ceil(totalPostCount / POSTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPageCount);
  const currentPageStartIndex = (safeCurrentPage - 1) * POSTS_PER_PAGE;
  const currentPagePosts = useMemo(() => {
    return listedPosts.slice(currentPageStartIndex, currentPageStartIndex + POSTS_PER_PAGE);
  }, [currentPageStartIndex, listedPosts, POSTS_PER_PAGE]);

  const postListViewTabs = useMemo(() => ([
    { key: POST_LIST_VIEW_MODE.LATEST, label: '최신' },
    { key: POST_LIST_VIEW_MODE.POPULAR, label: '인기' }
  ]), [POST_LIST_VIEW_MODE.LATEST, POST_LIST_VIEW_MODE.POPULAR]);

  const postListEmptyText = useMemo(() => {
    if (postListViewMode === POST_LIST_VIEW_MODE.POPULAR) return '인기 게시글이 없습니다.';
    return '게시글이 없습니다.';
  }, [POST_LIST_VIEW_MODE.POPULAR, postListViewMode]);

  const activeListMessage = useMemo(() => {
    if (listMessage.text) return listMessage;
    if (!loadingPosts && totalPostCount <= 0) {
      return { type: 'notice', text: postListEmptyText };
    }
    return { type: '', text: '' };
  }, [listMessage, loadingPosts, postListEmptyText, totalPostCount]);

  const isPostListEmptyState = useMemo(() => {
    const text = activeListMessage.text;
    if (!text || loadingPosts || totalPostCount > 0) return false;
    return true;
  }, [activeListMessage.text, loadingPosts, totalPostCount]);

  const desktopPostTableColSpan = 7;

  const paginationPages = useMemo(() => {
    const pages = [];
    const start = Math.max(1, safeCurrentPage - 2);
    const end = Math.min(totalPageCount, start + 4);
    for (let pageNo = start; pageNo <= end; pageNo += 1) {
      pages.push(pageNo);
    }
    return pages;
  }, [safeCurrentPage, totalPageCount]);

  const hydrateCommentCounts = useCallback(async (posts, requestId) => {
    const pairs = await Promise.all(
      posts.map(async (post) => [post.id, await fetchCommentCount(post.id)])
    );

    if (requestId !== postsLoadRequestRef.current) return;

    setCommentCountByPost((prev) => {
      const next = { ...prev };
      let changed = false;

      pairs.forEach(([postId, count]) => {
        const normalizedCount = numberOrZero(count);
        if (next[postId] !== normalizedCount) {
          next[postId] = normalizedCount;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [fetchCommentCount, numberOrZero, postsLoadRequestRef]);

  const loadPostsForCurrentBoard = useCallback(async () => {
    if (!currentUserProfile) return;

    const requestId = postsLoadRequestRef.current + 1;
    postsLoadRequestRef.current = requestId;

    setLoadingPosts(true);
    setListMessage({ type: '', text: '' });
    setCommentCountByPost({});

    const selectedId = selectedBoardId || ALL_BOARD_ID;
    let posts = [];

    try {
      if (selectedId === ALL_BOARD_ID) {
        if (!boardList.length) {
          posts = [];
        } else {
          const settled = await Promise.allSettled(
            boardList.map((board) => queryPostsForBoard(board.id, 30))
          );

          const groups = settled
            .filter((item) => item.status === 'fulfilled')
            .map((item) => item.value);
          const rejected = settled.filter((item) => item.status === 'rejected');

          if (!groups.length && rejected.length) throw rejected[0].reason;
          posts = mergePostsByCreatedAtDesc(groups, 50);
        }
      } else {
        if (!currentBoard) {
          const fallbackBoardId = normalizeText(selectedId);
          const fallbackLimit = isCalendarBoardId(fallbackBoardId) ? 320 : 50;
          posts = await queryPostsForCurrentBoardFallback(fallbackBoardId, fallbackLimit, queryPostsForBoard);
        } else if (!canUseBoard(currentBoard)) {
          setVisiblePosts([]);
          setListMessage({ type: 'error', text: '선택한 게시판을 읽을 권한이 없습니다.' });
          setLoadingPosts(false);
          return;
        } else {
          const boardPostLimit = isCalendarBoardId(currentBoard.id) ? 320 : 50;
          posts = await queryPostsForBoard(currentBoard.id, boardPostLimit, {
            allowLooseFallback: true,
            boardName: currentBoard.name || ''
          });
        }
      }
    } catch (err) {
      if (requestId !== postsLoadRequestRef.current) return;
      setVisiblePosts([]);
      setListMessage({ type: 'error', text: normalizeErrMessage(err, '게시글 조회 실패') });
      setLoadingPosts(false);
      return;
    }

    if (requestId !== postsLoadRequestRef.current) return;

    const nextVisiblePosts = getVisiblePosts(posts);
    setVisiblePosts(nextVisiblePosts);

    if (!nextVisiblePosts.length) {
      setListMessage({ type: 'notice', text: '게시글이 없습니다.' });
      setLoadingPosts(false);
      return;
    }

    setListMessage({ type: '', text: '' });
    setLoadingPosts(false);
  }, [
    ALL_BOARD_ID,
    boardList,
    canUseBoard,
    currentBoard,
    currentUserProfile,
    getVisiblePosts,
    isCalendarBoardId,
    mergePostsByCreatedAtDesc,
    normalizeErrMessage,
    normalizeText,
    postsLoadRequestRef,
    queryPostsForBoard,
    selectedBoardId
  ]);

  useEffect(() => {
    if (!currentUserProfile) return;
    loadPostsForCurrentBoard().catch(() => {});
  }, [currentUserProfile, loadPostsForCurrentBoard]);

  useEffect(() => {
    setCurrentPage(1);
  }, [postListViewMode, selectedBoardId]);

  useEffect(() => {
    const nextTotalPages = Math.max(1, Math.ceil(listedPosts.length / POSTS_PER_PAGE));
    setCurrentPage((prev) => Math.min(prev, nextTotalPages));
  }, [listedPosts.length, POSTS_PER_PAGE]);

  useEffect(() => {
    if (loadingPosts || !currentPagePosts.length) return;
    const requestId = postsLoadRequestRef.current;
    hydrateCommentCounts(currentPagePosts, requestId).catch(() => {});
  }, [currentPagePosts, hydrateCommentCounts, loadingPosts, postsLoadRequestRef]);

  return {
    boardNavItems,
    boardList,
    setBoardList,
    selectedBoardId,
    setSelectedBoardId,
    visiblePosts,
    setVisiblePosts,
    commentCountByPost,
    setCommentCountByPost,
    listMessage,
    setListMessage,
    loadingPosts,
    setLoadingPosts,
    currentPage,
    setCurrentPage,
    postListViewMode,
    setPostListViewMode,
    boardLookup,
    currentBoard,
    isAllBoardSelected,
    currentBoardName,
    currentBoardRoles,
    currentBoardVisibility,
    canManagePinInCurrentBoard,
    visiblePostById,
    listedPosts,
    totalPostCount,
    latestTenPosts,
    recentUnreadPostIdSet,
    totalPageCount,
    safeCurrentPage,
    currentPageStartIndex,
    currentPagePosts,
    postListViewTabs,
    postListEmptyText,
    activeListMessage,
    isPostListEmptyState,
    desktopPostTableColSpan,
    paginationPages,
    hydrateCommentCounts,
    loadPostsForCurrentBoard
  };
}

async function queryPostsForCurrentBoardFallback(boardId, limitCount, queryPostsForBoard) {
  return queryPostsForBoard(boardId, limitCount, {
    allowLooseFallback: true,
    boardName: boardId
  });
}
