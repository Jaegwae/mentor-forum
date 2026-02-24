# Mentor Forum React (V2)

멘토포럼의 React + Firebase 기반 프론트엔드/운영 앱입니다.
이 디렉터리가 실제 서비스 배포 단위입니다.

## 1. 프로젝트 목적

- 멘토 커뮤니티 게시판 서비스 제공
- 역할(Role) 기반 접근 제어
- 게시글/댓글/멘션/알림 중심 커뮤니케이션 지원
- 모바일/데스크톱 공통 사용자 경험 제공

## 2. 라우트 맵

- `/login`: 로그인
- `/signup`: 회원가입
- `/app`: 메인 게시판
- `/post`: 게시글 상세
- `/me/posts`: 내가 쓴 글
- `/me/comments`: 내가 쓴 댓글
- `/admin`: 관리자 사이트

레거시 URL 리다이렉트도 포함합니다.

- `/login.html` -> `/login`
- `/signup.html` -> `/signup`
- `/app.html` -> `/app`
- `/post.html` -> `/post`
- `/admin.html` -> `/admin`

## 3. V2 기능 상세

### 3.1 게시판/목록

- 게시판 선택 시 URL `?boardId=...` 동기화
- 정렬 탭 단순화: `최신`, `인기`
- 새 글 `N` 배지 노출
- 댓글 수 시인성 강화
- 고정 게시글 배지(`고정`) 지원
- 상태형 게시글(`cover_for`) 가독성 개선

### 3.2 상세/복귀

- 상세 진입 시 게시판 컨텍스트를 state/query/session에 함께 보존
- `목록으로`/뒤로가기 시 기존 게시판 맥락 우선 복구
- 댓글 작성/수정/삭제 흐름 정리

### 3.3 멘션/알림

- `@닉네임` 멘션 알림 발송
- `@all` 멘션은 관리자 전용
- 알림센터 기능:
  - 필터(전체/새 글/멘션/댓글)
  - 모두 읽음
  - 게시판별 알림 설정
  - 댓글/멘션 알림 설정

### 3.4 내 활동

- `/me/posts`: 내가 쓴 글 목록
- `/me/comments`: 내가 쓴 댓글 목록
- 항목 클릭 시 원본 게시글로 이동

### 3.5 최근 댓글 패널

- 데스크톱에서만 노출
- 전체 댓글 기준 최신 5개
- 클릭 시 게시글 상세 이동
- 모바일은 의도적으로 숨김

### 3.6 공통 UX

- 라이트/다크 모드
- 반응형 레이아웃
- 사용 설명서 모달
- 로그인 유지 미선택 시 자동 로그아웃 + 세션 연장

## 4. 폴더 구조

```text
mentor-forum-react/
├─ src/
│  ├─ App.jsx                    # Router
│  ├─ main.jsx                   # App bootstrap
│  ├─ pages/
│  │  ├─ LoginPage.jsx
│  │  ├─ SignupPage.jsx
│  │  ├─ AppPage.jsx
│  │  ├─ PostPage.jsx
│  │  ├─ MyPostsPage.jsx
│  │  ├─ MyCommentsPage.jsx
│  │  └─ AdminPage.jsx
│  ├─ components/ui/             # 공통 UI 컴포넌트
│  ├─ hooks/                     # 공통 훅
│  ├─ legacy/
│  │  ├─ config.js               # 런타임 설정
│  │  ├─ firebase-app.js         # Firebase 래퍼/공용 API
│  │  ├─ rbac.js                 # 권한 유틸
│  │  ├─ rich-editor.js          # 에디터 유틸
│  │  └─ ui.js                   # 레거시 UI 유틸
│  └─ styles/design-system.css   # V2 디자인 시스템
├─ firebase.json
├─ firestore.rules
├─ firestore.indexes.json
├─ package.json
└─ README.md
```

## 5. 실행 방법

### 5.1 의존성 설치

```bash
npm install
```

### 5.2 개발 서버 실행

```bash
npm run dev
```

### 5.3 프로덕션 빌드

```bash
npm run build
npm run preview
```

## 6. 배포 방법

`.firebaserc` 없이 프로젝트를 직접 지정합니다.

```bash
./node_modules/.bin/firebase deploy --only hosting --project guro-mentor-forum
```

Rules 동시 배포:

```bash
./node_modules/.bin/firebase deploy --only hosting,firestore:rules --project guro-mentor-forum
```

## 7. 개발 시 권장 체크리스트

- 로그인 상태 유지 체크 동작 확인
- 회원가입 닉네임 중복 체크 확인
- 게시판 이동 -> 상세 -> 목록 복귀 맥락 확인
- 다크/라이트에서 목록/상세/모달 대비 확인
- 모바일 메뉴/목록 카드 깨짐 여부 확인
- 최근 댓글 5개 노출 및 링크 이동 확인

## 8. 권한/정책 참고

- 역할/권한 로직: `src/legacy/rbac.js`
- Firestore 접근 규칙: `firestore.rules`
- 관리자 기능/권한 제한은 클라이언트 + Rules를 같이 확인해야 정확합니다.

## 9. 관련 문서

- 상위 워크스페이스 문서: `../README.md`
- 앱 라우터: `src/App.jsx`
- 메인 페이지: `src/pages/AppPage.jsx`
- 상세 페이지: `src/pages/PostPage.jsx`
