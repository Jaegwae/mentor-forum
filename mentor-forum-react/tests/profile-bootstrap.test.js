// Profile bootstrap unit tests.
// - Covers the shared bootstrap layer that App/Post/Admin rely on for role
//   normalization and first-login user document creation.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  serverTimestampMock,
  listRoleDefinitionDocsMock,
  getUserProfileDocMock,
  setUserProfileDocMock,
  updateUserProfileDocMock
} = vi.hoisted(() => ({
  serverTimestampMock: vi.fn(() => 'SERVER_TS'),
  listRoleDefinitionDocsMock: vi.fn(),
  getUserProfileDocMock: vi.fn(),
  setUserProfileDocMock: vi.fn(),
  updateUserProfileDocMock: vi.fn()
}));

vi.mock('../src/legacy/firebase-app.js', () => ({
  serverTimestamp: serverTimestampMock
}));

vi.mock('../src/legacy/config.js', () => ({
  MENTOR_FORUM_CONFIG: {
    app: {
      defaultRole: 'Newbie'
    }
  }
}));

vi.mock('../src/services/firestore/roles.js', () => ({
  listRoleDefinitionDocs: listRoleDefinitionDocsMock
}));

vi.mock('../src/services/firestore/users.js', () => ({
  getUserProfileDoc: getUserProfileDocMock,
  setUserProfileDoc: setUserProfileDocMock,
  updateUserProfileDoc: updateUserProfileDocMock
}));

import {
  loadRoleDefinitionsWithFallback,
  mergeRoleDefinitions,
  readNormalizedUserProfile
} from '../src/services/profile-bootstrap.js';

describe('profile bootstrap service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges fallback role definitions with fetched docs', async () => {
    listRoleDefinitionDocsMock.mockResolvedValue([
      { id: 'Mentor', labelKo: '선임 멘토', badgeBgColor: '#123456' },
      { id: 'Custom', labelKo: '커스텀' }
    ]);

    const merged = await loadRoleDefinitionsWithFallback([
      { role: 'Mentor', labelKo: '멘토', badgeBgColor: '#ffffff', badgeTextColor: '#111111' },
      { role: 'Admin', labelKo: '관리자', badgeBgColor: '#eeeeee', badgeTextColor: '#222222' }
    ]);

    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'Mentor',
          labelKo: '선임 멘토',
          badgeBgColor: '#123456',
          badgeTextColor: '#111111'
        }),
        expect.objectContaining({ role: 'Admin', labelKo: '관리자' }),
        expect.objectContaining({ role: 'Custom', labelKo: '커스텀' })
      ])
    );
  });

  it('normalizes and syncs existing user profile when role/email verification changed', async () => {
    getUserProfileDocMock.mockResolvedValue({
      id: 'user-1',
      uid: 'user-1',
      role: 'mentor',
      emailVerified: false,
      nickname: 'tester'
    });

    const normalizeRoleKey = vi.fn(() => 'Mentor');
    const result = await readNormalizedUserProfile(
      { uid: 'user-1', emailVerified: true },
      new Map(),
      normalizeRoleKey
    );

    expect(normalizeRoleKey).toHaveBeenCalledWith('mentor', expect.any(Map));
    expect(updateUserProfileDocMock).toHaveBeenCalledWith('user-1', {
      updatedAt: 'SERVER_TS',
      role: 'Mentor',
      emailVerified: true
    });
    expect(result.profile).toMatchObject({
      uid: 'user-1',
      role: 'Mentor',
      emailVerified: true,
      nickname: 'tester'
    });
    expect(result.updated).toEqual({
      shouldNormalizeRole: true,
      shouldSetVerified: true
    });
  });

  it('creates a default user profile when none exists', async () => {
    getUserProfileDocMock.mockResolvedValue(null);

    const result = await readNormalizedUserProfile(
      { uid: 'user-2', email: 'new@example.com', displayName: 'New User', emailVerified: false },
      new Map(),
      (role) => role
    );

    expect(setUserProfileDocMock).toHaveBeenCalledWith('user-2', {
      uid: 'user-2',
      email: 'new@example.com',
      realName: 'New User',
      nickname: 'new',
      role: 'Newbie',
      emailVerified: false,
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS'
    });
    expect(result.profile).toMatchObject({
      uid: 'user-2',
      role: 'Newbie',
      nickname: 'new'
    });
  });

  it('can merge definitions directly without fetch', () => {
    const merged = mergeRoleDefinitions(
      [{ role: 'Mentor', labelKo: '선임 멘토' }],
      [{ role: 'Mentor', labelKo: '멘토' }, { role: 'Admin', labelKo: '관리자' }]
    );

    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'Mentor', labelKo: '선임 멘토' }),
        expect.objectContaining({ role: 'Admin', labelKo: '관리자' })
      ])
    );
  });
});
