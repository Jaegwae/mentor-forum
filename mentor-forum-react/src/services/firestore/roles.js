/**
 * role_definitions 컬렉션 접근 헬퍼.
 * - 컨트롤러가 Firestore import를 직접 다루지 않도록 얇은 서비스 레이어를 제공한다.
 */
import { db, collection, getDocs } from '../../legacy/firebase-app.js';

function mapDocs(snap) {
  // Firestore DocumentSnapshot 배열을 plain object 배열로 정규화한다.
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Loads all role definition documents.
export async function listRoleDefinitionDocs() {
  const snap = await getDocs(collection(db, 'role_definitions'));
  return mapDocs(snap);
}
