// PostPage async data bootstrap layer.
// Contains profile/role loading routines used by the controller before it opens
// realtime listeners and post-detail actions.
import { FALLBACK_ROLE_DEFINITIONS } from './constants.js';
import { normalizeRoleKey } from './utils.js';
import {
  loadRoleDefinitionsWithFallback,
  readNormalizedUserProfile
} from '../../services/profile-bootstrap.js';

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
