// User page that lists authored comments.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, LogOut, MessageSquare } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
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
  getDocs
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { getRoleBadgePalette } from '../legacy/rbac.js';

const AUTO_LOGOUT_MESSAGE = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다.';
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
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState([]);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [roleDefinitions, setRoleDefinitions] = useState([]);

  const roleDefMap = useMemo(() => createRoleDefMap(roleDefinitions), [roleDefinitions]);
  const userDisplayName = currentUserProfile
    ? (currentUserProfile.nickname || currentUserProfile.realName || currentUserProfile.email || '사용자')
    : '사용자';

  const loadMyComments = useCallback(async (uid) => {
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const [boardSnap, commentSnap] = await Promise.all([
        getDocs(collection(db, 'boards')),
        getDocs(query(collectionGroup(db, 'comments'), where('authorUid', '==', uid)))
      ]);

      const boardNameMap = {};
      boardSnap.docs.forEach((row) => {
        const data = row.data() || {};
        if (data.isDivider === true) return;
        boardNameMap[row.id] = data.name || row.id;
      });

      const commentRows = commentSnap.docs.map((row) => {
        const data = row.data() || {};
        const path = row.ref?.path || '';
        return {
          id: row.id,
          ...data,
          postId: postIdFromCommentPath(path)
        };
      });

      const postIdSet = new Set(commentRows.map((row) => row.postId).filter(Boolean));
      const postEntries = await Promise.all(
        Array.from(postIdSet).map(async (postId) => {
          try {
            const snap = await getDoc(doc(db, 'posts', postId));
            if (!snap.exists()) return [postId, null];
            return [postId, { id: snap.id, ...snap.data() }];
          } catch (_) {
            return [postId, null];
          }
        })
      );
      const postMap = new Map(postEntries);

      const merged = commentRows
        .map((row) => {
          const post = postMap.get(row.postId);
          const boardId = normalizeText(post?.boardId);
          return {
            ...row,
            postId: row.postId,
            boardId,
            boardName: boardNameMap[boardId] || boardId || '-',
            postTitle: normalizeText(post?.title) || '(게시글 정보 없음)',
            postExists: !!post,
            postDeleted: !!post?.deleted
          };
        })
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      setComments(merged);
      if (!merged.length) {
        setMessage({ type: 'notice', text: '아직 작성한 댓글이 없습니다.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err?.message || '내 댓글 목록을 불러오지 못했습니다.' });
      setComments([]);
    } finally {
      setLoading(false);
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
  }, [loadMyComments, navigate]);

  const handleLogout = useCallback(async () => {
    clearTemporaryLoginExpiry();
    await signOut(auth);
    navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
  }, [navigate]);

  const moveCommentPost = useCallback((comment) => {
    if (!comment?.postExists || !comment?.postId) {
      alert('원본 게시글 정보를 찾을 수 없습니다.');
      return;
    }

    const postPage = MENTOR_FORUM_CONFIG.app.postPage || '/post';
    const qs = new URLSearchParams();
    qs.set('postId', String(comment.postId));
    if (comment.boardId) {
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

  return (
    <motion.main
      className="page stack my-activity-shell"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      <section className="card hero-card my-activity-hero">
        <div className="row space-between mobile-col">
          <div>
            <p className="hero-kicker"><MessageSquare size={15} /> My Activity</p>
            <h1>내가 쓴 댓글</h1>
            <p className="hero-copy">댓글을 누르면 해당 게시글로 이동하고 내 댓글 위치로 스크롤됩니다.</p>
          </div>
          <div className="row top-action-row">
            <button type="button" className="btn-muted" onClick={() => navigate(MENTOR_FORUM_CONFIG.app.appPage)}>
              <ArrowLeft size={16} />
              포럼으로
            </button>
            <button type="button" className="btn-muted" onClick={() => navigate(MENTOR_FORUM_CONFIG.app.myPostsPage || '/me/posts')}>
              <FileText size={16} />
              내 게시글
            </button>
            <ThemeToggle />
            <button type="button" className="btn-muted" onClick={() => handleLogout().catch(() => {})}>
              <LogOut size={16} />
              로그아웃
            </button>
          </div>
        </div>

        <div className="notice" style={{ marginTop: '12px' }}>
          계정: <AuthorWithRole name={userDisplayName} role={currentUserProfile?.role} roleDefMap={roleDefMap} />
        </div>

        <div className={message.text ? (message.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '10px' }}>
          {message.text}
        </div>
      </section>

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

        <div className="my-activity-mobile-list">
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
        </div>
      </section>
    </motion.main>
  );
}
