# Mentor Forum React

멘토스의 **실서비스용 React + Firebase 커뮤니티 앱**입니다.

- 운영 URL: [https://guro-mentor-forum.web.app](https://guro-mentor-forum.web.app)
- Firebase 프로젝트: `guro-mentor-forum`
- 주요 라우트: `/app`, `/post`, `/admin`, `/me/posts`, `/me/comments`
- 기준 문서 업데이트 시점: `2026-03-01`

---

## 1. 빠른 시작

### 1) 가장 먼저 보는 파일
1. `src/App.jsx`
2. `src/pages/AppPage.jsx`, `src/pages/PostPage.jsx`, `src/pages/AdminPage.jsx`
3. `src/pages/app-page/*`, `src/pages/post-page/*`, `src/pages/admin-page/*`
4. `src/services/firestore/*`
5. `firestore.rules`, `firestore.indexes.json`

### 2) 30초 구조 요약
- 라우트 엔트리(`src/pages/*.jsx`)는 **thin wrapper**입니다.
- 실제 상태/이펙트/핸들러는 `use*Controller` 훅에 있습니다.
- 렌더링은 `*View.jsx`가 담당합니다.
- Firestore 접근은 우선 `data.js`/`services/firestore/*` 경유를 원칙으로 합니다.

### 3) 로컬 실행
```bash
npm install
npm run dev
```

### 4) 기본 검증
```bash
npm run build
npm run test
npm run test:rules
RUN_E2E=1 npm run test:e2e
```

---

## 2. 현재 아키텍처

### 1) 계층 구조
```text
Route Wrapper (src/pages/*.jsx)
  -> Controller Hook (src/pages/*-page/use*Controller*)
    -> Page Data (src/pages/*-page/data.js)
      -> Firestore Service (src/services/firestore/*.js)
  -> View (src/pages/*-page/*View.jsx)
```

### 2) 페이지별 책임
- `AppPage`
  - 게시판 목록/피드/글쓰기/알림센터/푸시/엑셀 모드
- `PostPage`
  - 게시글 상세/댓글 스레드/멘션 알림/수정/삭제/엑셀 모드
- `AdminPage`
  - 게시판/구분선/권한(Role)/회원 등급/체험관 옵션 관리

### 3) 서비스 레이어 원칙
- 컨트롤러에서 Firestore primitive (`doc`, `getDoc`, `setDoc` 등)를 직접 호출하지 않습니다.
- 쿼리와 문서 경로는 `src/services/firestore/*`로 집중합니다.
- 쿼리 제약(`where/orderBy/limit`)은 기능 동등성 유지를 위해 서비스에서 고정합니다.

---

## 3. 폴더 구조 (실사용 기준)

```text
mentor-forum-react/
├─ src/
│  ├─ App.jsx
│  ├─ main.jsx
│  ├─ pages/
│  │  ├─ LoginPage.jsx
│  │  ├─ SignupPage.jsx
│  │  ├─ AppPage.jsx                # thin wrapper
│  │  ├─ PostPage.jsx               # thin wrapper
│  │  ├─ AdminPage.jsx              # thin wrapper
│  │  ├─ MyPostsPage.jsx
│  │  ├─ MyCommentsPage.jsx
│  │  ├─ app-page/
│  │  │  ├─ constants.js
│  │  │  ├─ utils.js
│  │  │  ├─ data.js
│  │  │  ├─ useAppPageController.js
│  │  │  └─ AppPageView.jsx
│  │  ├─ post-page/
│  │  │  ├─ constants.js
│  │  │  ├─ utils.js
│  │  │  ├─ data.js
│  │  │  ├─ usePostPageController.jsx
│  │  │  └─ PostPageView.jsx
│  │  └─ admin-page/
│  │     ├─ constants.js
│  │     ├─ utils.js
│  │     ├─ data.js
│  │     ├─ useAdminPageController.jsx
│  │     └─ AdminPageView.jsx
│  ├─ services/
│  │  ├─ firestore/
│  │  │  ├─ app-page.js
│  │  │  ├─ post-page.js
│  │  │  ├─ admin-page.js
│  │  │  ├─ boards.js
│  │  │  ├─ posts.js
│  │  │  ├─ comments.js
│  │  │  ├─ notifications.js
│  │  │  ├─ roles.js
│  │  │  └─ users.js
│  │  └─ editor/
│  │     └─ rich-editor-transform.js
│  ├─ components/
│  ├─ hooks/
│  ├─ legacy/
│  └─ styles/
├─ public/
├─ tests/
├─ firestore.rules
├─ firestore.indexes.json
├─ vitest.config.js
├─ playwright.config.js
└─ README.md
```

---

## 4. 라우트/리다이렉트 규칙

### 기본 라우트
- `/login` 로그인
- `/signup` 회원가입
- `/app` 메인 게시판
- `/post` 게시글 상세
- `/admin` 관리자
- `/me/posts` 내가 쓴 글
- `/me/comments` 내가 쓴 댓글

### 레거시 경로 리다이렉트
- `/login.html` -> `/login`
- `/signup.html` -> `/signup`
- `/app.html` -> `/app`
- `/post.html` -> `/post`
- `/admin.html` -> `/admin`
- `/me/posts.html` -> `/me/posts`
- `/me/comments.html` -> `/me/comments`

### 보호 라우트 동작
- 비로그인 상태에서 `/app`, `/post`, `/admin`, `/me/*` 접근 시 `/login`으로 이동합니다.

---

## 5. 기능 요약

### 인증/권한
- Firebase Auth 로그인/회원가입/이메일 인증
- Role 기반 접근 제어: `Newbie`, `Mentor`, `Staff`, `Admin`, `Super_Admin`
- 관리자 기능별 세분 권한 (`canManageBoards`, `canManageRoles`, `canManageRoleDefinitions` 등)

### 게시판/게시글
- 보드 선택 + URL `boardId` 동기화
- 목록 정렬: `최신`, `인기`
- 상세 페이지 댓글/멘션/답글
- 고정글(핀) 처리

### 알림/푸시
- 알림센터(필터/읽음 처리/보드별 on/off)
- 멘션(`@닉네임`, `@ALL`) 알림
- 모바일 푸시(FCM) + GAS 릴레이

### 테마/엑셀 모드
- 라이트/다크/엑셀 모드
- 엑셀 크롬 + 셀 액션 기반 내비게이션

---

## 6. Firestore 접근 계층

### 페이지 특화 서비스
- `src/services/firestore/app-page.js`
- `src/services/firestore/post-page.js`
- `src/services/firestore/admin-page.js`

### 도메인 공통 서비스
- `boards.js`, `posts.js`, `comments.js`, `notifications.js`, `roles.js`, `users.js`

### 규칙
- 컨트롤러/뷰에서 Firestore primitive 직접 호출하지 않습니다.
- 새 쿼리는 우선 서비스 함수로 추가 후 컨트롤러에서 호출합니다.

---

## 7. 테스트/검증 전략

### 단위/스모크
```bash
npm run test
```
- 라우트 스모크
- rich-editor 변환 테스트

### Firestore Rules 계약 테스트
```bash
npm run test:rules
```
- Emulator 기반 권한 시나리오 검증

### E2E 스모크
```bash
RUN_E2E=1 npm run test:e2e
```
- `/login`, `/app`, `/post`, `/admin` 기본 도달성 검증

### 릴리즈 전 권장 체크
```bash
npm run build && npm run test && npm run test:rules && RUN_E2E=1 npm run test:e2e
```

---

## 8. 인덱스/규칙 주의사항

### 인덱스 파일
- `firestore.indexes.json`

### 현재 주의 포인트
- `comments` 컬렉션 그룹의 `createdAt DESC` 조회가 필요한 기능이 있습니다(최근 댓글 실시간 피드).
- 인덱스 변경 후에는 반드시 배포해야 운영 콘솔 에러가 사라집니다.

### 인덱스 배포
```bash
npx firebase deploy --only firestore:indexes --project guro-mentor-forum
```

### 규칙/인덱스/호스팅 동시 배포
```bash
npx firebase deploy --only hosting,firestore:rules,firestore:indexes --project guro-mentor-forum
```

---

## 9. 트러블슈팅 (실전)

### 1) 빈 화면이 보일 때
1. 브라우저 콘솔 `ReferenceError`/`TypeError` 확인
2. `npm run dev` 로그 확인
3. 빠른 정적 점검
```bash
npx eslint@8 "src/**/*.{js,jsx}" --no-eslintrc --env browser,es2021,node --parser-options '{"ecmaVersion":"latest","sourceType":"module","ecmaFeatures":{"jsx":true}}' --rule 'no-undef:error' --rule 'no-unused-vars:off'
```
4. 라우트 런타임 순회(Playwright)로 `pageerror/console.error` 재현

### 2) 권한 오류가 애매할 때
- 개발 콘솔 상세 로그 필요 시:
```js
window.__MENTOR_DEBUG__ = true
```

### 3) iOS 푸시 미수신
- Safari 탭이 아닌 홈 화면(PWA) 실행인지 확인
- 알림 권한/집중모드/저전력모드 확인

---

## 10. 환경변수

`.env.local` 예시:

```bash
VITE_PUSH_RELAY_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
VITE_FIREBASE_MESSAGING_VAPID_KEY=YOUR_VAPID_KEY
```

- `VITE_PUSH_RELAY_URL`: GAS 릴레이 URL
- `VITE_FIREBASE_MESSAGING_VAPID_KEY`: FCM 웹푸시 VAPID 키

---

## 11. 개발 규칙 (이 프로젝트에서 중요)

1. 기능 변경 없는 리팩터링 시
- 쿼리 제약/스토리지 키/URL 파라미터 의미를 유지합니다.

2. 파일 분리 시
- Wrapper (`pages/*.jsx`)는 얇게 유지합니다.
- Controller에서 상태/핸들러를 관리하고 View는 렌더만 담당합니다.

3. Firestore 변경 시
- 서비스 함수 추가 -> 컨트롤러 치환 -> 빌드/테스트/규칙 검증 순서로 진행합니다.

4. 디버깅 시
- 런타임 에러(`pageerror`)를 우선 해결하고 그 다음 권한/데이터 문제를 봅니다.

---

## 12. 참고

- 상위 워크스페이스 README: [`../README.md`](../README.md)
- GAS 릴레이 문서: [`./scripts/gas-push-relay/README.md`](./scripts/gas-push-relay/README.md)
- 권한 로직: `src/legacy/rbac.js`
- 규칙/인덱스: `firestore.rules`, `firestore.indexes.json`

---

## 13. 네이버 근무일정 자동 동기화(확장프로그램)

- 위치: `tools/naver-work-schedule-sync`
- 목적: 네이버 카페 근무일정 글을 `work_schedule` 게시판으로 주기 업서트
- 기본 시간: `Asia/Seoul` 기준 `00:00 / 06:00 / 12:00 / 18:00`
- 설치: `chrome://extensions` -> 개발자 모드 ON -> `압축해제된 확장 프로그램 로드`
- 상세: [`./tools/naver-work-schedule-sync/README.md`](./tools/naver-work-schedule-sync/README.md)

### 동기화/업서트 핵심 규칙(현재 운영 기준)
- 동일 제목 게시글이 있으면 해당 문서 경로를 찾아 **항상 덮어쓰기**합니다.
- 과거처럼 콘텐츠 해시가 같다고 `skip` 하지 않습니다.
- 현재 `skip` 카운트는 주로 `articleId`를 읽지 못한 소스(비정상 링크/차단 페이지)에만 사용됩니다.
- 본문 HTML과 함께 `workScheduleRows`, `workScheduleDateKeys`를 같이 저장해 캘린더/근무 알림 파이프라인이 같은 데이터를 사용합니다.

### 동기화 성공/스킵/실패 해석
- `성공`: Firestore 문서 upsert 완료
- `스킵`: 소스 게시글 식별 실패(예: articleId 미검출)
- `실패`: 인증/네트워크/권한/파싱 예외 등으로 문서 커밋 실패

---

## 14. 근무일정 게시글 편집기(일반 표 모드)

### 왜 일반 표 모드인가
- 근무표 작성자가 HTML을 직접 수정하면 실수 가능성이 높아 유지보수가 어렵습니다.
- 그래서 `work_schedule` 게시글 수정 시에는 **일반 표 편집 UI**를 사용합니다.

### 편집 UX
- 헤더명/열 수/행 수를 자유롭게 변경 가능
- 셀 직접 수정 가능
- 행/열 추가/삭제 가능
- 데이터 행은 우측 `그립(세 줄)` 드래그로 순서 변경 가능
  - 헤더 행(첫 줄)은 고정

### 저장 시 내부 처리
1. 편집 그리드(2D 배열)를 정규화
2. 기존 본문 HTML에서 첫 번째 `<table>`만 교체
3. 본문 전/후 안내문/텍스트 블록은 유지
4. 교체된 HTML에서 `workScheduleRows`를 다시 파싱해 캘린더 반영 데이터 갱신

### 캘린더 반영 주의
- 표 저장 자체는 자유 헤더로 가능하지만, 캘린더 파서가 인식하는 최소 컬럼(`날짜`, `풀타임/파트*`)이 없으면
  캘린더 반영 데이터가 비어 있을 수 있습니다.
- 이 경우 저장은 성공하고, UI에서 안내 문구로 알려줍니다.

---

## 15. 주석/문서화 기준

### 코드 주석 원칙
- 각 모듈 상단에 "무엇을 책임지는 파일인지"를 먼저 명시합니다.
- 복잡한 분기/정규화/파싱/동기화 로직에는 "왜 이렇게 처리하는지"를 주석으로 남깁니다.
- UI 이벤트는 가능한 경우 "상태 변경 방향"이 보이도록 주석을 추가합니다.

### 이번 정리에서 보강한 축
- `PostPage` 근무일정 표 편집 파이프라인(HTML 테이블 교체, 캘린더 파싱, 저장 계약)
- 확장프로그램 동기화 파이프라인(스케줄 가드, 강제 덮어쓰기 정책, 스킵 의미)
- 스타일/확장프로그램 UI 파일의 역할 주석(Options/Popup/CSS entrypoints)

### 예외
- `manifest.json`은 JSON 특성상 주석을 직접 넣을 수 없습니다.
