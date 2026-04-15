// PostPage comment thread hook.
// - Owns realtime comment subscription, reply-target state, and delete flows
//   for the current post.
import React, { useCallback, useEffect, useRef, useState } from 'react';

export function usePostComments({
  currentPost,
  focusCommentId,
  editorRef,
  insertReplyMention,
  syncMentionMenu,
  logErrorWithOptionalDebug,
  normalizeErrMessage,
  normalizeText,
  sortCommentsForDisplay,
  postFirestore,
  setMessage
}) {
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const focusCommentTimerRef = useRef(null);

  const resetCommentsState = useCallback(() => {
    setComments([]);
    setCommentsLoading(false);
    setReplyTarget(null);
  }, []);

  useEffect(() => {
    if (!currentPost?.id) {
      resetCommentsState();
      return () => {};
    }

    setCommentsLoading(true);
    const unsubscribe = postFirestore.subscribeCommentsForPost({
      postId: currentPost.id,
      onNext: (snap) => {
        const ordered = sortCommentsForDisplay(
          snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        );
        setComments(ordered);
        setCommentsLoading(false);
      },
      onError: (err) => {
        logErrorWithOptionalDebug('[comment-realtime-subscribe-failed]', err, {
          error: err,
          postId: currentPost.id
        });
        setComments([]);
        setCommentsLoading(false);
        setMessage((prev) => (
          prev?.type === 'error' && prev?.text
            ? prev
            : { type: 'error', text: normalizeErrMessage(err, '댓글 조회 실패') }
        ));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    currentPost?.id,
    logErrorWithOptionalDebug,
    normalizeErrMessage,
    postFirestore,
    resetCommentsState,
    setMessage,
    sortCommentsForDisplay
  ]);

  useEffect(() => {
    if (!replyTarget) return;
    if (comments.some((comment) => comment.id === replyTarget.id)) return;
    setReplyTarget(null);
  }, [comments, replyTarget]);

  useEffect(() => {
    if (!replyTarget) return () => {};

    let cancelled = false;
    let retries = 0;
    const attemptInsert = () => {
      if (cancelled) return;
      if (editorRef.current) {
        insertReplyMention(replyTarget);
        syncMentionMenu('comment');
        return;
      }
      retries += 1;
      if (retries > 18) return;
      window.setTimeout(attemptInsert, 18);
    };

    window.setTimeout(attemptInsert, 0);
    return () => {
      cancelled = true;
    };
  }, [editorRef, insertReplyMention, replyTarget, syncMentionMenu]);

  useEffect(() => {
    return () => {
      if (focusCommentTimerRef.current) {
        window.clearTimeout(focusCommentTimerRef.current);
        focusCommentTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!focusCommentId || commentsLoading || !comments.length) return;
    if (!comments.some((comment) => String(comment.id) === focusCommentId)) return;

    const targets = Array.from(document.querySelectorAll('[data-comment-id]'));
    const targetEl = targets.find((node) => String(node.getAttribute('data-comment-id') || '') === focusCommentId);
    if (!targetEl) return;

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.remove('comment-focus-highlight');
    void targetEl.offsetWidth;
    targetEl.classList.add('comment-focus-highlight');

    if (focusCommentTimerRef.current) {
      window.clearTimeout(focusCommentTimerRef.current);
      focusCommentTimerRef.current = null;
    }
    focusCommentTimerRef.current = window.setTimeout(() => {
      targetEl.classList.remove('comment-focus-highlight');
      focusCommentTimerRef.current = null;
    }, 2200);
  }, [comments, commentsLoading, focusCommentId]);

  const deleteComment = useCallback(async (commentIdRaw) => {
    const targetCommentId = normalizeText(commentIdRaw);
    if (!targetCommentId || !currentPost) return;
    if (!window.confirm('댓글을 삭제할까요?')) return;

    try {
      await postFirestore.deleteCommentDoc(currentPost.id, targetCommentId);
      if (replyTarget && replyTarget.id === targetCommentId) {
        setReplyTarget(null);
      }
    } catch (err) {
      setMessage({ type: 'error', text: normalizeErrMessage(err, '댓글 삭제 실패') });
    }
  }, [currentPost, normalizeErrMessage, normalizeText, postFirestore, replyTarget, setMessage]);

  return {
    comments,
    commentsLoading,
    replyTarget,
    setReplyTarget,
    resetCommentsState,
    deleteComment
  };
}
