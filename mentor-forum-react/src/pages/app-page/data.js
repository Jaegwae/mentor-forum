// AppPage data-access orchestration.
// The controller uses this layer for async fetch/load routines so view-state logic
// stays separate from Firestore query composition.
import { serverTimestamp } from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { listRoleDefinitionDocs } from '../../services/firestore/roles.js';
import { getUserProfileDoc, setUserProfileDoc, updateUserProfileDoc } from '../../services/firestore/users.js';
import {
  listAllBoards,
  getBoardById,
  listBoardsByName,
  listBoardsByAllowedRole,
  listDividerBoards
} from '../../services/firestore/boards.js';
import {
  listPinnedPostsByBoard,
  listPostsByBoardCreatedDesc,
  listPostsByBoard,
  listRecentPostsCreatedDesc,
  listRecentPosts
} from '../../services/firestore/posts.js';
import { countCommentsByPost } from '../../services/firestore/comments.js';
import {
  FALLBACK_ROLE_DEFINITIONS,
  NOTICE_BOARD_ID,
  PINNED_POST_FETCH_LIMIT,
  POST_LIST_VIEW_MODE
} from './constants.js';
import {
  normalizeText,
  normalizeRoleKey,
  isPrivilegedBoardRole,
  isExplicitNewbieRole,
  roleMatchCandidates,
  sortBoardNavItems,
  numberOrZero,
  mergePostsByCreatedAtDesc,
  isPinnedPost,
  boardIdentityCandidates,
  postBoardIdentityCandidates,
  normalizeBoardIdentity,
  comparePostsWithPinnedPriority
} from './utils.js';

export async function loadRoleDefinitions() {
  const definitions = (await listRoleDefinitionDocs()).map(({ id, ...data }) => ({ role: id, ...data }));
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

export async function ensureUserProfile(user, roleDefMap) {
  const docData = await getUserProfileDoc(user.uid);

  if (docData) {
    const { id: _id, ...profile } = docData;
    const rawRoleExact = String(profile.role ?? '');
    const rawRole = normalizeText(rawRoleExact);
    const normalizedRole = normalizeRoleKey(rawRole, roleDefMap);
    const shouldNormalizeRole = !!normalizedRole && rawRoleExact !== normalizedRole;
    const shouldSetVerified = !!user.emailVerified && !profile.emailVerified;
    if (shouldNormalizeRole || shouldSetVerified) {
      const patch = { updatedAt: serverTimestamp() };
      if (shouldNormalizeRole) patch.role = normalizedRole;
      if (shouldSetVerified) patch.emailVerified = true;
      await updateUserProfileDoc(user.uid, patch);
      return {
        ...profile,
        ...(shouldSetVerified ? { emailVerified: true } : {}),
        role: normalizedRole,
        rawRole: normalizedRole
      };
    }
    return { ...profile, role: normalizedRole, rawRole };
  }

  const profile = {
    uid: user.uid,
    email: user.email || '',
    realName: user.displayName || '',
    nickname: user.email ? user.email.split('@')[0] : 'new-user',
    role: MENTOR_FORUM_CONFIG.app.defaultRole,
    emailVerified: !!user.emailVerified,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setUserProfileDoc(user.uid, profile);
  return {
    ...profile,
    role: normalizeRoleKey(profile.role, roleDefMap),
    rawRole: normalizeText(profile.role)
  };
}

export async function loadBoards(roleKey, roleDefMap = null, rawRole = '') {
  const normalizedRole = normalizeText(roleKey);
  const normalizedRawRole = normalizeText(rawRole);
  const privileged = isPrivilegedBoardRole(normalizedRole);
  let rawItems = [];

  if (privileged) {
    rawItems = await listAllBoards();
  } else if (normalizedRole === 'Newbie' && isExplicitNewbieRole(normalizedRawRole)) {
    const noticeById = await getBoardById(NOTICE_BOARD_ID);
    if (noticeById) {
      rawItems = [noticeById];
    } else {
      rawItems = await listBoardsByName('공지사항', 1);
    }
  } else {
    const roleCandidates = [
      ...roleMatchCandidates(normalizedRole, roleDefMap),
      ...(
        normalizedRole === 'Newbie' && !isExplicitNewbieRole(normalizedRawRole)
          ? roleMatchCandidates(normalizedRawRole, roleDefMap)
          : []
      )
    ];
    const uniqueRoleCandidates = [...new Set(roleCandidates.filter(Boolean))];
    const boardQueries = uniqueRoleCandidates.length
      ? uniqueRoleCandidates.map((candidateRole) => listBoardsByAllowedRole(candidateRole))
      : [];

    const [boardSnapshots, dividerRows] = await Promise.all([
      Promise.all(boardQueries),
      listDividerBoards()
    ]);

    const byId = new Map();
    boardSnapshots.forEach((rows) => {
      rows.forEach((row) => byId.set(row.id, row));
    });
    dividerRows.forEach((row) => byId.set(row.id, row));
    rawItems = Array.from(byId.values());
  }

  return sortBoardNavItems(rawItems);
}

export async function queryPostsForBoard(boardId, maxCount = 50, options = {}) {
  const {
    allowLooseFallback = false,
    boardName = ''
  } = options || {};
  const mapRows = (rows) => rows.map((row) => ({ ...row, views: numberOrZero(row.views) }));
  let pinnedPosts = [];
  const sortAndLimit = (posts) => mergePostsByCreatedAtDesc([posts, pinnedPosts], maxCount);
  let strictPosts = [];

  try {
    pinnedPosts = mapRows(await listPinnedPostsByBoard(boardId, Math.max(PINNED_POST_FETCH_LIMIT, maxCount)));
  } catch (err) {
    const code = String(err?.code || '');
    if (code.includes('failed-precondition')) {
      try {
        pinnedPosts = mapRows(await listPostsByBoard(boardId)).filter((post) => isPinnedPost(post));
      } catch (_) {
        pinnedPosts = [];
      }
    } else {
      pinnedPosts = [];
    }
  }

  try {
    strictPosts = mapRows(await listPostsByBoardCreatedDesc(boardId, maxCount));
  } catch (err) {
    const code = String(err?.code || '');
    if (!code.includes('failed-precondition')) throw err;

    strictPosts = mapRows(await listPostsByBoard(boardId));
  }

  if (strictPosts.length || !allowLooseFallback) {
    return sortAndLimit(strictPosts);
  }

  const looseLimit = Math.min(Math.max((Number(maxCount) || 50) * 8, 160), 600);
  let looseSnap;

  try {
    looseSnap = await listRecentPostsCreatedDesc(looseLimit);
  } catch (err) {
    const code = String(err?.code || '');
    if (!code.includes('failed-precondition')) throw err;
    looseSnap = await listRecentPosts(looseLimit);
  }

  const targetCandidates = boardIdentityCandidates(boardId, boardName);
  const targetRawSet = new Set(targetCandidates.map((item) => normalizeText(item)).filter(Boolean));
  const targetNormalizedSet = new Set(targetCandidates.map((item) => normalizeBoardIdentity(item)).filter(Boolean));

  const loosePosts = mapRows(looseSnap).filter((post) => {
    const postCandidates = postBoardIdentityCandidates(post);
    return postCandidates.some((candidate) => (
      targetRawSet.has(normalizeText(candidate))
      || targetNormalizedSet.has(normalizeBoardIdentity(candidate))
    ));
  });

  return sortAndLimit(loosePosts);
}

export async function fetchCommentCount(postId) {
  try {
    return await countCommentsByPost(postId);
  } catch (_) {
    return 0;
  }
}
