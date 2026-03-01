// AdminPage data bootstrap layer.
// Responsible for loading role definitions and ensuring normalized user profile
// state before admin workflows begin.
import {
  serverTimestamp,
} from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import { listRoleDefinitionDocs } from '../../services/firestore/roles.js';
import { getUserProfileDoc, setUserProfileDoc, updateUserProfileDoc } from '../../services/firestore/users.js';
import { coreRoleDefaults } from './constants.js';
import { normalizeText, normalizeRoleKey } from './utils.js';

export async function loadRoleDefinitionsFromDb() {
  const docs = (await listRoleDefinitionDocs()).map(({ id, ...data }) => ({ role: id, ...data }));
  const mergedByRole = new Map();

  coreRoleDefaults.forEach((item) => {
    const key = normalizeText(item?.role);
    if (!key) return;
    mergedByRole.set(key, { ...item, role: key });
  });

  docs.forEach((item) => {
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
    const normalizedRole = normalizeRoleKey(profile.role, roleDefMap);

    if (!!user.emailVerified && !profile.emailVerified) {
      await updateUserProfileDoc(user.uid, {
        emailVerified: true,
        updatedAt: serverTimestamp()
      });
      return { ...profile, role: normalizedRole, emailVerified: true };
    }

    return { ...profile, role: normalizedRole };
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
  return { ...profile, role: normalizeRoleKey(profile.role, roleDefMap) };
}
