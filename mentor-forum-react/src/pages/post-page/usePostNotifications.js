// PostPage notification fan-out hook.
// - Resolves direct mentions, @ALL targets, post-author notifications, and
//   reply-author notifications for newly created comments.
import { useCallback } from 'react';

export function usePostNotifications({
  postFirestore,
  normalizeText,
  normalizeNickname,
  buildNicknameKey,
  extractMentionNicknames,
  hasAllMentionCommand,
  normalizeNotificationType,
  notificationIdForEvent,
  toNotificationBodySnippet,
  MENTION_ALL_TOKEN,
  NOTIFICATION_TYPE,
  NOTIFICATION_SUBTYPE,
  isAdminOrSuper,
  serverTimestamp,
  logErrorWithOptionalDebug
}) {
  const resolveMentionTargets = useCallback(async (sourceText) => {
    const nicknames = extractMentionNicknames(sourceText).filter(
      (nickname) => normalizeText(nickname).toUpperCase() !== MENTION_ALL_TOKEN
    );
    if (!nicknames.length) return [];

    const resolved = await Promise.all(
      nicknames.map(async (nickname) => {
        const key = buildNicknameKey(nickname);
        if (!key) return null;
        const snap = await postFirestore.fetchNicknameIndexDoc(key);
        if (!snap.exists()) return null;
        const data = snap.data() || {};
        const uid = normalizeText(data.uid);
        const resolvedNickname = normalizeNickname(data.nickname || nickname);
        if (!uid || !resolvedNickname) return null;
        return { uid, nickname: resolvedNickname };
      })
    );

    const byUid = new Map();
    resolved.forEach((item) => {
      if (!item?.uid) return;
      byUid.set(item.uid, item);
    });
    return [...byUid.values()];
  }, [
    MENTION_ALL_TOKEN,
    buildNicknameKey,
    extractMentionNicknames,
    normalizeNickname,
    normalizeText,
    postFirestore
  ]);

  const resolveAllMentionTargets = useCallback(async () => {
    const usersSnap = await postFirestore.fetchUsersDocs();
    const rows = usersSnap.docs
      .map((row) => {
        const data = row.data() || {};
        const uid = normalizeText(row.id || data.uid);
        const nickname = normalizeNickname(data.nickname || data.realName || data.email || uid);
        if (!uid || !nickname) return null;
        return { uid, nickname };
      })
      .filter(Boolean);

    const byUid = new Map();
    rows.forEach((item) => {
      if (!item?.uid) return;
      byUid.set(item.uid, item);
    });
    return [...byUid.values()];
  }, [normalizeNickname, normalizeText, postFirestore]);

  const writeUserNotification = useCallback(async ({
    targetUid,
    type,
    subtype = '',
    postId: targetPostId,
    boardId,
    boardName,
    title,
    body = '',
    actorUid,
    actorName,
    commentId = ''
  }) => {
    const userUid = normalizeText(targetUid);
    const safePostId = normalizeText(targetPostId);
    const safeBoardId = normalizeText(boardId);
    if (!userUid || !safePostId || !safeBoardId) return null;

    const safeType = normalizeNotificationType(type);
    const safeSubtype = normalizeText(subtype);
    const safeCommentId = normalizeText(commentId);
    const safeActorUid = normalizeText(actorUid);
    const safeActorName = normalizeText(actorName) || '익명';
    const notificationId = notificationIdForEvent(
      `${safeType}${safeSubtype ? `-${safeSubtype}` : ''}`,
      safePostId,
      safeCommentId,
      userUid
    );
    const createdAtMs = Date.now();

    await postFirestore.upsertNotificationDoc(userUid, notificationId, {
      userUid,
      actorUid: safeActorUid,
      actorName: safeActorName,
      type: safeType,
      subtype: safeSubtype,
      postId: safePostId,
      commentId: safeCommentId,
      boardId: safeBoardId,
      boardName: normalizeText(boardName) || safeBoardId,
      title: normalizeText(title) || '(제목 없음)',
      body: toNotificationBodySnippet(body),
      createdAtMs,
      readAtMs: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    return {
      targetUid: userUid,
      notificationId
    };
  }, [
    normalizeNotificationType,
    normalizeText,
    notificationIdForEvent,
    postFirestore,
    serverTimestamp,
    toNotificationBodySnippet
  ]);

  const dispatchCommentNotifications = useCallback(async ({
    payloadText,
    currentPost,
    currentBoardAccessDebug,
    boardLabel,
    currentUser,
    currentUserProfile,
    replyTarget,
    comments,
    createdCommentId
  }) => {
    const actorUid = normalizeText(currentUser?.uid);
    const postIdValue = normalizeText(currentPost?.id);
    const boardIdValue = normalizeText(currentPost?.boardId);
    const boardNameValue = normalizeText(currentBoardAccessDebug?.boardName || boardLabel || boardIdValue) || boardIdValue;
    const postTitle = normalizeText(currentPost?.title) || '(제목 없음)';
    const postAuthorUid = normalizeText(currentPost?.authorUid);
    const commentAuthorName = currentUserProfile?.nickname || currentUserProfile?.realName || currentUser?.email || '익명';
    const mentionTargets = await resolveMentionTargets(payloadText);
    const canUseAllMentionCommand = isAdminOrSuper;
    const hasAllMention = canUseAllMentionCommand && hasAllMentionCommand(payloadText);
    const allMentionTargets = hasAllMention ? await resolveAllMentionTargets() : [];
    const mentionTargetUidSet = new Set(mentionTargets.map((item) => normalizeText(item?.uid)).filter(Boolean));
    const allMentionTargetUidSet = new Set(allMentionTargets.map((item) => normalizeText(item?.uid)).filter(Boolean));

    const parentId = replyTarget ? replyTarget.id : null;
    const parentAuthorUid = parentId
      ? normalizeText(
        replyTarget?.authorUid
        || comments.find((item) => normalizeText(item?.id) === normalizeText(parentId))?.authorUid
      )
      : '';

    const events = [];
    if (postAuthorUid && postAuthorUid !== actorUid) {
      events.push({
        targetUid: postAuthorUid,
        type: NOTIFICATION_TYPE.COMMENT,
        subtype: NOTIFICATION_SUBTYPE.POST_COMMENT,
        body: `${commentAuthorName}님이 내 게시글에 댓글을 남겼습니다.`
      });
    }

    if (
      parentId
      && parentAuthorUid
      && parentAuthorUid !== actorUid
      && parentAuthorUid !== postAuthorUid
      && !mentionTargetUidSet.has(parentAuthorUid)
      && !allMentionTargetUidSet.has(parentAuthorUid)
    ) {
      events.push({
        targetUid: parentAuthorUid,
        type: NOTIFICATION_TYPE.COMMENT,
        subtype: NOTIFICATION_SUBTYPE.REPLY_COMMENT,
        body: `${commentAuthorName}님이 내 댓글에 답글을 남겼습니다.`
      });
    }

    mentionTargets.forEach((target) => {
      const targetUid = normalizeText(target?.uid);
      if (!targetUid || targetUid === actorUid) return;
      events.push({
        targetUid,
        type: NOTIFICATION_TYPE.MENTION,
        subtype: NOTIFICATION_SUBTYPE.MENTION,
        body: `${commentAuthorName}님이 댓글에서 회원님을 언급했습니다.`
      });
    });

    allMentionTargets.forEach((target) => {
      const targetUid = normalizeText(target?.uid);
      if (!targetUid || targetUid === actorUid) return;
      events.push({
        targetUid,
        type: NOTIFICATION_TYPE.MENTION,
        subtype: NOTIFICATION_SUBTYPE.MENTION_ALL,
        body: `${commentAuthorName}님이 댓글에서 @ALL로 전체 멘션을 보냈습니다.`
      });
    });

    const dedupedByKey = new Map();
    events.forEach((eventItem) => {
      const targetUid = normalizeText(eventItem?.targetUid);
      const type = normalizeNotificationType(eventItem?.type);
      const subtype = normalizeText(eventItem?.subtype);
      if (!targetUid) return;
      const key = `${targetUid}|${type}`;
      const existing = dedupedByKey.get(key);
      if (!existing) {
        dedupedByKey.set(key, eventItem);
        return;
      }
      if (
        subtype === NOTIFICATION_SUBTYPE.MENTION_ALL
        && normalizeText(existing?.subtype) !== NOTIFICATION_SUBTYPE.MENTION_ALL
      ) {
        dedupedByKey.set(key, eventItem);
      }
    });

    // Server-side push note:
    // this hook only creates notification docs; Firebase Functions sends FCM.
    await Promise.all(
      [...dedupedByKey.values()].map((eventItem) => writeUserNotification({
        targetUid: eventItem.targetUid,
        type: eventItem.type,
        subtype: eventItem.subtype,
        postId: postIdValue,
        commentId: createdCommentId,
        boardId: boardIdValue,
        boardName: boardNameValue,
        title: postTitle,
        body: eventItem.body,
        actorUid,
        actorName: commentAuthorName
      }))
    );
  }, [
    NOTIFICATION_SUBTYPE.MENTION,
    NOTIFICATION_SUBTYPE.MENTION_ALL,
    NOTIFICATION_SUBTYPE.POST_COMMENT,
    NOTIFICATION_SUBTYPE.REPLY_COMMENT,
    NOTIFICATION_TYPE.COMMENT,
    NOTIFICATION_TYPE.MENTION,
    hasAllMentionCommand,
    isAdminOrSuper,
    logErrorWithOptionalDebug,
    normalizeNotificationType,
    normalizeText,
    resolveAllMentionTargets,
    resolveMentionTargets,
    writeUserNotification
  ]);

  return {
    resolveMentionTargets,
    resolveAllMentionTargets,
    writeUserNotification,
    dispatchCommentNotifications
  };
}
