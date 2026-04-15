// AppPage notification center state.
// - Owns user-visible notification/push preference state and the write-side
//   commands that mutate those documents.
// - Realtime subscriptions are handled in the companion sync hook.
import { useCallback, useMemo, useState } from 'react';

export function useAppNotificationCenter({
  NOTIFICATION_PREF_KEY,
  LEGACY_NOTIFICATION_PREF_KEY,
  MOBILE_PUSH_PREF_KEY,
  NOTIFICATION_RECENT_WINDOW_MS,
  NOTIFICATION_MAX_ITEMS,
  NOTIFICATION_TYPE,
  currentUserUid,
  boardList,
  appFirestore,
  numberOrZero,
  normalizeText,
  normalizeNotificationType,
  notificationMatchesFeedFilter,
  notificationPermissionLabel,
  isForcedNotification,
  normalizeErrMessage,
  logErrorWithOptionalDebug,
  buildPushTokenDocId,
  getWebPushCapability,
  requestWebPushToken,
  WEB_PUSH_SW_PATH,
  toMillis,
  serverTimestamp
}) {
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationPrefs, setNotificationPrefs] = useState({});
  const [notificationFeedFilter, setNotificationFeedFilter] = useState('all');
  const [mobilePushModalOpen, setMobilePushModalOpen] = useState(false);
  const [mobilePushCapability, setMobilePushCapability] = useState({ supported: false, reason: '확인 중...', reasonCode: 'checking' });
  const [mobilePushWorking, setMobilePushWorking] = useState(false);
  const [mobilePushStatus, setMobilePushStatus] = useState({ type: '', text: '' });
  const [mobilePushTokens, setMobilePushTokens] = useState([]);
  const [viewedPostIdMap, setViewedPostIdMap] = useState({});
  const [recentComments, setRecentComments] = useState([]);
  const [recentCommentsLoading, setRecentCommentsLoading] = useState(false);

  const isCommentNotificationEnabled = useMemo(() => {
    return notificationPrefs[NOTIFICATION_PREF_KEY.COMMENT] !== false
      && notificationPrefs[LEGACY_NOTIFICATION_PREF_KEY.COMMENT] !== false;
  }, [LEGACY_NOTIFICATION_PREF_KEY.COMMENT, NOTIFICATION_PREF_KEY.COMMENT, notificationPrefs]);

  const isMentionNotificationEnabled = useMemo(() => {
    return notificationPrefs[NOTIFICATION_PREF_KEY.MENTION] !== false
      && notificationPrefs[LEGACY_NOTIFICATION_PREF_KEY.MENTION] !== false;
  }, [LEGACY_NOTIFICATION_PREF_KEY.MENTION, NOTIFICATION_PREF_KEY.MENTION, notificationPrefs]);

  const isMobilePushEnabled = useMemo(() => {
    return notificationPrefs[MOBILE_PUSH_PREF_KEY.GLOBAL] !== false;
  }, [MOBILE_PUSH_PREF_KEY.GLOBAL, notificationPrefs]);

  const effectiveNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (isForcedNotification(item)) return true;
      const boardId = normalizeText(item?.boardId);
      if (boardId && notificationPrefs[boardId] === false) return false;
      const type = normalizeNotificationType(item?.type);
      if (type === NOTIFICATION_TYPE.COMMENT && !isCommentNotificationEnabled) return false;
      if (type === NOTIFICATION_TYPE.MENTION && !isMentionNotificationEnabled) return false;
      return true;
    });
  }, [
    NOTIFICATION_TYPE.COMMENT,
    NOTIFICATION_TYPE.MENTION,
    isCommentNotificationEnabled,
    isForcedNotification,
    isMentionNotificationEnabled,
    normalizeNotificationType,
    normalizeText,
    notificationPrefs,
    notifications
  ]);

  const recentEffectiveNotifications = useMemo(() => {
    const nowMs = Date.now();
    return effectiveNotifications.filter((item) => {
      const createdAtMs = Number(item?.createdAtMs) || 0;
      if (createdAtMs <= 0) return false;
      return nowMs - createdAtMs <= NOTIFICATION_RECENT_WINDOW_MS;
    });
  }, [NOTIFICATION_RECENT_WINDOW_MS, effectiveNotifications]);

  const filteredNotifications = useMemo(() => {
    return recentEffectiveNotifications.filter((item) => notificationMatchesFeedFilter(item, notificationFeedFilter));
  }, [notificationFeedFilter, notificationMatchesFeedFilter, recentEffectiveNotifications]);

  const unreadNotificationCount = useMemo(() => {
    return recentEffectiveNotifications.filter((item) => !(item && Number(item.readAtMs) > 0)).length;
  }, [recentEffectiveNotifications]);

  const hasUnreadNotifications = unreadNotificationCount > 0;

  const notificationBoardItems = useMemo(() => {
    return boardList.filter((board) => !!board && !board.isDivider && normalizeText(board.id));
  }, [boardList, normalizeText]);

  const hasActivePushToken = useMemo(() => {
    return mobilePushTokens.some((item) => item.enabled !== false);
  }, [mobilePushTokens]);

  const notificationPermission = typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
    ? window.Notification.permission
    : 'unsupported';
  const notificationPermissionText = notificationPermissionLabel(notificationPermission);

  const isBoardNotificationEnabled = useCallback((boardId) => {
    const targetId = normalizeText(boardId);
    if (!targetId) return false;
    return notificationPrefs[targetId] !== false;
  }, [normalizeText, notificationPrefs]);

  const isNotificationTypeEnabled = useCallback((prefKey) => {
    const key = normalizeText(prefKey);
    if (!key) return false;
    return notificationPrefs[key] !== false;
  }, [normalizeText, notificationPrefs]);

  const isMobilePushBoardEnabled = useCallback((boardId) => {
    const key = `pref_mobile_push_board:${normalizeText(boardId)}`;
    if (!key) return false;
    return notificationPrefs[key] !== false;
  }, [normalizeText, notificationPrefs]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!currentUserUid) return;
    const unreadItems = filteredNotifications.filter((item) => !(item && Number(item.readAtMs) > 0));
    if (!unreadItems.length) return;
    const unreadIdSet = new Set(unreadItems.map((item) => normalizeText(item.id)).filter(Boolean));
    const now = Date.now();

    setNotifications((prev) => prev.map((item) => (
      unreadIdSet.has(normalizeText(item?.id)) && !(Number(item?.readAtMs) > 0)
        ? { ...item, readAtMs: now }
        : item
    )));

    await Promise.all(
      unreadItems.map(async (item) => {
        try {
          await appFirestore.updateNotificationDoc(currentUserUid, item.id, {
            readAtMs: now,
            readAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          logErrorWithOptionalDebug('[notification-sync-mark-all-read-failed]', err, {
            error: err,
            uid: currentUserUid,
            notificationId: item.id
          });
        }
      })
    );
  }, [appFirestore, currentUserUid, filteredNotifications, logErrorWithOptionalDebug, normalizeText]);

  const markNotificationRead = useCallback(async (notificationId) => {
    const targetId = normalizeText(notificationId);
    if (!targetId || !currentUserUid) return;
    const now = Date.now();
    setNotifications((prev) => prev.map((item) => (
      item.id === targetId && !(Number(item?.readAtMs) > 0)
        ? { ...item, readAtMs: now }
        : item
    )));

    try {
      await appFirestore.updateNotificationDoc(currentUserUid, targetId, {
        readAtMs: now,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-sync-mark-read-failed]', err, {
        error: err,
        uid: currentUserUid,
        notificationId: targetId
      });
    }
  }, [appFirestore, currentUserUid, logErrorWithOptionalDebug, normalizeText]);

  const toggleBoardNotification = useCallback(async (boardId) => {
    const targetId = normalizeText(boardId);
    if (!targetId || !currentUserUid) return;
    const nextEnabled = !isBoardNotificationEnabled(targetId);

    setNotificationPrefs((prev) => ({ ...(prev || {}), [targetId]: nextEnabled }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, targetId, {
        userUid: currentUserUid,
        boardId: targetId,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-pref-sync-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        boardId: targetId
      });
      setNotificationPrefs((prev) => ({ ...(prev || {}), [targetId]: !nextEnabled }));
    }
  }, [appFirestore, currentUserUid, isBoardNotificationEnabled, logErrorWithOptionalDebug, normalizeText]);

  const toggleNotificationTypePreference = useCallback(async (prefKey) => {
    const targetKey = normalizeText(prefKey);
    if (!targetKey || !currentUserUid) return;
    const nextEnabled = !isNotificationTypeEnabled(targetKey);

    setNotificationPrefs((prev) => ({ ...(prev || {}), [targetKey]: nextEnabled }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, targetKey, {
        userUid: currentUserUid,
        boardId: targetKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[notification-pref-type-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        prefKey: targetKey
      });
      setNotificationPrefs((prev) => ({ ...(prev || {}), [targetKey]: !nextEnabled }));
    }
  }, [appFirestore, currentUserUid, isNotificationTypeEnabled, logErrorWithOptionalDebug, normalizeText]);

  const setMobilePushGlobalPreference = useCallback(async (enabled) => {
    if (!currentUserUid) return;
    const nextEnabled = enabled !== false;
    setNotificationPrefs((prev) => ({ ...(prev || {}), [MOBILE_PUSH_PREF_KEY.GLOBAL]: nextEnabled }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, MOBILE_PUSH_PREF_KEY.GLOBAL, {
        userUid: currentUserUid,
        boardId: MOBILE_PUSH_PREF_KEY.GLOBAL,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-pref-global-write-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setNotificationPrefs((prev) => ({ ...(prev || {}), [MOBILE_PUSH_PREF_KEY.GLOBAL]: !nextEnabled }));
      throw err;
    }
  }, [MOBILE_PUSH_PREF_KEY.GLOBAL, appFirestore, currentUserUid, logErrorWithOptionalDebug]);

  const toggleMobilePushBoardPreference = useCallback(async (boardId) => {
    const boardKey = normalizeText(boardId);
    const prefKey = `pref_mobile_push_board:${boardKey}`;
    if (!currentUserUid || !boardKey || !prefKey) return;
    const nextEnabled = !isMobilePushBoardEnabled(boardKey);

    setNotificationPrefs((prev) => ({ ...(prev || {}), [prefKey]: nextEnabled }));

    try {
      await appFirestore.upsertNotificationPrefDoc(currentUserUid, prefKey, {
        userUid: currentUserUid,
        boardId: prefKey,
        enabled: nextEnabled,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-pref-board-write-failed]', err, {
        error: err,
        uid: currentUserUid,
        boardId: boardKey,
        prefKey
      });
      setNotificationPrefs((prev) => ({ ...(prev || {}), [prefKey]: !nextEnabled }));
    }
  }, [appFirestore, currentUserUid, isMobilePushBoardEnabled, logErrorWithOptionalDebug, normalizeText]);

  const refreshMobilePushCapability = useCallback(async () => {
    const capability = await getWebPushCapability();
    setMobilePushCapability(capability);
  }, [getWebPushCapability]);

  const enableMobilePush = useCallback(async () => {
    if (!currentUserUid) return;
    setMobilePushWorking(true);
    setMobilePushStatus({ type: '', text: '' });

    try {
      const capability = await getWebPushCapability();
      setMobilePushCapability(capability);
      if (!capability.supported) {
        setMobilePushStatus({ type: 'error', text: capability.reason || '모바일 알림을 지원하지 않는 환경입니다.' });
        return;
      }

      const tokenResult = await requestWebPushToken({ serviceWorkerPath: WEB_PUSH_SW_PATH });
      if (!tokenResult.ok) {
        setMobilePushStatus({
          type: 'error',
          text: tokenResult.reason || '알림 권한 또는 토큰 발급에 실패했습니다.'
        });
        return;
      }

      const token = normalizeText(tokenResult.token);
      const tokenId = buildPushTokenDocId(token);
      if (!tokenId) {
        setMobilePushStatus({ type: 'error', text: '토큰 정보를 확인할 수 없습니다.' });
        return;
      }

      const staleEnabledTokens = mobilePushTokens.filter((tokenInfo) => (
        tokenInfo?.id && tokenInfo.id !== tokenId && tokenInfo.enabled !== false
      ));
      if (staleEnabledTokens.length) {
        await Promise.all(staleEnabledTokens.map(async (tokenInfo) => {
          await appFirestore.upsertPushTokenDoc(currentUserUid, tokenInfo.id, {
            userUid: currentUserUid,
            token: normalizeText(tokenInfo.token),
            enabled: false,
            platform: normalizeText(tokenInfo.platform || 'web') || 'web',
            updatedAt: serverTimestamp()
          }, { merge: true });
        }));
      }

      await appFirestore.upsertPushTokenDoc(currentUserUid, tokenId, {
        userUid: currentUserUid,
        token,
        enabled: true,
        platform: /android/i.test(navigator.userAgent || '') ? 'android' : (/iphone|ipad|ipod/i.test(navigator.userAgent || '') ? 'ios' : 'web'),
        locale: normalizeText(navigator.language || 'ko-KR').slice(0, 40),
        userAgent: String(navigator.userAgent || '').slice(0, 480),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      }, { merge: true });

      await setMobilePushGlobalPreference(true, serverTimestamp);
      setMobilePushStatus({ type: 'notice', text: '모바일 알림이 켜졌습니다.' });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-enable-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setMobilePushStatus({ type: 'error', text: normalizeErrMessage(err, '모바일 알림 설정에 실패했습니다.') });
    } finally {
      setMobilePushWorking(false);
    }
  }, [
    WEB_PUSH_SW_PATH,
    appFirestore,
    buildPushTokenDocId,
    currentUserUid,
    getWebPushCapability,
    logErrorWithOptionalDebug,
    mobilePushTokens,
    normalizeErrMessage,
    normalizeText,
    requestWebPushToken,
    setMobilePushGlobalPreference
  ]);

  const disableMobilePush = useCallback(async () => {
    if (!currentUserUid) return;
    setMobilePushWorking(true);
    setMobilePushStatus({ type: '', text: '' });

    try {
      await Promise.all(
        mobilePushTokens.map(async (tokenInfo) => {
          if (!tokenInfo?.id) return;
          await appFirestore.upsertPushTokenDoc(currentUserUid, tokenInfo.id, {
            userUid: currentUserUid,
            token: normalizeText(tokenInfo.token),
            enabled: false,
            platform: normalizeText(tokenInfo.platform || 'web') || 'web',
            updatedAt: serverTimestamp()
          }, { merge: true });
        })
      );

      await setMobilePushGlobalPreference(false, serverTimestamp);
      setMobilePushStatus({ type: 'notice', text: '모바일 알림을 껐습니다.' });
    } catch (err) {
      logErrorWithOptionalDebug('[mobile-push-disable-failed]', err, {
        error: err,
        uid: currentUserUid
      });
      setMobilePushStatus({ type: 'error', text: normalizeErrMessage(err, '모바일 알림 해제에 실패했습니다.') });
    } finally {
      setMobilePushWorking(false);
    }
  }, [appFirestore, currentUserUid, logErrorWithOptionalDebug, mobilePushTokens, normalizeErrMessage, normalizeText, setMobilePushGlobalPreference]);

  const appendNotification = useCallback(async (payload) => {
    if (!currentUserUid) return;
    const safeId = normalizeText(payload?.notificationId);
    if (!safeId) return;
    setNotifications((prev) => {
      const nextItems = Array.isArray(prev) ? [...prev] : [];
      const nextPayload = {
        ...payload,
        id: safeId,
        postId: normalizeText(payload?.postId),
        boardId: normalizeText(payload?.boardId),
        createdAtMs: numberOrZero(payload?.createdAtMs),
        readAtMs: numberOrZero(payload?.readAtMs)
      };
      const existingIndex = nextItems.findIndex((item) => normalizeText(item?.id) === safeId);
      if (existingIndex >= 0) {
        nextItems[existingIndex] = { ...nextItems[existingIndex], ...nextPayload };
      } else {
        nextItems.unshift(nextPayload);
      }
      nextItems.sort((a, b) => numberOrZero(b?.createdAtMs) - numberOrZero(a?.createdAtMs));
      return nextItems.slice(0, NOTIFICATION_MAX_ITEMS);
    });
  }, [NOTIFICATION_MAX_ITEMS, currentUserUid, normalizeText, numberOrZero]);

  return {
    notificationCenterOpen,
    setNotificationCenterOpen,
    notifications,
    setNotifications,
    notificationPrefs,
    setNotificationPrefs,
    notificationFeedFilter,
    setNotificationFeedFilter,
    mobilePushModalOpen,
    setMobilePushModalOpen,
    mobilePushCapability,
    setMobilePushCapability,
    mobilePushWorking,
    setMobilePushWorking,
    mobilePushStatus,
    setMobilePushStatus,
    mobilePushTokens,
    setMobilePushTokens,
    viewedPostIdMap,
    setViewedPostIdMap,
    recentComments,
    setRecentComments,
    recentCommentsLoading,
    setRecentCommentsLoading,
    isCommentNotificationEnabled,
    isMentionNotificationEnabled,
    isMobilePushEnabled,
    effectiveNotifications,
    recentEffectiveNotifications,
    filteredNotifications,
    unreadNotificationCount,
    hasUnreadNotifications,
    notificationBoardItems,
    hasActivePushToken,
    notificationPermission,
    notificationPermissionText,
    isBoardNotificationEnabled,
    isNotificationTypeEnabled,
    isMobilePushBoardEnabled,
    markAllNotificationsRead,
    markNotificationRead,
    toggleBoardNotification,
    toggleNotificationTypePreference,
    toggleMobilePushBoardPreference,
    setMobilePushGlobalPreference,
    refreshMobilePushCapability,
    enableMobilePush,
    disableMobilePush,
    appendNotification
  };
}
