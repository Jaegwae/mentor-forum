// User page that lists authored posts.
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
  buildMyPostsExcelSheetModel
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
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { getRoleBadgePalette } from '../legacy/rbac.js';

const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
const MY_POSTS_PAGE_SIZE = 30;
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

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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

function detectCompactListMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const viewportWide = window.matchMedia('(min-width: 901px)').matches;
  const hoverFine = window.matchMedia('(hover: hover)').matches;
  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ''));

  const desktopLike = viewportWide && hoverFine && pointerFine && !mobileUa;
  return !desktopLike;
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

export default function MyPostsPage() {
  usePageMeta('내가 쓴 글', 'app-page');

  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isExcel = theme === 'excel';
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState([]);
  const [boardNameMap, setBoardNameMap] = useState({});
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [postsCursor, setPostsCursor] = useState(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

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
  }, []);

  const loadMyPosts = useCallback(async (uid, options = {}) => {
    const append = options.append === true;
    const cursor = options.cursor || null;

    if (append) {
      setLoadingMorePosts(true);
    } else {
      setLoading(true);
    }
    if (!append) setMessage({ type: '', text: '' });

    try {
      const constraints = [
        where('authorUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(MY_POSTS_PAGE_SIZE)
      ];
      if (cursor) constraints.push(startAfter(cursor));

      const postSnap = await getDocs(query(collection(db, 'posts'), ...constraints));
      const items = postSnap.docs
        .map((row) => ({ id: row.id, ...row.data(), views: numberOrZero(row.data()?.views) }))
        .filter((post) => post.deleted !== true);

      const lastDoc = postSnap.docs.length ? postSnap.docs[postSnap.docs.length - 1] : null;
      setPostsCursor(lastDoc);
      setHasMorePosts(postSnap.docs.length === MY_POSTS_PAGE_SIZE);

      if (append) {
        setPosts((prev) => [...prev, ...items]);
        return;
      }

      setPosts(items);
      if (!items.length) {
        setMessage({ type: 'notice', text: '아직 작성한 게시글이 없습니다.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || '내 게시글 목록을 불러오지 못했습니다.' });
      if (!append) {
        setPosts([]);
        setPostsCursor(null);
        setHasMorePosts(false);
      }
    } finally {
      if (append) {
        setLoadingMorePosts(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

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
        await loadMyPosts(user.uid);
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
  }, [loadBoardNameMap, loadMyPosts, navigate]);

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

  const handleLoadMorePosts = useCallback(async () => {
    if (!currentUserId || !postsCursor || !hasMorePosts || loading || loadingMorePosts) return;
    await loadMyPosts(currentUserId, { append: true, cursor: postsCursor });
  }, [currentUserId, hasMorePosts, loadMyPosts, loading, loadingMorePosts, postsCursor]);

  const movePostDetail = useCallback((post) => {
    const postPage = MENTOR_FORUM_CONFIG.app.postPage || '/post';
    const boardId = normalizeText(post?.boardId);
    const qs = new URLSearchParams();
    qs.set('postId', String(post?.id || ''));
    if (boardId) {
      // Pass both boardId and fromBoardId so detail/back navigation can restore the original board context.
      qs.set('boardId', boardId);
      qs.set('fromBoardId', boardId);
    }

    navigate(`${postPage}?${qs.toString()}`, {
      state: {
        postBoardId: boardId || '',
        fromBoardId: boardId || ''
      }
    });
  }, [navigate]);

  const forumPage = MENTOR_FORUM_CONFIG.app.appPage;
  const myCommentsPage = MENTOR_FORUM_CONFIG.app.myCommentsPage || '/me/comments';
  const handleMoveHome = useCallback(() => {
    navigate(forumPage);
  }, [forumPage, navigate]);
  const handleBrandTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleMoveHome();
  }, [handleMoveHome]);

  const excelPosts = useMemo(() => {
    return posts.map((post, idx) => ({
      postId: post.id,
      boardId: post.boardId || '',
      no: posts.length - idx,
      title: post.title || '(제목 없음)',
      boardLabel: boardNameMap[post.boardId] || post.boardId || '-',
      dateText: formatDate(post.createdAt),
      views: numberOrZero(post.views)
    }));
  }, [boardNameMap, posts]);

  const excelPostsById = useMemo(() => {
    return new Map(posts.map((post) => [String(post.id), post]));
  }, [posts]);

  const excelSheetModel = useMemo(() => {
    return buildMyPostsExcelSheetModel({
      userDisplayName,
      userRoleLabel,
      posts: excelPosts,
      safeCurrentPage: 1,
      totalPageCount: 1,
      paginationPages: [1],
      emptyMessage: loading ? '불러오는 중...' : (message.text || '작성한 게시글이 없습니다.')
    });
  }, [excelPosts, loading, message.text, userDisplayName, userRoleLabel]);

  const isExcelDesktopMode = isExcel && !compactListMode;
  const [excelActiveCellLabel, setExcelActiveCellLabel] = useState('');
  const [excelFormulaText, setExcelFormulaText] = useState('=');
  const handleExcelSelectCell = useCallback((payload) => {
    const label = normalizeText(payload?.label);
    const text = String(payload?.text ?? '').trim();
    setExcelActiveCellLabel(label || '');
    setExcelFormulaText(text || '=');
  }, []);

  const handleExcelOpenPost = useCallback((postId) => {
    if (!postId) return;
    const post = excelPostsById.get(String(postId));
    if (!post) return;
    movePostDetail(post);
  }, [excelPostsById, movePostDetail]);

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${posts.length}건`}
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
          onOpenPost={handleExcelOpenPost}
          onNavigateMyPosts={() => navigate(MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts')}
          onNavigateMyComments={() => navigate(myCommentsPage)}
          onOpenGuide={handleOpenGuide}
          onToggleTheme={toggleTheme}
          onLogout={() => handleLogout().catch(() => {})}
          onMoveHome={handleMoveHome}
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
              멘토포럼
            </h1>
            <p className="hero-copy">멘토스끼리 자유롭게 소통 가능한 커뮤니티입니다!</p>
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
          <button type="button" className="btn-muted" onClick={() => navigate(myCommentsPage)}>
            <MessageSquare size={16} />
            내 댓글
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
              <button type="button" className="board-rail-profile-btn is-current" disabled>
                <FileText size={14} />
                내가 쓴 글
              </button>
              <button type="button" className="board-rail-profile-btn" onClick={() => navigate(myCommentsPage)}>
                <MessageSquare size={14} />
                내가 쓴 댓글
              </button>
            </div>
          </section>
        </aside>

        <section className="card my-activity-list-card">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><FileText size={18} /> 작성한 글 목록</h2>
            <span className="badge">{posts.length}건</span>
          </div>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table my-activity-table">
              <thead>
                <tr>
                  <th style={{ width: '72px' }}>번호</th>
                  <th>제목</th>
                  <th style={{ width: '180px' }}>게시판</th>
                  <th style={{ width: '160px' }}>작성일</th>
                  <th style={{ width: '96px' }}>조회</th>
                </tr>
              </thead>
              <tbody>
                {!ready || loading ? (
                  <tr>
                    <td colSpan={5} className="muted">불러오는 중...</td>
                  </tr>
                ) : posts.map((post, idx) => {
                  const no = posts.length - idx;
                  const boardLabel = boardNameMap[post.boardId] || post.boardId || '-';
                  return (
                    <tr key={post.id} className="my-activity-row" onClick={() => movePostDetail(post)}>
                      <td>{no}</td>
                      <td><span className="text-ellipsis-1" title={post.title || '(제목 없음)'}>{post.title || '(제목 없음)'}</span></td>
                      <td><span className="text-ellipsis-1" title={boardLabel}>{boardLabel}</span></td>
                      <td>{formatDate(post.createdAt)}</td>
                      <td>{numberOrZero(post.views)}</td>
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
                onClick={() => handleLoadMorePosts().catch(() => {})}
                disabled={!hasMorePosts || loadingMorePosts}
              >
                {loadingMorePosts ? '불러오는 중...' : (hasMorePosts ? '더보기' : '마지막 페이지')}
              </button>
            </div>
          ) : null}

          <div className="my-activity-mobile-list">
            {!ready || loading ? <p className="muted">불러오는 중...</p> : null}
            {ready && !loading && !posts.length ? <p className="muted">아직 작성한 게시글이 없습니다.</p> : null}
            {ready && !loading ? posts.map((post, idx) => {
              const no = posts.length - idx;
              const boardLabel = boardNameMap[post.boardId] || post.boardId || '-';
              return (
                <button
                  key={`mobile-post-${post.id}`}
                  type="button"
                  className="my-activity-mobile-item"
                  onClick={() => movePostDetail(post)}
                >
                  <div className="my-activity-mobile-top">
                    <span className="my-activity-mobile-no">#{no}</span>
                    <span className="my-activity-mobile-board text-ellipsis-1">{boardLabel}</span>
                  </div>
                  <p className="my-activity-mobile-title text-ellipsis-2">{post.title || '(제목 없음)'}</p>
                  <p className="my-activity-mobile-meta">{formatDate(post.createdAt)} · 조회 {numberOrZero(post.views)}</p>
                </button>
              );
            }) : null}
            {ready && !loading ? (
              <div className="row" style={{ marginTop: '10px', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn-muted"
                  onClick={() => handleLoadMorePosts().catch(() => {})}
                  disabled={!hasMorePosts || loadingMorePosts}
                >
                  {loadingMorePosts ? '불러오는 중...' : (hasMorePosts ? '더보기' : '마지막 페이지')}
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
