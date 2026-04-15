// Shared My Activity helper tests.
// - Locks the extracted helpers so future cleanup does not silently break role
//   merging or compact list behavior in MyPosts/MyComments pages.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FALLBACK_ROLE_DEFINITIONS,
  createRoleDefMap,
  formatActivityDate,
  mergeRoleDefinitions
} from '../src/pages/my-activity/shared.jsx';

describe('my activity shared helpers', () => {
  it('merges fetched role definitions on top of fallback defaults', () => {
    const merged = mergeRoleDefinitions([
      { role: 'Mentor', labelKo: '선임 멘토', badgeBgColor: '#123456' },
      { role: 'Custom', labelKo: '커스텀', badgeBgColor: '#abcdef', badgeTextColor: '#111111' }
    ]);

    const roleMap = createRoleDefMap(merged);
    expect(roleMap.get('Mentor')).toMatchObject({
      role: 'Mentor',
      labelKo: '선임 멘토',
      badgeBgColor: '#123456',
      badgeTextColor: ACTIVITY_FALLBACK_ROLE_DEFINITIONS.find((item) => item.role === 'Mentor')?.badgeTextColor
    });
    expect(roleMap.get('Custom')).toMatchObject({
      role: 'Custom',
      labelKo: '커스텀',
      badgeBgColor: '#abcdef',
      badgeTextColor: '#111111'
    });
    expect(roleMap.get('Newbie')).toBeTruthy();
  });

  it('formats activity timestamps consistently', () => {
    const localDate = new Date(2026, 2, 2, 4, 5, 0, 0);
    expect(formatActivityDate(localDate)).toBe('2026. 3. 2. 04:05');
    expect(formatActivityDate(null)).toBe('-');
    expect(formatActivityDate('invalid-date')).toBe('-');
  });
});
