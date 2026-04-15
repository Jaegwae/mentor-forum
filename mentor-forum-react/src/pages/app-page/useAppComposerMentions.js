// Composer mention subsystem for AppPage.
// - Watches the rich editor selection/text, positions the anchored mention
//   menu, and resolves nickname candidates through the nickname index.
import { useCallback, useEffect, useRef } from 'react';

export function useAppComposerMentions({
  editorRef,
  currentUserUid,
  isAdminOrSuper,
  appFirestore,
  normalizeNickname,
  buildNicknameKey,
  normalizeText,
  detectMentionContext,
  MENTION_MAX_ITEMS,
  MENTION_ALL_TOKEN,
  MENTION_MENU_ESTIMATED_WIDTH,
  composerMentionMenu,
  setComposerMentionMenu,
  composerMentionCandidates,
  setComposerMentionCandidates,
  composerMentionActiveIndex,
  setComposerMentionActiveIndex,
  composerOpen,
  COMPOSER_MENTION_MENU_INITIAL
}) {
  const mentionRequestIdRef = useRef(0);
  const mentionCacheRef = useRef(new Map());

  const fetchMentionCandidates = useCallback(async (queryText = '') => {
    const normalizedQuery = normalizeNickname(queryText);
    const keyPrefix = buildNicknameKey(normalizedQuery);
    const snap = await appFirestore.fetchMentionIndexDocs({
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
    appFirestore,
    buildNicknameKey,
    currentUserUid,
    isAdminOrSuper,
    normalizeNickname,
    normalizeText
  ]);

  const closeComposerMentionMenu = useCallback(() => {
    setComposerMentionMenu(COMPOSER_MENTION_MENU_INITIAL);
    setComposerMentionCandidates([]);
    setComposerMentionActiveIndex(0);
  }, [
    COMPOSER_MENTION_MENU_INITIAL,
    setComposerMentionActiveIndex,
    setComposerMentionCandidates,
    setComposerMentionMenu
  ]);

  const readComposerMentionAnchor = useCallback((editor, mentionStart) => {
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

  const syncComposerMentionMenu = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      closeComposerMentionMenu();
      return;
    }

    const selection = editor.getSelection?.() || { index: 0 };
    const rawText = editor.getRawText?.() || editor.getPayload?.()?.text || '';
    const context = detectMentionContext(rawText, selection.index);
    if (!context) {
      closeComposerMentionMenu();
      return;
    }

    const anchor = readComposerMentionAnchor(editor, context.start);
    setComposerMentionMenu({
      open: true,
      query: context.query,
      start: context.start,
      end: context.end,
      anchorLeft: anchor.anchorLeft,
      anchorTop: anchor.anchorTop
    });
    setComposerMentionActiveIndex(0);

    const cacheKey = `${currentUserUid || '-'}:${context.query.toLowerCase()}`;
    const cached = mentionCacheRef.current.get(cacheKey);
    if (cached) {
      setComposerMentionCandidates(cached);
      return;
    }

    const requestId = Number(mentionRequestIdRef.current || 0) + 1;
    mentionRequestIdRef.current = requestId;
    fetchMentionCandidates(context.query)
      .then((rows) => {
        if (Number(mentionRequestIdRef.current || 0) !== requestId) return;
        mentionCacheRef.current.set(cacheKey, rows);
        setComposerMentionCandidates(rows);
      })
      .catch(() => {
        if (Number(mentionRequestIdRef.current || 0) !== requestId) return;
        setComposerMentionCandidates([]);
      });
  }, [
    closeComposerMentionMenu,
    currentUserUid,
    detectMentionContext,
    editorRef,
    fetchMentionCandidates,
    readComposerMentionAnchor,
    setComposerMentionActiveIndex,
    setComposerMentionCandidates,
    setComposerMentionMenu
  ]);

  const applyComposerMentionCandidate = useCallback((candidate) => {
    const editor = editorRef.current;
    const nickname = normalizeNickname(candidate?.nickname);
    if (!editor || !nickname) return;

    const start = Number.isFinite(Number(composerMentionMenu.start)) ? Number(composerMentionMenu.start) : -1;
    const end = Number.isFinite(Number(composerMentionMenu.end)) ? Number(composerMentionMenu.end) : -1;
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
    closeComposerMentionMenu();
    editor.focus?.();
  }, [closeComposerMentionMenu, composerMentionMenu.end, composerMentionMenu.start, editorRef, normalizeNickname, normalizeText]);

  useEffect(() => {
    if (!composerOpen) return () => {};
    return () => {};
  }, [composerOpen]);

  useEffect(() => {
    if (!composerOpen) {
      closeComposerMentionMenu();
      return () => {};
    }
    return () => {};
  }, [closeComposerMentionMenu, composerOpen]);

  useEffect(() => {
    if (!composerMentionMenu.open) return () => {};

    const onKeyDown = (event) => {
      if (!composerMentionMenu.open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeComposerMentionMenu();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setComposerMentionActiveIndex((prev) => {
          if (!composerMentionCandidates.length) return 0;
          return (prev + 1) % composerMentionCandidates.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setComposerMentionActiveIndex((prev) => {
          if (!composerMentionCandidates.length) return 0;
          return (prev - 1 + composerMentionCandidates.length) % composerMentionCandidates.length;
        });
        return;
      }

      if (event.key === 'Enter' && composerMentionCandidates.length) {
        event.preventDefault();
        event.stopPropagation();
        const target = composerMentionCandidates[composerMentionActiveIndex] || composerMentionCandidates[0];
        applyComposerMentionCandidate(target);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [
    applyComposerMentionCandidate,
    closeComposerMentionMenu,
    composerMentionActiveIndex,
    composerMentionCandidates,
    composerMentionMenu.open,
    setComposerMentionActiveIndex
  ]);

  return {
    mentionRequestIdRef,
    mentionCacheRef,
    fetchMentionCandidates,
    closeComposerMentionMenu,
    readComposerMentionAnchor,
    syncComposerMentionMenu,
    applyComposerMentionCandidate
  };
}
