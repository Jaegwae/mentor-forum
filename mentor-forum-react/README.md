# Mentor Forum React

멘토포럼의 **실서비스용 React + Firebase 앱**입니다.

- 운영 URL: [https://guro-mentor-forum.web.app](https://guro-mentor-forum.web.app)
- Firebase 프로젝트: `guro-mentor-forum`
- 라우트 베이스: `/app`, `/post`, `/admin`, `/me/posts`, `/me/comments`

---

## 1. 핵심 기능

### 1) 인증/권한
- Firebase Auth 로그인/회원가입/이메일 인증
- 역할(Role) 기반 접근 제어 (`Newbie`, `Mentor`, `Staff`, `Admin`, `Super_Admin`)
- 관리자 페이지 접근/작업 권한 분리

### 2) 게시판/게시글
- 게시판 선택 + URL 동기화(`?boardId=...`)
- 게시글 목록 정렬(`최신`, `인기`)
- 게시글 상세, 댓글, 멘션
- 고정글(핀) 처리 및 상태 배지

### 3) 알림
- 알림센터(필터/읽음 처리/게시판별 on/off)
- 멘션 알림(`@닉네임`, `@all` 관리 전용)
- 모바일 푸시(FCM) + GAS 릴레이 전송

### 4) 테마
- 데스크톱: `라이트 → 다크 → 엑셀` 순환
- 모바일/인증 화면: `라이트 ↔ 다크` 제한
- 테마 저장(localStorage) + 다중 탭 동기화

### 5) 엑셀 모드
- 공통 엑셀 크롬(`통합 문서1` 제목바, 리본, 수식바, 시트 탭, 상태바)
- `/app` 엑셀 모드: **Jspreadsheet CE** 기반 셀 인터랙션 UI
- 셀 선택/동작(게시판 이동, 상세 열기, 정렬, 페이지 이동, 글쓰기 등)

---

## 2. 최근 개선 사항

### 성능
- `/me/posts`: 커서 페이지네이션 (`limit + startAfter`)
- `/me/comments`: 커서 페이지네이션 + post hydrate N+1 제거(`documentId() in (...)` 청크 조회)
- 관리자 게시판 순서 저장: `writeBatch` 청크 커밋

### 보안/운영
- 사용자 UI 오류 메시지에서 내부 디버그 정보 제거
- 상세 payload 로그는 개발 플래그에서만 출력
- Firestore 인덱스 정리 및 배포 반영

### 의존성
- `firebase@12.9.0`
- `vite@7.3.1`
- `quill@2.0.2`
- `npm audit: 0 vulnerabilities`

---

## 3. 폴더 구조

```text
mentor-forum-react/
├─ src/
│  ├─ App.jsx
│  ├─ main.jsx
│  ├─ pages/
│  │  ├─ LoginPage.jsx
│  │  ├─ SignupPage.jsx
│  │  ├─ AppPage.jsx
│  │  ├─ PostPage.jsx
│  │  ├─ MyPostsPage.jsx
│  │  ├─ MyCommentsPage.jsx
│  │  └─ AdminPage.jsx
│  ├─ components/
│  │  ├─ excel/
│  │  ├─ editor/
│  │  └─ ui/
│  ├─ hooks/
│  ├─ legacy/
│  └─ styles/
├─ public/
│  ├─ favicon.png
│  ├─ manifest.webmanifest
│  └─ firebase-messaging-sw.js
├─ scripts/
│  └─ gas-push-relay/
├─ firebase.json
├─ firestore.rules
├─ firestore.indexes.json
├─ package.json
└─ README.md
```

---

## 4. 라우트

- `/login` 로그인
- `/signup` 회원가입
- `/app` 메인 게시판
- `/post` 게시글 상세
- `/admin` 관리자
- `/me/posts` 내가 쓴 글
- `/me/comments` 내가 쓴 댓글

레거시 경로도 리다이렉트 지원:
- `/login.html`, `/signup.html`, `/app.html`, `/post.html`, `/admin.html`, `/me/posts.html`, `/me/comments.html`

---

## 5. 로컬 개발

### 요구사항
- Node.js 20+ 권장 (현재 22에서 검증)
- npm

### 설치/실행
```bash
npm install
npm run dev
```

### 빌드/프리뷰
```bash
npm run build
npm run preview
```

---

## 6. 환경변수

`.env.local` 예시:

```bash
VITE_PUSH_RELAY_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
VITE_FIREBASE_MESSAGING_VAPID_KEY=YOUR_VAPID_KEY
```

- `VITE_PUSH_RELAY_URL`: GAS 웹앱 릴레이 URL
- `VITE_FIREBASE_MESSAGING_VAPID_KEY`: FCM 웹푸시 VAPID 키

---

## 7. 배포

### Hosting + Rules + Indexes
```bash
npx firebase deploy --only hosting,firestore:rules,firestore:indexes --project guro-mentor-forum
```

### 배포 후 점검
1. `/login` 로그인
2. `/app` 게시판 선택/글 읽기
3. `/post` 상세/댓글 동작
4. `/me/posts`, `/me/comments` 더보기 동작
5. `/admin` (권한 계정) 관리 동작
6. 테마 순환/저장/탭 동기화
7. 모바일 푸시 수신(선택)

---

## 8. Firestore 인덱스

현재 주요 인덱스:
- `comments`: `authorUid ASC`, `createdAt DESC`
- `posts`: `authorUid ASC`, `createdAt DESC`
- `posts`: `boardId ASC`, `createdAt DESC`

파일: [`firestore.indexes.json`](./firestore.indexes.json)

---

## 9. GAS 푸시 릴레이

Firebase Functions(Blaze) 없이 푸시 전송을 위해 GAS Web App을 릴레이로 사용합니다.

- 문서: [`scripts/gas-push-relay/README.md`](./scripts/gas-push-relay/README.md)
- 클라이언트 구현: `src/legacy/push-relay.js`
- iOS PWA 환경 안정화를 위한 `sendBeacon / GET fallback` 포함

---

## 10. 트러블슈팅 요약

### `vite: command not found`
```bash
npm install
npm run dev
```

### 권한 오류
- 사용자 메시지는 요약형으로 표시됨
- 개발 상세 로그가 필요하면 브라우저 콘솔에서:
```js
window.__MENTOR_DEBUG__ = true
```

### iOS 푸시 미수신
- Safari 탭이 아닌 홈 화면(PWA) 실행인지 확인
- 권한/집중모드/저전력모드 확인

---

## 11. 참고
- 상위 워크스페이스 README: [`../README.md`](../README.md)
- GAS 릴레이 문서: [`./scripts/gas-push-relay/README.md`](./scripts/gas-push-relay/README.md)
- 메인 페이지: `src/pages/AppPage.jsx`
- 상세 페이지: `src/pages/PostPage.jsx`
- 권한: `src/legacy/rbac.js`
- 규칙/인덱스: `firestore.rules`, `firestore.indexes.json`
