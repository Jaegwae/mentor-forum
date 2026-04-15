// AdminPage data bootstrap layer.
// Responsible for loading role definitions and ensuring normalized user profile
// state before admin workflows begin.
import { coreRoleDefaults } from './constants.js';
import { normalizeRoleKey } from './utils.js';
import {
  loadRoleDefinitionsWithFallback,
  readNormalizedUserProfile
} from '../../services/profile-bootstrap.js';

export async function loadRoleDefinitionsFromDb() {
  return loadRoleDefinitionsWithFallback(coreRoleDefaults);
}

export async function ensureUserProfile(user, roleDefMap) {
  const result = await readNormalizedUserProfile(user, roleDefMap, normalizeRoleKey, {
    syncNormalizedRole: false
  });
  return {
    ...result.profile,
    rawRole: result.rawRole
  };
}
