// Shared profile/role bootstrap helpers.
// - Normalizes role-definition fallback loading and "ensure my user profile
//   exists" behavior used by App/Post/Admin entrypoints.
import { serverTimestamp } from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { listRoleDefinitionDocs } from './firestore/roles.js';
import { getUserProfileDoc, setUserProfileDoc, updateUserProfileDoc } from './firestore/users.js';

function normalizeText(value) {
  return String(value || '').trim();
}

export function mergeRoleDefinitions(definitions, fallbackDefinitions = []) {
  const mergedByRole = new Map();

  (Array.isArray(fallbackDefinitions) ? fallbackDefinitions : []).forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  (Array.isArray(definitions) ? definitions : []).forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...(mergedByRole.get(key) || {}), ...item, role: key });
  });

  return [...mergedByRole.values()];
}

export async function loadRoleDefinitionsWithFallback(fallbackDefinitions = []) {
  const definitions = (await listRoleDefinitionDocs()).map(({ id, ...data }) => ({
    role: id,
    ...data
  }));
  return mergeRoleDefinitions(definitions, fallbackDefinitions);
}

function buildDefaultUserProfile(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    realName: user.displayName || '',
    nickname: user.email ? user.email.split('@')[0] : 'new-user',
    role: MENTOR_FORUM_CONFIG.app.defaultRole,
    emailVerified: !!user.emailVerified,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

export async function readNormalizedUserProfile(
  user,
  roleDefMap,
  normalizeRoleKey,
  options = {}
) {
  const syncNormalizedRole = options.syncNormalizedRole !== false;
  const normalizeRole = typeof normalizeRoleKey === 'function'
    ? normalizeRoleKey
    : ((value) => normalizeText(value));

  const docData = await getUserProfileDoc(user.uid);

  if (docData) {
    const { id: _id, ...profile } = docData;
    const rawRoleExact = String(profile.role ?? '');
    const rawRole = normalizeText(rawRoleExact);
    const normalizedRole = normalizeRole(rawRole, roleDefMap);
    const shouldNormalizeRole = syncNormalizedRole && !!normalizedRole && rawRoleExact !== normalizedRole;
    const shouldSetVerified = !!user.emailVerified && !profile.emailVerified;

    if (shouldNormalizeRole || shouldSetVerified) {
      const patch = { updatedAt: serverTimestamp() };
      if (shouldNormalizeRole) patch.role = normalizedRole;
      if (shouldSetVerified) patch.emailVerified = true;
      await updateUserProfileDoc(user.uid, patch);
    }

    return {
      existed: true,
      rawRole,
      normalizedRole,
      profile: {
        ...profile,
        ...(shouldSetVerified ? { emailVerified: true } : {}),
        role: normalizedRole
      },
      updated: {
        shouldNormalizeRole,
        shouldSetVerified
      }
    };
  }

  const profile = buildDefaultUserProfile(user);
  await setUserProfileDoc(user.uid, profile);

  return {
    existed: false,
    rawRole: normalizeText(profile.role),
    normalizedRole: normalizeRole(profile.role, roleDefMap),
    profile: {
      ...profile,
      role: normalizeRole(profile.role, roleDefMap)
    },
    updated: {
      shouldNormalizeRole: false,
      shouldSetVerified: false
    }
  };
}
