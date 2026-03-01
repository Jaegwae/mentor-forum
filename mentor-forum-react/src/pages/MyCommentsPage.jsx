/**
 * "내가 쓴 댓글" 페이지.
 * - collectionGroup(comments) 조회 후 원본 post 정보를 hydrate해 목록을 구성한다.
 * - 일반 카드 UI/Excel 모드를 동일 데이터 흐름으로 유지한다.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpen, FileText, LogOut, MessageSquare, Users2 } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildMyCommentsExcelSheetModel
} from '../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../hooks/useTheme.js';
import {
  auth,
  db,
  ensureFirebaseConfigured,
  onAuthStateChanged,
  enforceTemporaryLoginExpiry,
  clearTemporaryLoginExpiry,
  signOut,
  doc,
  getDoc,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  getDocs
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { getRoleBadgePalette } from '../legacy/rbac.js';

const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
const MY_COMMENTS_PAGE_SIZE = 30;
const POST_IN_QUERY_CHUNK = 10;
const FALLBACK_ROLE_DEFINITIONS = [
  { role: 'Newbie', labelKo: '새싹', badgeBgColor: '#ffffff', badgeTextColor: '#334155' },
  { role: 'Mentor', labelKo: '멘토', badgeBgColor: '#dcfce7', badgeTextColor: '#166534' },
  { role: 'Staff', labelKo: '운영진', badgeBgColor: '#fde68a', badgeTextColor: '#92400e' },
  { role: 'Admin', labelKo: '관리자', badgeBgColor: '#dbeafe', badgeTextColor: '#1d4ed8' },
  { role: 'Super_Admin', labelKo: '개발자', badgeBgColor: '#f3e8ff', badgeTextColor: '#7e22ce' }
];

function normalizeText(value) {
  return String(value || '').trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDate(value) {
  if (!value) return '-';
  const d = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}. ${m}. ${day}. ${hh}:${mm}`;
}

function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  roleDefinitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

function snippetText(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(내용 없음)';
  if (clean.length <= 120) return clean;
  return `${clean.slice(0, 120)}...`;
}

function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const viewportWide = window.matchMedia('(min-width: 901px)').matches;
  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ''));

  const desktopLike = viewportWide && hoverFine && pointerFine && !mobileUa;
  return !desktopLike;
}

function postIdFromCommentPath(path) {
  const parts = String(path || '').split('/');
  if (parts.length >= 4 && parts[0] === 'posts') return parts[1];
  return '';
}

function RoleBadge({ role, roleDefMap }) {
  const roleKey = normalizeText(role) || 'Newbie';
  const roleDef = roleDefMap.get(roleKey) || null;
  const palette = getRoleBadgePalette(roleKey, roleDef);
  const label = roleDef?.labelKo || roleKey;

  return (
    <span
      className="role-badge"
      style={{
        background: palette.bgColor,
        color: palette.textColor,
        borderColor: palette.borderColor
      }}
    >
      {label}
    </span>
  );
}

function AuthorWithRole({ name, role, roleDefMap }) {
  return (
    <span className="author-role-wrap">
      <span className="author-name">{name || '-'}</span>
      <RoleBadge role={role} roleDefMap={roleDefMap} />
    </span>
  );
}

async function loadRoleDefinitions() {
  // 역할 정의 누락 시에도 표시가 깨지지 않도록 fallback 정의를 함께 사용한다.
  const snap = await getDocs(collection(db, 'role_definitions'));
  const definitions = snap.docs.map((d) => ({ role: d.id, ...d.data() }));
  const mergedByRole = new Map();

  FALLBACK_ROLE_DEFINITIONS.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  definitions.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...(mergedByRole.get(key) || {}), ...item, role: key });
  });

  return [...mergedByRole.values()];
}

export default function MyCommentsPage() {
  usePageMeta('내가 쓴 댓글', 'app-page');

  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isExcel = theme === 'excel';
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState([]);
  const [boardNameMap, setBoardNameMap] = useState({});
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [commentsCursor, setCommentsCursor] = useState(null);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const userRoleLabel = useMemo(() => {
    const roleKey = normalizeText(currentUserProfile?.role);
    if (!roleKey) return '-';
    return roleDefMap.get(roleKey)?.labelKo || roleKey;
  }, [currentUserProfile?.role, roleDefMap]);
  const userDisplayName = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUserProfile.email || '사용자')
    : '사용자';
  const [compactListMode, setCompactListMode] = useState(detectCompactListMode);

  const loadBoardNameMap = useCallback(async () => {
    const boardSnap = await getDocs(collection(db, 'boards'));
    const nextBoardNameMap = {};
    boardSnap.docs.forEach((row) => {
      const data = row.data() || {};
      if (data.isDivider === true) return;
      nextBoardNameMap[row.id] = data.name || row.id;
    });
    setBoardNameMap(nextBoardNameMap);
    return nextBoardNameMap;
  }, []);

  const hydrateCommentRows = useCallback(async (commentRows, boardMap) => {
    const postIdSet = new Set(commentRows.map((row) => row.postId).filter(Boolean));
    const postIds = [...postIdSet];
    const postMap = new Map();
    const fetchTasks = [];

    // Firestore in 쿼리 제한(최대 10개)에 맞춰 postId를 청크로 조회한다.
    for (let idx = 0; idx < postIds.length; idx += POST_IN_QUERY_CHUNK) {
      const chunk = postIds.slice(idx, idx + POST_IN_QUERY_CHUNK);
      if (!chunk.length) continue;
      fetchTasks.push(
        getDocs(query(collection(db, 'posts'), where(documentId(), 'in', chunk)))
      );
    }

    const postSnaps = await Promise.all(fetchTasks);
    postSnaps.forEach((snap) => {
      snap.docs.forEach((row) => {
        postMap.set(row.id, { id: row.id, ...row.data() });
      });
    });

    return commentRows
      .map((row) => {
        const post = postMap.get(row.postId);
        const boardId = normalizeText(post?.boardId);
        return {
          ...row,
          postId: row.postId,
          boardId,
          boardName: boardMap[boardId] || boardId || '-',
          postTitle: normalizeText(post?.title) || '(게시글 정보 없음)',
          postExists: !!post,
          postDeleted: !!post?.deleted
        };
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, []);

  const loadMyComments = useCallback(async (uid, options = {}) => {
    const append = options.append === true;
    const cursor = options.cursor || null;

    if (append) {
      setLoadingMoreComments(true);
    } else {
      setLoading(true);
    }
    if (!append) setMessage({ type: '', text: '' });

    try {
      const activeBoardNameMap = Object.keys(boardNameMap).length
        ? boardNameMap
        : await loadBoardNameMap();

      const constraints = [
        where('authorUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(MY_COMMENTS_PAGE_SIZE)
      ];
      if (cursor) constraints.push(startAfter(cursor));

      const commentSnap = await getDocs(query(collectionGroup(db, 'comments'), ...constraints));

      const commentRows = commentSnap.docs.map((row) => {
        const data = row.data() || {};
        const path = row.ref?.path || '';
        return {
          id: row.id,
          ...data,
          postId: postIdFromCommentPath(path)
        };
      });

      const merged = await hydrateCommentRows(commentRows, activeBoardNameMap);
      const lastDoc = commentSnap.docs.length ? commentSnap.docs[commentSnap.docs.length - 1] : null;
      setCommentsCursor(lastDoc);
      setHasMoreComments(commentSnap.docs.length === MY_COMMENTS_PAGE_SIZE);

      if (append) {
        setComments((prev) => [...prev, ...merged]);
        return;
      }

      setComments(merged);
      if (!merged.length) {
        setMessage({ type: 'notice', text: '아직 작성한 댓글이 없습니다.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || '내 댓글 목록을 불러오지 못했습니다.' });
      if (!append) {
        setComments([]);
        setCommentsCursor(null);
        setHasMoreComments(false);
      }
    } finally {
      if (append) {
        setLoadingMoreComments(false);
      } else {
        setLoading(false);
      }
    }
  }, [boardNameMap, hydrateCommentRows, loadBoardNameMap]);

  useEffect(() => {
    let active = true;
    setReady(false);

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) {
        setMessage({ type: 'error', text: err?.message || 'Firebase 설정 오류' });
        setReady(true);
      }
      return () => {
        active = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
        return;
      }

      const sessionState = await enforceTemporaryLoginExpiry();
      if (!active) return;
      if (sessionState.expired) {
        clearTemporaryLoginExpiry();
        alert(AUTO_LOGOUT_MESSAGE);
        navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
        return;
      }

      try {
        // 초기 진입 시 role/profile/boardMap과 댓글 목록을 순서대로 준비한다.
        const [loadedRoleDefinitions, profileSnap] = await Promise.all([
          loadRoleDefinitions(),
          getDoc(doc(db, 'users', user.uid))
        ]);
        if (!active) return;

        const profile = profileSnap.exists()
          ? profileSnap.data()
          : {
            uid: user.uid,
            email: user.email || '',
            nickname: user.email ? user.email.split('@')[0] : 'new-user',
            role: MENTOR_FORUM_CONFIG.app.defaultRole
          };

        setRoleDefinitions(loadedRoleDefinitions);
        setCurrentUserProfile(profile);
        setCurrentUserId(user.uid);
        await loadBoardNameMap();
        await loadMyComments(user.uid);
      } catch (err) {
        if (!active) return;
        setMessage({ type: 'error', text: err?.message || '초기화 실패' });
      } finally {
        if (active) setReady(true);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadBoardNameMap, loadMyComments, navigate]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const wideMedia = window.matchMedia('(min-width: 901px)');
    const hoverMedia = window.matchMedia('(hover: hover)');
    const pointerMedia = window.matchMedia('(pointer: fine)');

    const syncMode = () => setCompactListMode(detectCompactListMode());
    syncMode();

    if (
      typeof wideMedia.addEventListener === 'function'
      && typeof hoverMedia.addEventListener === 'function'
      && typeof pointerMedia.addEventListener === 'function'
    ) {
      wideMedia.addEventListener('change', syncMode);
      hoverMedia.addEventListener('change', syncMode);
      pointerMedia.addEventListener('change', syncMode);
      return () => {
        wideMedia.removeEventListener('change', syncMode);
        hoverMedia.removeEventListener('change', syncMode);
        pointerMedia.removeEventListener('change', syncMode);
      };
    }

    wideMedia.addListener(syncMode);
    hoverMedia.addListener(syncMode);
    pointerMedia.addListener(syncMode);
    return () => {
      wideMedia.removeListener(syncMode);
      hoverMedia.removeListener(syncMode);
      pointerMedia.removeListener(syncMode);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    clearTemporaryLoginExpiry();
    await signOut(auth);
    navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
  }, [navigate]);

  const handleOpenGuide = useCallback(() => {
    const appPage = MENTOR_FORUM_CONFIG.app.appPage || '/app';
    navigate(`${appPage}?guide=1`);
  }, [navigate]);

  const handleLoadMoreComments = useCallback(async () => {
    if (!currentUserId || !commentsCursor || !hasMoreComments || loading || loadingMoreComments) return;
    await loadMyComments(currentUserId, { append: true, cursor: commentsCursor });
  }, [
    commentsCursor,
    currentUserId,
    hasMoreComments,
    loadMyComments,
    loading,
    loadingMoreComments
  ]);

  const moveCommentPost = useCallback((comment) => {
    if (!comment?.postExists || !comment?.postId) {
      alert('원본 게시글 정보를 찾을 수 없습니다.');
      return;
    }

    const postPage = MENTOR_FORUM_CONFIG.app.postPage || '/post';
    const qs = new URLSearchParams();
    qs.set('postId', String(comment.postId));
    if (comment.boardId) {
      // Keep source board information so post detail can route back to the correct list tab.
      qs.set('boardId', String(comment.boardId));
      qs.set('fromBoardId', String(comment.boardId));
    }
    qs.set('commentId', String(comment.id || ''));

    navigate(`${postPage}?${qs.toString()}`, {
      state: {
        postBoardId: comment.boardId || '',
        fromBoardId: comment.boardId || ''
      }
    });
  }, [navigate]);

  const forumPage = MENTOR_FORUM_CONFIG.app.appPage;
  const myPostsPage = MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts';
  const handleMoveHome = useCallback(() => {
    navigate(forumPage);
  }, [forumPage, navigate]);
  const handleBrandTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleMoveHome();
  }, [handleMoveHome]);

  const excelComments = useMemo(() => {
    return comments.map((comment, idx) => ({
      commentId: comment.id || '',
      postId: comment.postId || '',
      boardId: comment.boardId || '',
      no: comments.length - idx,
      commentText: snippetText(comment.contentText),
      postTitle: comment.postTitle || '-',
      boardName: comment.boardName || '-',
      dateText: formatDate(comment.createdAt)
    }));
  }, [comments]);

  const excelCommentsById = useMemo(() => {
    return new Map(comments.map((comment) => [String(comment.id), comment]));
  }, [comments]);

  const excelSheetModel = useMemo(() => {
    // Excel 시트 모델은 comment list를 화면 전용 셀 데이터로 변환한 결과다.
    return buildMyCommentsExcelSheetModel({
      userDisplayName,
      userRoleLabel,
      comments: excelComments,
      safeCurrentPage: 1,
      totalPageCount: 1,
      paginationPages: [1],
      emptyMessage: loading ? '불러오는 중...' : (message.text || '작성한 댓글이 없습니다.')
    });
  }, [excelComments, loading, message.text, userDisplayName, userRoleLabel]);

  const isExcelDesktopMode = isExcel && !compactListMode;
  const [excelActiveCellLabel, setExcelActiveCellLabel] = useState('');
  const [excelFormulaText, setExcelFormulaText] = useState('=');
  const handleExcelSelectCell = useCallback((payload) => {
    const label = normalizeText(payload?.label);
    const text = String(payload?.text ?? '').trim();
    setExcelActiveCellLabel(label || '');
    setExcelFormulaText(text || '=');
  }, []);

  const handleExcelAction = useCallback((actionType, payload) => {
    if (actionType !== 'openCommentPost') return;
    const commentId = normalizeText(payload?.commentId);
    if (commentId) {
      const row = excelCommentsById.get(commentId);
      if (row) {
        moveCommentPost(row);
        return;
      }
    }
    moveCommentPost({
      id: commentId,
      postId: normalizeText(payload?.postId),
      boardId: normalizeText(payload?.boardId)
    });
  }, [excelCommentsById, moveCommentPost]);

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${comments.length}건`}
          activeCellLabel={isExcelDesktopMode ? excelActiveCellLabel : ''}
          formulaText={isExcelDesktopMode ? excelFormulaText : '='}
          showHeaders
          rowCount={EXCEL_STANDARD_ROW_COUNT}
          colCount={EXCEL_STANDARD_COL_COUNT}
          compact={compactListMode}
        />
      ) : null}
      <motion.main
        className={isExcel ? 'page stack my-activity-shell excel-chrome-offset' : 'page stack my-activity-shell'}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      >
      {isExcelDesktopMode ? (
        <AppExcelWorkbook
          sheetRows={excelSheetModel.rowData}
          rowCount={excelSheetModel.rowCount}
          colCount={excelSheetModel.colCount}
          onSelectCell={handleExcelSelectCell}
          onNavigateMyPosts={() => navigate(myPostsPage)}
          onNavigateMyComments={() => navigate(MENTOR_FORUM_CONFIG.app.myCommentsPage || '/me/comments')}
          onOpenGuide={handleOpenGuide}
          onToggleTheme={toggleTheme}
          onLogout={() => handleLogout().catch(() => {})}
          onMoveHome={handleMoveHome}
          onAction={handleExcelAction}
        />
      ) : null}
      <div className={isExcelDesktopMode ? 'hidden' : ''}>
      <section className="card hero-card my-activity-hero">
        <div className="row space-between mobile-col">
          <div>
            <p className="hero-kicker"><Users2 size={15} /> Community Hub</p>
            <h1
              className="forum-brand-title is-link"
              role="button"
              tabIndex={0}
              onClick={handleMoveHome}
              onKeyDown={handleBrandTitleKeyDown}
            >
              멘토스
            </h1>
            <p className="hero-copy">멘토끼리 자유롭게 소통 가능한 커뮤니티입니다!</p>
          </div>

          <div className="row top-action-row">
            <button
              type="button"
              className="btn-muted guide-help-btn"
              aria-label="사용 설명서 열기"
              title="사용 설명서"
              onClick={handleOpenGuide}
            >
              <BookOpen size={16} />
              <span className="guide-help-btn-text">사용 설명서</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="row top-action-row my-activity-top-actions">
          <button type="button" className="btn-muted" onClick={() => navigate(forumPage)}>
            <ArrowLeft size={16} />
            포럼으로
          </button>
          <button type="button" className="btn-muted" onClick={() => navigate(myPostsPage)}>
            <FileText size={16} />
            내 게시글
          </button>
          <button type="button" className="btn-muted" onClick={() => handleLogout().catch(() => {})}>
            <LogOut size={16} />
            로그아웃
          </button>
        </div>

        <div className="notice my-activity-mobile-account" style={{ marginTop: '12px' }}>
          계정: <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
        </div>

        <div className={message.text ? (message.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '10px' }}>
          {message.text}
        </div>
      </section>

      <section className="my-activity-content-layout">
        <aside className="board-rail my-activity-side-rail" aria-label="내 정보">
          <section className="board-rail-profile my-activity-side-profile">
            <div className="board-profile-head-row">
              <p className="board-rail-profile-kicker">내 정보</p>
              <button type="button" className="board-notification-btn is-logout my-activity-side-logout" onClick={() => handleLogout().catch(() => {})}>
                <LogOut size={13} />
                <span className="board-top-logout-text">로그아웃</span>
              </button>
            </div>
            <div className="board-rail-profile-user">
              <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
            </div>
            <div className="board-rail-profile-actions">
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(forumPage)}>
                <ArrowLeft size={14} />
                포럼으로
              </button>
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myPostsPage)}>
                <FileText size={14} />
                내가 쓴 글
              </button>
              <button type="button" className="board-rail-profile-btn is-current" disabled>
                <MessageSquare size={14} />
                내가 쓴 댓글
              </button>
            </div>
          </section>
        </aside>

        <section className="card my-activity-list-card">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><MessageSquare size={18} /> 작성한 댓글 목록</h2>
            <span className="badge">{comments.length}건</span>
          </div>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table my-activity-table">
              <thead>
                <tr>
                  <th style={{ width: '72px' }}>번호</th>
                  <th>댓글 내용</th>
                  <th style={{ width: '220px' }}>게시글</th>
                  <th style={{ width: '170px' }}>게시판</th>
                  <th style={{ width: '160px' }}>작성일</th>
                </tr>
              </thead>
              <tbody>
                {!ready || loading ? (
                  <tr>
                    <td colSpan={5} className="muted">불러오는 중...</td>
                  </tr>
                ) : comments.map((comment, idx) => {
                  const no = comments.length - idx;
                  return (
                    <tr key={`${comment.postId}-${comment.id}`} className="my-activity-row" onClick={() => moveCommentPost(comment)}>
                      <td>{no}</td>
                      <td><span className="text-ellipsis-2" title={snippetText(comment.contentText)}>{snippetText(comment.contentText)}</span></td>
                      <td><span className="text-ellipsis-1" title={comment.postTitle}>{comment.postTitle}</span></td>
                      <td><span className="text-ellipsis-1" title={comment.boardName}>{comment.boardName}</span></td>
                      <td>{formatDate(comment.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {ready && !loading ? (
            <div className="row" style={{ marginTop: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn-muted"
                onClick={() => handleLoadMoreComments().catch(() => {})}
                disabled={!hasMoreComments || loadingMoreComments}
              >
                {loadingMoreComments ? '불러오는 중...' : (hasMoreComments ? '더보기' : '마지막 페이지')}
              </button>
            </div>
          ) : null}

          <div className="my-activity-mobile-list">
            {!ready || loading ? <p className="muted">불러오는 중...</p> : null}
            {ready && !loading && !comments.length ? <p className="muted">아직 작성한 댓글이 없습니다.</p> : null}
            {ready && !loading ? comments.map((comment, idx) => {
              const no = comments.length - idx;
              return (
                <button
                  key={`mobile-comment-${comment.postId}-${comment.id}`}
                  type="button"
                  className="my-activity-mobile-item"
                  onClick={() => moveCommentPost(comment)}
                >
                  <div className="my-activity-mobile-top">
                    <span className="my-activity-mobile-no">#{no}</span>
                    <span className="my-activity-mobile-board text-ellipsis-1">{comment.boardName}</span>
                  </div>
                  <p className="my-activity-mobile-title text-ellipsis-2">{snippetText(comment.contentText)}</p>
                  <p className="my-activity-mobile-post text-ellipsis-1">{comment.postTitle}</p>
                  <p className="my-activity-mobile-meta">{formatDate(comment.createdAt)}</p>
                </button>
              );
            }) : null}
            {ready && !loading ? (
              <div className="row" style={{ marginTop: '10px', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn-muted"
                  onClick={() => handleLoadMoreComments().catch(() => {})}
                  disabled={!hasMoreComments || loadingMoreComments}
                >
                  {loadingMoreComments ? '불러오는 중...' : (hasMoreComments ? '더보기' : '마지막 페이지')}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </section>
      </div>
      </motion.main>
    </>
  );
}
