// Controller wiring regression guard.
// - These tests assert for critical strings in the controller source so missing
//   utility/constants/hook arguments are caught quickly after large refactors.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('controller wiring regression', () => {
  it('keeps critical AppPage hook wiring intact', () => {
    const source = readSource('src/pages/app-page/useAppPageController.js');

    expect(source).toContain('const canUseBoard = useCallback((board) => {');
    expect(source).toContain('} = useAppBoardFeed({');
    expect(source).toContain('isAdminOrSuper,');
    expect(source).toContain('postsLoadRequestRef,');
    expect(source).toContain('canUseBoard,');

    expect(source).toContain('} = useAppComposerMentions({');
    expect(source).toContain('currentUserUid,');
    expect(source).toContain('setComposerMentionMenu,');

    expect(source).toContain('} = useAppComposerActions({');
    expect(source).toContain('showAppliedPopup,');
    expect(source).toContain('loadPostsForCurrentBoard,');

    expect(source).toContain('useAppNotificationSync({');
    expect(source).toContain('currentUserUid,');
    expect(source).toContain('notificationPrefs,');
    expect(source).toContain('setNotifications,');

    const editorEffectStart = source.indexOf('const editor = createRichEditor({');
    expect(editorEffectStart).toBeGreaterThan(-1);
    const editorEffectEnd = source.indexOf('}, [closeComposerMentionMenu, composerOpen, setComposerMessage, syncComposerMentionMenu]);', editorEffectStart);
    expect(editorEffectEnd).toBeGreaterThan(editorEffectStart);
    const editorEffectSource = source.slice(editorEffectStart - 180, editorEffectEnd + 120);
    expect(editorEffectSource).toContain('!composerOpen || !editorElRef.current || !fontSizeLabelRef.current');
    expect(editorEffectSource).toContain('editorRef.current = editor;');
  });

  it('keeps critical PostPage hook wiring intact', () => {
    const source = readSource('src/pages/post-page/usePostPageController.jsx');

    [
      'ALL_BOARD_ID',
      'COVER_FOR_BOARD_ID',
      'AUTO_LOGOUT_MESSAGE',
      'NOTIFICATION_TYPE',
      'MENTION_ALL_TOKEN',
      'MENTION_MENU_INITIAL',
      'NOTIFICATION_SUBTYPE'
    ].forEach((token) => expect(source).toContain(token));

    [
      'detectCompactListMode',
      'createRoleDefMap',
      'normalizeErrMessage',
      'logErrorWithOptionalDebug',
      'boardAccessDebugText',
      'readLastBoardId',
      'writeLastBoardId',
      'normalizeDateKeyInput',
      'plainRichPayload',
      'normalizeRoleKey',
      'isExplicitNewbieRole',
      'normalizeNickname',
      'buildNicknameKey',
      'extractMentionNicknames',
      'hasAllMentionCommand',
      'detectMentionContext',
      'normalizeNotificationType',
      'notificationIdForEvent',
      'toNotificationBodySnippet',
      'coverForDateEntriesFromPost',
      'summarizeCoverForDateEntries',
      'stripHtmlToText',
      'roleMatchCandidates',
      'isPrivilegedBoardRole',
      'isNoticeBoardData',
      'isDeletedPost'
    ].forEach((token) => expect(source).toContain(token));

    expect(source).toContain('} = usePostNotifications({');
    expect(source).toContain('MENTION_ALL_TOKEN,');
    expect(source).toContain('NOTIFICATION_TYPE,');
    expect(source).toContain('NOTIFICATION_SUBTYPE,');
    expect(source).toContain('isAdminOrSuper,');

    expect(source).toContain('} = usePostCommentMentions({');
    expect(source).toContain('commentMentionMenu,');
    expect(source).toContain('commentMentionCandidates,');
    expect(source).toContain('commentMentionActiveIndex,');
    expect(source).toContain('currentUserUid,');
    expect(source).toContain('MENTION_MAX_ITEMS,');
    expect(source).toContain('MENTION_MENU_ESTIMATED_WIDTH,');
  });

  it('keeps critical AdminPage utility/constants wiring intact', () => {
    const source = readSource('src/pages/admin-page/useAdminPageController.jsx');

    [
      'DEFAULT_VENUE_LABELS',
      'WORK_SCHEDULE_BOARD_ID',
      'WORK_SCHEDULE_BOARD_NAME',
      'WORK_SCHEDULE_BOARD_DESCRIPTION',
      'coreRoleDefaults',
      'roleFlagDefs',
      'legacyRoleVisibilityCleanup'
    ].forEach((token) => expect(source).toContain(token));

    [
      'detectCompactListMode',
      'normalizeText',
      'sanitizeRoleKey',
      'normalizeRoles',
      'normalizeRoleKey',
      'normalizeNickname',
      'buildNicknameKey',
      'normalizeVenueLabel',
      'sortVenueOptions',
      'timestampToMs',
      'isCoreRole',
      'roleDeleteLockedForAdmin',
      'formatTemporaryLoginRemaining',
      'createRoleDefMap',
      'roleLevelWithDefinitions',
      'isDividerItem',
      'dividerLabel',
      'boardSortValue',
      'sortBoardItems',
      'sortUsersForManage',
      'initRoleFlags',
      'buildRoleFlagsFromDoc',
      'buildManageState',
      'roleSummaryText',
      'normalizeErrMessage',
      'sortRolesForManage',
      'shouldLogDebugPayload',
      'isPermissionDeniedError',
      'joinDebugParts',
      'debugCodePoints',
      'debugValueList'
    ].forEach((token) => expect(source).toContain(token));
  });
});
