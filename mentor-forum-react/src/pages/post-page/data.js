// PostPage async data bootstrap layer.
// Contains profile/role loading routines used by the controller before it opens
// realtime listeners and post-detail actions.
import { serverTimestamp } from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { listRoleDefinitionDocs } from '../../services/firestore/roles.js';
import { getUserProfileDoc, setUserProfileDoc, updateUserProfileDoc } from '../../services/firestore/users.js';
import { FALLBACK_ROLE_DEFINITIONS } from './constants.js';
import { normalizeText, normalizeRoleKey } from './utils.js';

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
