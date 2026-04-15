// Shared My Activity helpers.
// - Houses the deduplicated presentation/data helpers reused by MyPostsPage and
//   MyCommentsPage after the first cleanup pass.
import React from 'react';
import { detectMobileLayoutMode } from '../../lib/mobile-layout.js';
import { listRoleDefinitionDocs } from '../../services/firestore/roles.js';
import { listAllBoards } from '../../services/firestore/boards.js';
import { AuthorWithRole, RoleBadge } from '../../components/ui/role-badge.jsx';
import {
  AUTO_LOGOUT_MESSAGE,
  FALLBACK_ROLE_DEFINITIONS
} from '../shared/forum-constants.js';

export const ACTIVITY_AUTO_LOGOUT_MESSAGE = AUTO_LOGOUT_MESSAGE;
export const ACTIVITY_FALLBACK_ROLE_DEFINITIONS = FALLBACK_ROLE_DEFINITIONS;

export function normalizeActivityText(value) {
  return String(value || '').trim();
}

export function formatActivityDate(value) {
  if (!value) return '-';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}. ${month}. ${day}. ${hours}:${minutes}`;
}

export function toActivityMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function detectActivityCompactListMode() {
  return detectMobileLayoutMode(false);
}

export function createRoleDefMap(roleDefinitions) {
  const map = new Map();
  (Array.isArray(roleDefinitions) ? roleDefinitions : []).forEach((item) => {
    const key = normalizeActivityText(item?.role);
    if (!key) return;
    map.set(key, item);
  });
  return map;
}

export function mergeRoleDefinitions(
  definitions,
  fallbackDefinitions = ACTIVITY_FALLBACK_ROLE_DEFINITIONS
) {
  const mergedByRole = new Map();

  (Array.isArray(fallbackDefinitions) ? fallbackDefinitions : []).forEach((item) => {
    const key = normalizeActivityText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  (Array.isArray(definitions) ? definitions : []).forEach((item) => {
    const key = normalizeActivityText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...(mergedByRole.get(key) || {}), ...item, role: key });
  });

  return [...mergedByRole.values()];
}

export async function loadActivityRoleDefinitions() {
  const definitions = (await listRoleDefinitionDocs()).map(({ id, ...data }) => ({
    role: id,
    ...data
  }));
  return mergeRoleDefinitions(definitions);
}

export async function loadBoardNameMap() {
  const boardNameMap = {};
  const boards = await listAllBoards();

  boards.forEach((board) => {
    if (board?.isDivider === true) return;
    boardNameMap[board.id] = board.name || board.id;
  });

  return boardNameMap;
}

export { RoleBadge, AuthorWithRole };
