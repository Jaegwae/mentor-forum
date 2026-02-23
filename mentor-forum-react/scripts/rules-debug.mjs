import fs from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, setDoc, Timestamp } from 'firebase/firestore';

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const projectId = 'demo-rules-debug';

  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const now = Timestamp.fromDate(new Date('2026-02-21T12:00:00.000Z'));

      await setDoc(doc(db, 'users', 'mentor-user'), {
        uid: 'mentor-user',
        email: 'mentor@example.com',
        role: 'Mentor',
        nickname: 'mentor',
        realName: 'Mentor User',
        createdAt: now,
        updatedAt: now
      });

      await setDoc(doc(db, 'boards', 'cover_for'), {
        name: '대체근무',
        isDivider: false,
        allowedRoles: ['Admin', 'Mentor', 'Staff', 'Super_Admin'],
        createdAt: now,
        updatedAt: now
      });

      await setDoc(doc(db, 'boards', 'general_board'), {
        name: '일반',
        isDivider: false,
        allowedRoles: ['Admin', 'Mentor', 'Staff', 'Super_Admin'],
        createdAt: now,
        updatedAt: now
      });

      await setDoc(doc(db, 'posts', 'existing-post'), {
        boardId: 'cover_for',
        title: 'existing',
        visibility: 'mentor',
        contentText: 'seed',
        contentRich: { text: 'seed', runs: [] },
        contentDelta: { ops: [{ insert: 'seed\n' }] },
        authorUid: 'mentor-user',
        authorName: 'mentor',
        authorRole: 'Mentor',
        deleted: false,
        views: 0,
        createdAt: now,
        updatedAt: now,
        coverForStatus: 'seeking',
        coverForDateKeys: ['2026-02-22'],
        coverForDateStatuses: ['seeking'],
        coverForStartTimeValues: ['09:00'],
        coverForEndTimeValues: ['18:00'],
        coverForTimeValues: ['09:00']
      });
    });

    const mentorDb = testEnv.authenticatedContext('mentor-user').firestore();

    const postPayloadCover = {
      boardId: 'cover_for',
      title: 'cover create',
      visibility: 'mentor',
      contentText: 'test',
      contentRich: { text: 'test', runs: [] },
      contentDelta: { ops: [{ insert: 'test\n' }] },
      authorUid: 'mentor-user',
      authorName: 'mentor',
      authorRole: 'Mentor',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      deleted: false,
      views: 0,
      coverForStatus: 'seeking',
      coverForDateKeys: ['2026-02-22'],
      coverForDateStatuses: ['seeking'],
      coverForStartTimeValues: ['09:00'],
      coverForEndTimeValues: ['18:00'],
      coverForTimeValues: ['09:00']
    };

    const postPayloadGeneral = {
      boardId: 'general_board',
      title: 'general create',
      visibility: 'mentor',
      contentText: 'general',
      contentRich: { text: 'general', runs: [] },
      contentDelta: { ops: [{ insert: 'general\n' }] },
      authorUid: 'mentor-user',
      authorName: 'mentor',
      authorRole: 'Mentor',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      deleted: false,
      views: 0
    };

    try {
      await addDoc(collection(mentorDb, 'posts'), postPayloadCover);
      console.log('RESULT post-cover: ALLOW');
    } catch (err) {
      console.log('RESULT post-cover: DENY', err?.code || err?.message || err);
    }

    try {
      await addDoc(collection(mentorDb, 'posts'), postPayloadGeneral);
      console.log('RESULT post-general: ALLOW');
    } catch (err) {
      console.log('RESULT post-general: DENY', err?.code || err?.message || err);
    }

    try {
      await addDoc(collection(mentorDb, 'posts', 'existing-post', 'comments'), {
        parentId: null,
        depth: 0,
        replyToAuthorName: '',
        contentDelta: { ops: [{ insert: 'reply\n' }] },
        contentRich: { text: 'reply', runs: [] },
        contentText: 'reply',
        authorUid: 'mentor-user',
        authorName: 'mentor',
        authorRole: 'Mentor',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      console.log('RESULT comment-cover: ALLOW');
    } catch (err) {
      console.log('RESULT comment-cover: DENY', err?.code || err?.message || err);
    }
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((err) => {
  console.error('RULES-DEBUG-FAILED', err);
  process.exitCode = 1;
});

