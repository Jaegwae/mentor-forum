// AppPage data-access orchestration.
// The controller uses this layer for async fetch/load routines so view-state logic
// stays separate from Firestore query composition.
import {
  listAllBoards,
  getBoardById,
  listBoardsByName,
  listBoardsByAllowedRole,
  listDividerBoards,
  upsertBoardById
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
  WORK_SCHEDULE_BOARD_ID,
  WORK_SCHEDULE_BOARD_NAME,
  WORK_SCHEDULE_BOARD_DESCRIPTION,
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
import {
  loadRoleDefinitionsWithFallback,
  readNormalizedUserProfile
} from '../../services/profile-bootstrap.js';
import { serverTimestamp } from '../../legacy/firebase-app.js';

function resolveWorkScheduleAllowedRoles(roleDefMap) {
  const fallback = ['Mentor', 'Staff', 'Admin', 'Super_Admin'];
  if (!(roleDefMap instanceof Map) || !roleDefMap.size) return fallback;

  const roles = [...roleDefMap.keys()]
    .map((roleKey) => normalizeText(roleKey))
    .filter((roleKey) => roleKey && roleKey !== 'Newbie');

  return roles.length ? roles : fallback;
}

function workScheduleFallbackBoard(roleDefMap) {
  return {
    id: WORK_SCHEDULE_BOARD_ID,
    isDivider: false,
    name: WORK_SCHEDULE_BOARD_NAME,
    description: WORK_SCHEDULE_BOARD_DESCRIPTION,
    allowedRoles: resolveWorkScheduleAllowedRoles(roleDefMap),
    sortOrder: 5
  };
}

export async function loadRoleDefinitions() {
  return loadRoleDefinitionsWithFallback(FALLBACK_ROLE_DEFINITIONS);
}

export async function ensureUserProfile(user, roleDefMap) {
  const result = await readNormalizedUserProfile(user, roleDefMap, normalizeRoleKey);
  return {
    ...result.profile,
    rawRole: result.updated.shouldNormalizeRole || result.updated.shouldSetVerified
      ? result.normalizedRole
      : result.rawRole
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

  const workScheduleBoardExists = rawItems.some((item) => normalizeText(item?.id) === WORK_SCHEDULE_BOARD_ID);
  const canViewWorkScheduleBoard = normalizedRole !== 'Newbie' && !isExplicitNewbieRole(normalizedRawRole);

  if (canViewWorkScheduleBoard && !workScheduleBoardExists) {
    const fallbackBoard = workScheduleFallbackBoard(roleDefMap);
    rawItems = [...rawItems, fallbackBoard];

    if (privileged) {
      try {
        await upsertBoardById(WORK_SCHEDULE_BOARD_ID, {
          isDivider: false,
          name: fallbackBoard.name,
          description: fallbackBoard.description,
          allowedRoles: fallbackBoard.allowedRoles,
          sortOrder: fallbackBoard.sortOrder,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (_) {
        // Keep UI fallback board even when bootstrap write fails.
      }
    }
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
