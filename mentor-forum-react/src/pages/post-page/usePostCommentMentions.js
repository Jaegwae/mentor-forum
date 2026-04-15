// PostPage mention subsystem.
// - Maintains separate mention menus for the main comment composer and the edit
//   modal editor, including candidate lookup, keyboard navigation, and
//   insertion back into the rich editor wrapper.
import React, { useCallback, useEffect, useRef, useState } from 'react';

export function usePostCommentMentions({
  editorRef,
  editEditorRef,
  currentUserUid,
  isAdminOrSuper,
  postFirestore,
  normalizeNickname,
  buildNicknameKey,
  normalizeText,
  detectMentionContext,
  canAttemptCommentWrite,
  editModalOpen,
  MENTION_MAX_ITEMS,
  MENTION_ALL_TOKEN,
  MENTION_MENU_ESTIMATED_WIDTH,
  MENTION_MENU_INITIAL
}) {
  const mentionRequestIdRef = useRef({ comment: 0, edit: 0 });
  const mentionCacheRef = useRef(new Map());

  const [commentMentionMenu, setCommentMentionMenu] = useState(MENTION_MENU_INITIAL);
  const [commentMentionCandidates, setCommentMentionCandidates] = useState([]);
  const [commentMentionActiveIndex, setCommentMentionActiveIndex] = useState(0);
  const [editMentionMenu, setEditMentionMenu] = useState(MENTION_MENU_INITIAL);
  const [editMentionCandidates, setEditMentionCandidates] = useState([]);
  const [editMentionActiveIndex, setEditMentionActiveIndex] = useState(0);

  const fetchMentionCandidates = useCallback(async (queryText = '') => {
    const normalizedQuery = normalizeNickname(queryText);
    const keyPrefix = buildNicknameKey(normalizedQuery);
    const snap = await postFirestore.fetchMentionIndexDocs({
      keyPrefix,
      maxItems: MENTION_MAX_ITEMS
    });

    const rows = snap.docs
      .map((row) => {
        const data = row.data() || {};
        const uid = normalizeText(data.uid);
        const nickname = normalizeNickname(data.nickname);
        if (!uid || !nickname) return null;
        return { uid, nickname };
      })
      .filter((row) => !!row && row.uid !== currentUserUid);

    const byUid = new Map();
    rows.forEach((row) => {
      if (!byUid.has(row.uid)) byUid.set(row.uid, row);
    });

    const next = [...byUid.values()].slice(0, MENTION_MAX_ITEMS);
    if (isAdminOrSuper) {
      const lowerQuery = normalizedQuery.toLowerCase();
      if (!lowerQuery || MENTION_ALL_TOKEN.toLowerCase().startsWith(lowerQuery)) {
        next.unshift({ uid: '__all__', nickname: MENTION_ALL_TOKEN });
      }
    }
    return next.slice(0, MENTION_MAX_ITEMS);
  }, [
    MENTION_ALL_TOKEN,
    MENTION_MAX_ITEMS,
    buildNicknameKey,
    currentUserUid,
    isAdminOrSuper,
    normalizeNickname,
    normalizeText,
    postFirestore
  ]);

  const readMentionAnchor = useCallback((editor, mentionStart) => {
    const fallback = { anchorLeft: 8, anchorTop: 12 };
    const quill = editor?.getQuill?.();
    if (!quill) return fallback;

    try {
      const safeStart = Math.max(0, Math.floor(Number(mentionStart) || 0));
      const bounds = quill.getBounds(safeStart, 0);
      const editorWidth = Number(quill.container?.clientWidth) || 0;
      const scrollLeft = Number(quill.root?.scrollLeft) || 0;
      const scrollTop = Number(quill.root?.scrollTop) || 0;
      const desiredLeft = Math.max(8, Math.floor((Number(bounds?.left) || 0) - scrollLeft));
      const maxLeft = editorWidth > 0
        ? Math.max(8, editorWidth - MENTION_MENU_ESTIMATED_WIDTH)
        : desiredLeft;
      return {
        anchorLeft: Math.max(8, Math.min(desiredLeft, maxLeft)),
        anchorTop: Math.max(8, Math.floor((Number(bounds?.top) || 0) + (Number(bounds?.height) || 18) - scrollTop + 4))
      };
    } catch (_) {
      return fallback;
    }
  }, [MENTION_MENU_ESTIMATED_WIDTH]);

  const closeMentionMenu = useCallback((target = 'comment') => {
    if (target === 'edit') {
      setEditMentionMenu(MENTION_MENU_INITIAL);
      setEditMentionCandidates([]);
      setEditMentionActiveIndex(0);
      return;
    }

    setCommentMentionMenu(MENTION_MENU_INITIAL);
    setCommentMentionCandidates([]);
    setCommentMentionActiveIndex(0);
  }, [MENTION_MENU_INITIAL]);

  const syncMentionMenu = useCallback((target = 'comment') => {
    const isEditTarget = target === 'edit';
    const editor = isEditTarget ? editEditorRef.current : editorRef.current;
    if (!editor) {
      closeMentionMenu(target);
      return;
    }

    const selection = editor.getSelection?.() || { index: 0 };
    const rawText = editor.getRawText?.() || editor.getPayload?.()?.text || '';
    const context = detectMentionContext(rawText, selection.index);

    if (!context) {
      closeMentionMenu(target);
      return;
    }

    const anchor = readMentionAnchor(editor, context.start);
    const nextMenu = {
      open: true,
      query: context.query,
      start: context.start,
      end: context.end,
      anchorLeft: anchor.anchorLeft,
      anchorTop: anchor.anchorTop
    };

    if (isEditTarget) {
      setEditMentionMenu(nextMenu);
      setEditMentionActiveIndex(0);
    } else {
      setCommentMentionMenu(nextMenu);
      setCommentMentionActiveIndex(0);
    }

    const cacheKey = `${currentUserUid || '-'}:${context.query.toLowerCase()}`;
    const cached = mentionCacheRef.current.get(cacheKey);
    if (cached) {
      if (isEditTarget) setEditMentionCandidates(cached);
      else setCommentMentionCandidates(cached);
      return;
    }

    const currentRequest = mentionRequestIdRef.current || {};
    const requestId = Number(currentRequest[target] || 0) + 1;
    mentionRequestIdRef.current = { ...currentRequest, [target]: requestId };

    fetchMentionCandidates(context.query)
      .then((rows) => {
        if (Number((mentionRequestIdRef.current || {})[target] || 0) !== requestId) return;
        mentionCacheRef.current.set(cacheKey, rows);
        if (isEditTarget) setEditMentionCandidates(rows);
        else setCommentMentionCandidates(rows);
      })
      .catch(() => {
        if (Number((mentionRequestIdRef.current || {})[target] || 0) !== requestId) return;
        if (isEditTarget) setEditMentionCandidates([]);
        else setCommentMentionCandidates([]);
      });
  }, [
    closeMentionMenu,
    currentUserUid,
    detectMentionContext,
    editEditorRef,
    editorRef,
    fetchMentionCandidates,
    readMentionAnchor
  ]);

  const applyMentionCandidate = useCallback((target, candidate) => {
    const isEditTarget = target === 'edit';
    const editor = isEditTarget ? editEditorRef.current : editorRef.current;
    const mentionMenu = isEditTarget ? editMentionMenu : commentMentionMenu;
    const nickname = normalizeNickname(candidate?.nickname);
    if (!editor || !nickname) return;

    const start = Number.isFinite(Number(mentionMenu.start)) ? Number(mentionMenu.start) : -1;
    const end = Number.isFinite(Number(mentionMenu.end)) ? Number(mentionMenu.end) : -1;
    const safeSelection = editor.getSelection?.() || { index: 0 };
    const replaceStart = start >= 0 ? start : Math.max(0, Number(safeSelection.index) || 0);
    const replaceLen = start >= 0 && end >= start ? (end - start) : 0;

    const inserted = editor.insertMention?.(replaceStart, replaceLen, {
      uid: normalizeText(candidate?.uid),
      nickname
    });
    if (!inserted) {
      editor.replaceRange?.(replaceStart, replaceLen, `@${nickname} `);
    }
    closeMentionMenu(target);
    editor.focus?.();
  }, [
    closeMentionMenu,
    commentMentionMenu,
    editEditorRef,
    editMentionMenu,
    editorRef,
    normalizeNickname,
    normalizeText
  ]);

  const insertReplyMention = useCallback((target) => {
    const editor = editorRef.current;
    const nickname = normalizeNickname(target?.authorName);
    if (!editor || !nickname) return;

    const payloadText = String(editor.getPayload?.()?.text || '');
    const mentionToken = `@${nickname}`;
    if (payloadText.includes(mentionToken)) {
      editor.focus?.();
      return;
    }

    const selection = editor.getSelection?.() || { index: payloadText.length, length: 0 };
    const index = Math.max(0, Number(selection.index) || 0);
    const length = Math.max(0, Number(selection.length) || 0);
    const inserted = editor.insertMention?.(index, length, {
      uid: normalizeText(target?.authorUid),
      nickname
    });
    if (!inserted) {
      editor.replaceRange?.(index, length, `${mentionToken} `);
    }
    editor.focus?.();
  }, [editorRef, normalizeNickname, normalizeText]);

  useEffect(() => {
    const mentionTarget = editMentionMenu.open ? 'edit' : (commentMentionMenu.open ? 'comment' : '');
    if (!mentionTarget) return () => {};

    const onKeyDown = (event) => {
      const candidates = mentionTarget === 'edit' ? editMentionCandidates : commentMentionCandidates;
      const activeIndex = mentionTarget === 'edit' ? editMentionActiveIndex : commentMentionActiveIndex;
      const setActiveIndex = mentionTarget === 'edit' ? setEditMentionActiveIndex : setCommentMentionActiveIndex;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMentionMenu(mentionTarget);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (candidates.length ? (prev + 1) % candidates.length : 0));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (candidates.length ? (prev - 1 + candidates.length) % candidates.length : 0));
        return;
      }

      if (event.key === 'Enter' && candidates.length) {
        event.preventDefault();
        event.stopPropagation();
        const targetCandidate = candidates[activeIndex] || candidates[0];
        applyMentionCandidate(mentionTarget, targetCandidate);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [
    applyMentionCandidate,
    closeMentionMenu,
    commentMentionActiveIndex,
    commentMentionCandidates,
    commentMentionMenu.open,
    editMentionActiveIndex,
    editMentionCandidates,
    editMentionMenu.open
  ]);

  useEffect(() => {
    if (canAttemptCommentWrite) return;
    closeMentionMenu('comment');
  }, [canAttemptCommentWrite, closeMentionMenu]);

  useEffect(() => {
    if (editModalOpen) return;
    closeMentionMenu('edit');
  }, [closeMentionMenu, editModalOpen]);

  return {
    mentionRequestIdRef,
    mentionCacheRef,
    commentMentionMenu,
    setCommentMentionMenu,
    commentMentionCandidates,
    setCommentMentionCandidates,
    commentMentionActiveIndex,
    setCommentMentionActiveIndex,
    editMentionMenu,
    setEditMentionMenu,
    editMentionCandidates,
    setEditMentionCandidates,
    editMentionActiveIndex,
    setEditMentionActiveIndex,
    fetchMentionCandidates,
    readMentionAnchor,
    closeMentionMenu,
    syncMentionMenu,
    applyMentionCandidate,
    insertReplyMention
  };
}
