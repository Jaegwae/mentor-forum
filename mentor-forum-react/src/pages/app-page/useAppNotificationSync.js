// AppPage notification/realtime synchronization.
// - Bridges Firestore subscriptions into the notification-center state hook.
// - Also hydrates viewed-post markers, push tokens, and recent comment streams.
import { useEffect } from 'react';

export function useAppNotificationSync({
  appFirestore,
  currentUserUid,
  currentUserProfile,
  boardList,
  ready,
  notificationPrefs,
  notificationPrefsRef,
  knownRealtimePostIdsRef,
  realtimePostsReadyRef,
  setNotifications,
  setNotificationPrefs,
  setNotificationFeedFilter,
  setMobilePushCapability,
  setMobilePushTokens,
  setViewedPostIdMap,
  setRecentComments,
  setRecentCommentsLoading,
  appendNotification,
  getWebPushCapability,
  normalizeErrMessage,
  logErrorWithOptionalDebug,
  normalizeText,
  numberOrZero,
  toMillis,
  boardIdentityCandidates,
  normalizeBoardIdentity,
  postBoardIdentityCandidates,
  isDeletedPost,
  RECENT_COMMENT_FETCH_LIMIT,
  RECENT_COMMENT_MAX_ITEMS,
  NOTIFICATION_FEED_FILTER,
  NOTIFICATION_MAX_ITEMS,
  NOTIFICATION_TYPE,
  NOTIFICATION_SUBTYPE,
  isWorkScheduleShiftAlertNotification
}) {
  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
  }, [notificationPrefs, notificationPrefsRef]);

  useEffect(() => {
    let active = true;
    getWebPushCapability().then((result) => {
      if (!active) return;
      setMobilePushCapability(result);
    }).catch((err) => {
      if (!active) return;
      setMobilePushCapability({
        supported: false,
        reason: normalizeErrMessage(err, '모바일 알림 지원 여부를 확인하지 못했습니다.'),
        reasonCode: 'check-failed'
      });
    });
    return () => {
      active = false;
    };
  }, [getWebPushCapability, normalizeErrMessage, setMobilePushCapability]);

  useEffect(() => {
    if (!currentUserUid) {
      setViewedPostIdMap({});
      return () => {};
    }

    const unsubscribe = appFirestore.subscribeViewedPosts({
      uid: currentUserUid,
      maxItems: 2000,
      onNext: (snap) => {
        const nextMap = {};
        snap.docs.forEach((row) => {
          const postId = normalizeText(row.id || row.data()?.postId);
          if (!postId) return;
          nextMap[postId] = true;
        });
        setViewedPostIdMap(nextMap);
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[viewed-post-sync-subscribe-failed]', err, {
          error: err,
          uid: currentUserUid
        });
        setViewedPostIdMap({});
      }
    });

    return () => {
      unsubscribe();
    };
  }, [appFirestore, currentUserUid, logErrorWithOptionalDebug, normalizeText, setViewedPostIdMap]);

  useEffect(() => {
    if (!currentUserUid) {
      setMobilePushTokens([]);
      return () => {};
    }

    const unsubscribe = appFirestore.subscribePushTokens({
      uid: currentUserUid,
      maxItems: 24,
      onNext: (snap) => {
        const rows = snap.docs
          .map((row) => {
            const data = row.data() || {};
            const id = normalizeText(row.id);
            const token = normalizeText(data.token);
            if (!id || !token) return null;
            return {
              id,
              token,
              platform: normalizeText(data.platform || 'web') || 'web',
              enabled: data.enabled !== false,
              updatedAtMs: toMillis(data.updatedAt)
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        setMobilePushTokens(rows);
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[push-token-sync-subscribe-failed]', err, {
          error: err,
          uid: currentUserUid
        });
        setMobilePushTokens([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [appFirestore, currentUserUid, logErrorWithOptionalDebug, normalizeText, setMobilePushTokens, toMillis]);

  useEffect(() => {
    knownRealtimePostIdsRef.current = new Set();
    realtimePostsReadyRef.current = false;

    if (!currentUserUid) {
      setNotifications([]);
      setNotificationPrefs({});
      setNotificationFeedFilter(NOTIFICATION_FEED_FILTER.ALL);
      return () => {};
    }

    const unsubscribeNotifications = appFirestore.subscribeNotifications({
      uid: currentUserUid,
      maxItems: NOTIFICATION_MAX_ITEMS,
      onNext: (snap) => {
        const normalized = snap.docs
          .map((row) => {
            const data = row.data() || {};
            const id = normalizeText(row.id);
            const postId = normalizeText(data.postId || row.id);
            const boardId = normalizeText(data.boardId);
            if (!id || !postId || !boardId) return null;
            const subtype = normalizeText(data.subtype);
            if (isWorkScheduleShiftAlertNotification({ id, boardId, subtype })) return null;
            return {
              id,
              postId,
              boardId,
              boardName: normalizeText(data.boardName) || boardId,
              title: normalizeText(data.title) || '(제목 없음)',
              actorName: normalizeText(data.actorName) || '익명',
              actorUid: normalizeText(data.actorUid),
              type: normalizeText(data.type),
              subtype,
              body: normalizeText(data.body),
              createdAtMs: numberOrZero(data.createdAtMs),
              readAtMs: numberOrZero(data.readAtMs)
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        setNotifications(normalized.slice(0, NOTIFICATION_MAX_ITEMS));
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[notification-sync-subscribe-failed]', err, {
          error: err,
          uid: currentUserUid
        });
        setNotifications([]);
      }
    });

    const unsubscribePrefs = appFirestore.subscribeNotificationPrefs({
      uid: currentUserUid,
      onNext: (snap) => {
        const nextPrefs = {};
        snap.docs.forEach((row) => {
          const prefKey = normalizeText(row.id || row.data()?.boardId);
          if (!prefKey) return;
          nextPrefs[prefKey] = row.data()?.enabled !== false;
        });
        setNotificationPrefs(nextPrefs);
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[notification-pref-sync-subscribe-failed]', err, {
          error: err,
          uid: currentUserUid
        });
        setNotificationPrefs({});
      }
    });

    return () => {
      unsubscribeNotifications();
      unsubscribePrefs();
    };
  }, [
    NOTIFICATION_FEED_FILTER.ALL,
    NOTIFICATION_MAX_ITEMS,
    appFirestore,
    currentUserUid,
    isWorkScheduleShiftAlertNotification,
    knownRealtimePostIdsRef,
    logErrorWithOptionalDebug,
    normalizeText,
    numberOrZero,
    realtimePostsReadyRef,
    setNotificationFeedFilter,
    setNotificationPrefs,
    setNotifications
  ]);

  useEffect(() => {
    if (!ready || !currentUserUid || !currentUserProfile || !boardList.length) return () => {};

    const boardById = new Map(boardList.map((board) => [normalizeText(board?.id), board]));
    const unsubscribe = appFirestore.subscribeRecentPosts({
      maxItems: 120,
      onNext: (snap) => {
        const previousSeen = knownRealtimePostIdsRef.current;
        const nextSeen = new Set();

        snap.docs.forEach((row) => {
          const post = { id: row.id, ...row.data() };
          if (isDeletedPost(post)) return;

          const postId = normalizeText(post.id);
          if (!postId) return;
          nextSeen.add(postId);

          const isRealtimeNew = realtimePostsReadyRef.current && !previousSeen.has(postId);
          if (!isRealtimeNew) return;

          const boardId = normalizeText(post.boardId);
          const board = boardById.get(boardId) || null;
          if (!board) return;
          if (normalizeText(post.authorUid) === currentUserUid) return;
          if (notificationPrefsRef.current[boardId] === false) return;

          appendNotification({
            notificationId: `post:${postId}`,
            postId,
            boardId,
            boardName: normalizeText(board.name) || boardId,
            type: NOTIFICATION_TYPE.POST,
            subtype: NOTIFICATION_SUBTYPE.POST_CREATE,
            title: normalizeText(post.title) || '(제목 없음)',
            actorUid: normalizeText(post.authorUid),
            actorName: normalizeText(post.authorName || post.authorUid) || '익명',
            body: '',
            createdAtMs: toMillis(post.createdAt) || Date.now()
          });
        });

        knownRealtimePostIdsRef.current = nextSeen;
        realtimePostsReadyRef.current = true;
      },
      onError: (err) => {
        console.error('[post-notification-realtime-failed]', err);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    NOTIFICATION_SUBTYPE.POST_CREATE,
    NOTIFICATION_TYPE.POST,
    appFirestore,
    appendNotification,
    boardList,
    currentUserProfile,
    currentUserUid,
    isDeletedPost,
    knownRealtimePostIdsRef,
    normalizeText,
    notificationPrefsRef,
    ready,
    realtimePostsReadyRef,
    toMillis
  ]);

  useEffect(() => {
    if (!ready || !currentUserUid || !boardList.length) {
      setRecentComments([]);
      setRecentCommentsLoading(false);
      return () => {};
    }

    setRecentCommentsLoading(true);
    const boardById = new Map(boardList.map((board) => [normalizeText(board?.id), board]));
    const boardByIdentity = new Map();
    boardList.forEach((board) => {
      const boardId = normalizeText(board?.id);
      const boardName = normalizeText(board?.name);
      boardIdentityCandidates(boardId, boardName).forEach((candidate) => {
        const key = normalizeBoardIdentity(candidate);
        if (!key) return;
        if (!boardByIdentity.has(key)) boardByIdentity.set(key, board);
      });
    });

    const resolveBoardForPost = (post) => {
      const candidates = postBoardIdentityCandidates(post);
      for (let idx = 0; idx < candidates.length; idx += 1) {
        const key = normalizeBoardIdentity(candidates[idx]);
        if (!key) continue;
        const matched = boardByIdentity.get(key);
        if (matched) return matched;
      }
      return boardById.get(normalizeText(post?.boardId)) || null;
    };

    let cancelled = false;
    let fallbackToken = 0;

    const parseRowsFromSnapshot = (snap) => {
      return snap.docs
        .map((row) => {
          const data = row.data() || {};
          const postId = normalizeText(row.ref?.parent?.parent?.id);
          const commentId = normalizeText(row.id);
          if (!postId || !commentId) return null;
          return {
            postId,
            commentId,
            createdAt: data.createdAt || null,
            createdAtMs: numberOrZero(data.createdAtMs),
            updatedAt: data.updatedAt || null,
            contentText: normalizeText(
              data.contentText || data.contentRich?.text || data.content || data.body || ''
            ),
            authorName: normalizeText(data.authorName || data.authorUid || '')
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aMs = a.createdAtMs || toMillis(a.createdAt) || toMillis(a.updatedAt);
          const bMs = b.createdAtMs || toMillis(b.createdAt) || toMillis(b.updatedAt);
          return bMs - aMs;
        });
    };

    const requestFallbackRows = async () => {
      try {
        const fallbackSnap = await appFirestore.fetchRecentCommentsFallback({
          maxItems: Math.max(120, RECENT_COMMENT_FETCH_LIMIT * 4)
        });
        return parseRowsFromSnapshot(fallbackSnap);
      } catch (err) {
        console.error('[recent-comments-fallback-fetch-failed]', err);
        return [];
      }
    };

    const applyRows = (rows) => {
      const uniquePostIds = [...new Set(rows.map((item) => item.postId))];
      Promise.all(uniquePostIds.map(async (postId) => {
        try {
          const postSnap = await appFirestore.fetchPostDoc(postId);
          if (!postSnap.exists()) return [postId, null];
          return [postId, { id: postSnap.id, ...postSnap.data() }];
        } catch (_) {
          return [postId, null];
        }
      }))
        .then((pairs) => {
          if (cancelled) return;

          const postById = new Map(pairs);
          const nextItems = [];
          rows.forEach((row) => {
            if (nextItems.length >= RECENT_COMMENT_MAX_ITEMS) return;
            const post = postById.get(row.postId);
            if (!post || isDeletedPost(post)) return;
            const board = resolveBoardForPost(post);
            const fallbackBoardId = normalizeText(post?.boardId || post?.board || post?.boardName);
            const boardId = normalizeText(board?.id) || fallbackBoardId;
            const boardName = normalizeText(board?.name) || boardId || '게시판';
            if (!boardId) return;
            nextItems.push({
              key: `${row.postId}:${row.commentId}`,
              postId: row.postId,
              commentId: row.commentId,
              boardId,
              boardName,
              preview: normalizeText(row.contentText) || '(내용 없음)',
              authorName: row.authorName || '익명'
            });
          });

          setRecentComments(nextItems);
          setRecentCommentsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setRecentComments([]);
          setRecentCommentsLoading(false);
        });
    };

    const unsubscribe = appFirestore.subscribeRecentComments({
      maxItems: RECENT_COMMENT_FETCH_LIMIT,
      onNext: (snap) => {
        if (cancelled) return;
        const rows = parseRowsFromSnapshot(snap);
        if (!rows.length) {
          fallbackToken += 1;
          const token = fallbackToken;
          requestFallbackRows().then((fallbackRows) => {
            if (cancelled || token !== fallbackToken) return;
            if (!fallbackRows.length) {
              setRecentComments([]);
              setRecentCommentsLoading(false);
              return;
            }
            applyRows(fallbackRows);
          }).catch(() => {
            if (cancelled || token !== fallbackToken) return;
            setRecentComments([]);
            setRecentCommentsLoading(false);
          });
          return;
        }
        applyRows(rows);
      },
      onError: (err) => {
        console.error('[recent-comments-realtime-failed]', err);
        if (cancelled) return;
        fallbackToken += 1;
        const token = fallbackToken;
        requestFallbackRows().then((fallbackRows) => {
          if (cancelled || token !== fallbackToken) return;
          if (!fallbackRows.length) {
            setRecentComments([]);
            setRecentCommentsLoading(false);
            return;
          }
          applyRows(fallbackRows);
        }).catch(() => {
          if (cancelled || token !== fallbackToken) return;
          setRecentComments([]);
          setRecentCommentsLoading(false);
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    RECENT_COMMENT_FETCH_LIMIT,
    RECENT_COMMENT_MAX_ITEMS,
    appFirestore,
    boardIdentityCandidates,
    boardList,
    currentUserUid,
    isDeletedPost,
    normalizeBoardIdentity,
    normalizeText,
    numberOrZero,
    postBoardIdentityCandidates,
    ready,
    setRecentComments,
    setRecentCommentsLoading,
    toMillis
  ]);
}
