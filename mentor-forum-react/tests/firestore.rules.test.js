// @vitest-environment node

/**
 * Firestore rules 계약 테스트.
 * - 에뮬레이터가 켜진 경우에만 실행한다.
 * - 핵심 시나리오(게시글 생성/권한 없는 수정/자기 권한 승격/알림 actor spoofing)를 검증한다.
 */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  setDoc,
  updateDoc
} from 'firebase/firestore';

let testEnv;
const emulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();
const hasFirestoreEmulator = emulatorHost.length > 0;

async function seedBaseData() {
  // 규칙 평가 전 공통 fixture를 rules-disabled 컨텍스트로 주입한다.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromDate(new Date('2026-03-01T00:00:00.000Z'));

    await setDoc(doc(db, 'users', 'mentor-user'), {
      uid: 'mentor-user',
      email: 'mentor@example.com',
      role: 'Mentor',
      nickname: 'mentor',
      realName: 'Mentor User',
      emailVerified: true,
      createdAt: now,
      updatedAt: now
    });

    await setDoc(doc(db, 'users', 'newbie-user'), {
      uid: 'newbie-user',
      email: 'newbie@example.com',
      role: 'Newbie',
      nickname: 'newbie',
      realName: 'Newbie User',
      emailVerified: true,
      createdAt: now,
      updatedAt: now
    });

    await setDoc(doc(db, 'users', 'outsider-user'), {
      uid: 'outsider-user',
      email: 'outsider@example.com',
      role: 'Mentor',
      nickname: 'outsider',
      realName: 'Outsider User',
      emailVerified: true,
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
      updatedAt: now
    });
  });
}

beforeAll(async () => {
  if (!hasFirestoreEmulator) return;
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const [host, portText] = emulatorHost.split(':');
  const port = Number(portText || 8080);
  testEnv = await initializeTestEnvironment({
    projectId: `mentor-forum-rules-${randomUUID()}`,
    firestore: { host, port, rules }
  });
});

beforeEach(async () => {
  if (!hasFirestoreEmulator) return;
  await testEnv.clearFirestore();
  await seedBaseData();
});

afterAll(async () => {
  if (!testEnv) return;
  await testEnv.cleanup();
});

(hasFirestoreEmulator ? describe : describe.skip)('firestore rules contract', () => {
  it('allows mentor to create a post on accessible board', async () => {
    const mentorDb = testEnv.authenticatedContext('mentor-user').firestore();

    await assertSucceeds(addDoc(collection(mentorDb, 'posts'), {
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
      views: 0
    }));
  });

  it('denies post update from non-author non-moderator user', async () => {
    const outsiderDb = testEnv.authenticatedContext('outsider-user').firestore();
    await assertFails(updateDoc(doc(outsiderDb, 'posts', 'existing-post'), {
      title: 'tamper-attempt',
      updatedAt: Timestamp.now()
    }));
  });

  it('denies self role escalation from Mentor to Admin', async () => {
    const mentorDb = testEnv.authenticatedContext('mentor-user').firestore();
    await assertFails(updateDoc(doc(mentorDb, 'users', 'mentor-user'), {
      role: 'Admin',
      updatedAt: Timestamp.now()
    }));
  });

  it('allows actor notification write but denies actor spoofing', async () => {
    const mentorDb = testEnv.authenticatedContext('mentor-user').firestore();

    const notificationPayload = {
      userUid: 'newbie-user',
      postId: 'existing-post',
      boardId: 'cover_for',
      boardName: '대체근무',
      title: 'mention',
      actorUid: 'mentor-user',
      actorName: 'mentor',
      type: 'mention',
      subtype: 'mention',
      commentId: '',
      body: 'hello',
      createdAtMs: Date.now(),
      readAtMs: 0
    };

    await assertSucceeds(setDoc(
      doc(mentorDb, 'users', 'newbie-user', 'notifications', 'notif-ok'),
      notificationPayload
    ));

    await assertFails(setDoc(
      doc(mentorDb, 'users', 'newbie-user', 'notifications', 'notif-deny'),
      { ...notificationPayload, actorUid: 'someone-else' }
    ));
  });
});
