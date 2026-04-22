# README_AI

이 문서는 **AI 에이전트 / 자동화 도구 / 새 개발자**가 이 저장소를 빠르게 파악하도록 돕는 내부용 안내서다.  
사용자 안내와 제품 소개는 `README.md`를 보고, 구조 파악과 작업 시작은 이 문서를 기준으로 한다.

---

## 1. 이 저장소를 한 줄로 설명하면

이 프로젝트는 **React + Firebase 기반 멘토 커뮤니티 앱**이며, 핵심 화면은 다음 3개다.

- `/app` : 메인 커뮤니티 / 게시판 / 글쓰기 / 알림센터 / 모바일 푸시 / 엑셀 모드
- `/post` : 게시글 상세 / 댓글 / 멘션 / 수정 / 삭제 / 상세 엑셀 모드
- `/admin` : 게시판 / Role / 회원 권한 / 체험관 관리

부가적으로 다음도 포함한다.

- Firebase Auth / Firestore / FCM
- Firestore Rules / 인덱스 관리
- Firebase Functions 기반 push dispatch
- 네이버 카페 근무일정 동기화용 크롬 확장

---

## 2. 먼저 읽어야 하는 순서

AI가 처음 이 저장소를 볼 때는 아래 순서가 가장 효율적이다.

1. `AGENTS.md`
   - 작업 규칙, 검증 원칙, 리팩터링/보고 규약
2. `README_AI.md`
   - 현재 문서. 구조와 진입 순서 요약
3. `docs/refactor-handbook.md`
   - 최근 리팩터링 내역, 안정화 이슈, 주의사항
4. `src/App.jsx`
   - 실제 라우트 엔트리
5. `src/pages/AppPage.jsx`, `src/pages/PostPage.jsx`, `src/pages/AdminPage.jsx`
   - thin wrapper 여부와 진입 훅 확인
6. `src/pages/*-page/use*Controller*`
   - 실제 오케스트레이션 로직
7. `src/pages/*-page/*View.jsx`
   - VM이 JSX로 어떻게 투영되는지 확인
8. `src/pages/*-page/data.js`
   - 페이지별 async bootstrap / page-level data orchestration
9. `src/services/firestore/*`
   - Firestore 읽기/쓰기/구독 경계
10. `src/pages/*-page/utils.js`, `src/pages/shared/forum-constants.js`
   - 도메인 정규화 규칙 / 공통 상수
11. `firestore.rules`
   - 실제 권한 모델

---

## 3. 현재 아키텍처 핵심

현재 구조는 대체로 아래 계층을 따른다.

```text
Route Wrapper (src/pages/*.jsx)
  -> Controller Hook (src/pages/*-page/use*Controller*)
    -> Split Hooks (domain runtime slices)
    -> Page Data (src/pages/*-page/data.js)
      -> Firestore Service (src/services/firestore/*.js)
  -> View (src/pages/*-page/*View.jsx)
```

핵심 원칙:

- `src/pages/*.jsx`는 **thin wrapper**여야 한다.
- 상태/이펙트/핸들러는 controller 또는 split hook에 둔다.
- View는 가급적 렌더링 중심이어야 한다.
- Firestore primitive 직접 호출보다 `services/firestore/*`를 우선한다.

---

## 4. 페이지별 구조

### AppPage

중심 파일:

- `src/pages/app-page/useAppPageController.js`
- `src/pages/app-page/AppPageView.jsx`

주요 split hooks:

- `useAppBoardFeed`
- `useAppComposerState`
- `useAppComposerMentions`
- `useAppComposerActions`
- `useAppNotificationCenter`
- `useAppNotificationSync`
- `useAppNavigationPins`
- `useAppCalendar`

책임:

- 게시판 선택 / 피드 로딩 / 페이지네이션
- 글쓰기 / cover-for 입력
- 멘션
- 알림센터 / 모바일 푸시
- 캘린더
- 고정글 선택 / 이동

---

### PostPage

중심 파일:

- `src/pages/post-page/usePostPageController.jsx`
- `src/pages/post-page/PostPageView.jsx`

주요 split hooks:

- `usePostComments`
- `usePostCommentMentions`
- `usePostEditModal`
- `usePostNotifications`

책임:

- 게시글 상세 로드
- 댓글 실시간 구독
- 댓글/수정 멘션 메뉴
- 게시글 수정
- 댓글 작성 후 notification fan-out

주의:

- PostPage는 한동안 리팩터링 후 wiring 누락이 연쇄적으로 발생했었다.
- 관련 회귀 방지 테스트가 `tests/controller-wiring-regression.test.js`에 추가되어 있다.

---

### AdminPage

중심 파일:

- `src/pages/admin-page/useAdminPageController.jsx`
- `src/pages/admin-page/AdminPageView.jsx`

책임:

- 게시판 CRUD / 구분선 / 순서 조정
- Role 정의 관리
- 회원 권한 변경
- 체험관 옵션 관리

주의:

- AdminPage도 PostPage와 비슷하게 리팩터링 후 util 누락으로 렌더 크래시가 났던 적이 있다.
- 현재 Admin 관련 핵심 wiring도 regression test에 포함됨.

---

## 5. shared / service / legacy 계층

### shared constants

- `src/pages/shared/forum-constants.js`

역할:

- 게시판 ID
- 공통 role fallback
- mention token
- notification type/subtype
- 공통 정책 상수

---

### Firestore services

주요 파일:

- `src/services/firestore/app-page.js`
- `src/services/firestore/post-page.js`
- `src/services/firestore/admin-page.js`
- `src/services/firestore/boards.js`
- `src/services/firestore/posts.js`
- `src/services/firestore/comments.js`
- `src/services/firestore/notifications.js`
- `src/services/firestore/roles.js`
- `src/services/firestore/users.js`

원칙:

- query / get / set / update / snapshot 경계를 이쪽에 모은다.
- controller는 workflow orchestration에 집중한다.

### controller / view 관찰 포인트

AI가 페이지를 읽을 때는 아래 순서로 보면 빠르다.

1. wrapper가 어떤 controller를 부르는지
2. controller가 어떤 split hook을 조합하는지
3. view가 어떤 VM 필드를 실제로 소비하는지

즉 **"view에서 안 쓰는 VM 필드"** 와 **"controller에서 빠진 wiring"** 은 항상 같이 점검한다.

---

### profile bootstrap

- `src/services/profile-bootstrap.js`

역할:

- fallback role definition merge
- first-login user profile bootstrap
- role normalization

이 레이어는 App/Post/Admin 진입부 공통이다.

---

### legacy

주요 파일:

- `src/legacy/firebase-app.js`
- `src/legacy/rich-editor.js`
- `src/legacy/rbac.js`
- `src/legacy/push-notifications.js`
- `functions/index.js`
- `src/legacy/config.js`

이름은 legacy지만 현재도 **실사용 핵심 계층**이다.

AI가 혼동하기 쉬운 점:

- `legacy` 폴더라고 해서 죽은 코드가 아니다.
- Firebase SDK export, rich editor wrapper, RBAC, 웹푸시 토큰 발급은 활성 경로다.
- 실제 FCM 발송, 새 글 fan-out, 근무일정 예약 알림은 `functions/index.js`가 담당한다.

---

## 6. 테스트 / 검증

기본:

```bash
npm test
npm run build
```

rules:

```bash
npm run test:rules
```

테스트 세트:

- `tests/routes.smoke.test.jsx`
  - 라우트 스모크
- `tests/controller-wiring-regression.test.js`
  - App/Post/Admin controller 핵심 wiring 누락 방지
- `tests/profile-bootstrap.test.js`
  - profile bootstrap 공통 로직
- `tests/post-page-content-html.test.js`
  - PostPage HTML/content 관련
- `tests/rich-editor-transform.test.js`
  - editor transform

중요:

- 최근 리팩터링 이슈 때문에 **controller wiring regression test**는 매우 중요하다.
- util/constant/hook argument 누락은 먼저 이 테스트를 깨워야 한다.

### 추천 검증 순서

버그 수정/리팩터링 직후에는 보통 아래 순서가 가장 효율적이다.

1. `npm test`
   - source wiring / unit / smoke 레벨 빠른 확인
2. `npm run build`
   - 실제 번들 단계에서 import/export/JSX 문제가 없는지 확인
3. 필요 시 해당 라우트 수동 확인
   - `/app`
   - `/post?postId=...`
   - `/admin`
4. 권한/규칙 변경이 있으면 `npm run test:rules`

---

## 6-1. 문제 발생 시 어디부터 볼지

### `/app` 문제
1. `src/pages/app-page/useAppPageController.js`
2. 관련 split hook
   - `useAppBoardFeed`
   - `useAppComposer*`
   - `useAppNotification*`
   - `useAppNavigationPins`
   - `useAppCalendar`
3. `src/pages/app-page/data.js`
4. `src/services/firestore/app-page.js`

### `/post` 문제
1. `src/pages/post-page/usePostPageController.jsx`
2. 관련 split hook
   - `usePostComments`
   - `usePostCommentMentions`
   - `usePostEditModal`
   - `usePostNotifications`
3. `src/pages/post-page/utils.js`
4. `src/services/firestore/post-page.js`

### `/admin` 문제
1. `src/pages/admin-page/useAdminPageController.jsx`
2. `src/pages/admin-page/utils.js`
3. `src/pages/admin-page/data.js`
4. `src/services/firestore/admin-page.js`

### 권한 문제
1. `src/legacy/rbac.js`
2. 관련 page `utils.js`의 role helper
3. `firestore.rules`

### editor / 멘션 문제
1. `src/legacy/rich-editor.js`
2. `src/components/editor/RichEditorToolbar.jsx`
3. App/Post mention hooks

### excel mode 문제
1. `src/components/excel/AppExcelWorkbook.jsx`
2. `src/components/excel/AppExcelCellRenderers.jsx`
3. sheet model builder 파일들

### 렌더는 되는데 데이터가 비는 경우
1. controller의 `ready`, `message`, `current*` state가 어떻게 세팅되는지
2. page-level `data.js` bootstrap 경로
3. 관련 `services/firestore/*` fetch 함수
4. 마지막으로 `firestore.rules`

### 자주 보던 회귀 시그니처
- `ReferenceError: X is not defined`
  - 거의 항상 controller의 constants/utils destructuring 누락이거나
    split hook 인자/반환값 wiring 누락이었다.
- 페이지는 뜨는데 `currentPost` / `currentUserProfile` 같은 핵심 state가 비어 있음
  - bootstrap effect 경로, `data.js`, service fetch 경로, access 계산 helper 순으로 본다.
- 권한이 없어 보이는데 실제 role은 정상
  - 권한 계산 전 렌더 단계 crash였던 경우가 있었으므로 먼저 runtime error부터 본다.

---

## 7. 최근 리팩터링 핵심 요약

완료된 큰 작업:

- MyPosts / MyComments 공통화
- profile bootstrap 공통화
- forum constants 공통화
- role badge 공통화
- PostPage split hooks 분리
- AppPage split hooks 분리
- App/Post/Admin 렌더 안정화
- controller wiring regression test 추가
- AI readability comment pass 다회 수행

자세한 타임라인:

- `docs/refactor-handbook.md`

---

## 8. AI가 특히 조심할 것

### 1) deploy 금지

사용자가 명시하기 전까지:

- GitHub 관련 배포/푸시
- Firebase deploy

하지 말 것.

### 2) controller wiring 누락 주의

이 저장소는 최근 큰 controller를 split hook으로 나누는 리팩터링을 거쳤다.  
따라서 다음 종류의 실수가 가장 위험하다.

- util destructuring 누락
- constants destructuring 누락
- split hook 인자 전달 누락
- split hook 반환값 destructuring 누락
- 선언 순서 꼬임 (특히 derived state를 hook 호출 전에/후에 잘못 두는 문제)

### 3) View에 runtime 로직 넣지 말 것

View는 가능한 한:

- 렌더링
- style projection
- UI 배치

만 담당하게 유지한다.

### 4) README와 README_AI 역할 분리

- `README.md` → 사용자/사람 중심
- `README_AI.md` → 구조 파악 / 개발 진입 / AI용 안내

앞으로 구조 설명을 추가할 때는 README_AI 쪽을 우선 갱신한다.

### 5) 테스트는 구조 회귀를 먼저 본다

새 기능을 건드리기 전에 아래 테스트의 성격을 먼저 이해하는 것이 좋다.

- `routes.smoke` → 라우트 엔트리 자체가 깨지지 않았는지
- `controller-wiring-regression` → 최근 리팩터링에서 자주 발생했던
  util/constants/split-hook wiring 누락이 없는지
- `profile-bootstrap` → 진입부 공통 auth/profile 정규화가 유지되는지

즉, 최근 이 저장소에서 가장 흔한 회귀는 **business logic 오류보다 wiring 누락**이었다.

### 6) 큰 controller를 다시 키우지 말 것

App/Post는 split hook으로 나누는 방향이 이미 시작됐다.  
새 작업을 할 때는 가능하면:

- feed/load concerns
- mention concerns
- modal concerns
- notification concerns

를 다시 controller 한 파일에 섞지 말고, 기존 split hook 경계를 존중한다.

---

## 9. 다음에 또 작업할 때 추천 시작점

상황별 시작점:

### 기능 버그 수정
1. 해당 `*Page.jsx`
2. 해당 `use*Controller`
3. 관련 split hook
4. 관련 `data.js`
5. 관련 `services/firestore/*`

### 권한/접근 문제
1. `src/legacy/rbac.js`
2. `src/pages/*/utils.js`의 role 관련 helper
3. `firestore.rules`
4. 관련 controller access check

### 댓글/멘션 문제
1. `usePostComments`
2. `usePostCommentMentions`
3. `usePostNotifications`
4. `src/legacy/rich-editor.js`

### 캘린더/근무일정 문제
1. `useAppCalendar`
2. `post-page/utils.js`의 work schedule / cover-for helper
3. `tools/naver-work-schedule-sync/*`

### wiring 누락 의심 시
1. `tests/controller-wiring-regression.test.js`
2. 해당 controller 파일의 constants/utils destructuring
3. split hook 호출 인자 / 반환값 destructuring

### editor wrapper 문제
1. `src/legacy/rich-editor.js`
2. `src/components/editor/RichEditorToolbar.jsx`
3. `src/services/editor/rich-editor-transform.js`

### push 문제
1. `src/legacy/push-notifications.js`
2. `functions/index.js`
3. `src/services/firestore/notifications.js`
4. `public/firebase-messaging-sw.js`

---

## 10. 마지막 메모

이 저장소는 지금 상태에서:

- “기능 개발”보다
- “구조 유지 + 회귀 방지 + 탐색성 유지”

가 훨씬 중요하다.

AI가 작업할 때는 새 추상화를 늘리기보다:

- 기존 계층 유지
- wiring 누락 방지
- 테스트 추가
- 주석/문서 보강

쪽이 더 안전하다.

---

## 10-1. 변경 전 체크리스트

작업 시작 전에 가능한 한 아래를 먼저 확인한다.

- 지금 바꾸려는 파일이 wrapper / controller / view / data / service / utils 중 어디 계층인지
- 같은 기능을 담당하는 split hook이 이미 있는지
- `README_AI.md`의 증상별 시작점과 `docs/refactor-handbook.md`의 최근 변경 이력
- 관련 regression test가 이미 있는지
  - `routes.smoke`
  - `controller-wiring-regression`
  - `page-wrapper-contract`
  - `view-fallback-contract`

## 10-2. 변경 후 체크리스트

작업 후에는 최소한 아래를 다시 확인한다.

- constants / utils destructuring 누락 없는지
- split hook 호출 인자 / 반환값 destructuring 누락 없는지
- view가 controller 메시지를 가리지 않는지
- `npm test`
- `npm run build`
- 구조 변화가 있으면 `README_AI.md` 또는 `docs/refactor-handbook.md` 갱신

---

## 11. 주요 흐름 빠른 요약

### 로그인 / 부트스트랩 흐름
- Auth 상태 확인
- profile bootstrap
- role normalization
- permissions 계산
- 페이지별 bootstrap

### 권한 계산 흐름
- Firebase Auth 사용자 확인
- `profile-bootstrap`으로 user doc 확보/정규화
- `legacy/rbac.js`의 `buildPermissions(...)` 실행
- page controller에서 `canAccessAdminSite`, `canManageBoards`, `canManageRoles` 등 파생
- Firestore rules가 최종 권한을 다시 강제

### 게시글 상세 흐름
- `postId` 읽기
- post doc fetch
- board access 계산
- currentPost 세팅
- 댓글 realtime 구독

### 글쓰기 / cover-for 작성 흐름
- AppPage에서 현재 board 선택
- composer state hook이 제목/날짜/시간/체험관 입력 보유
- composer actions hook이 validation + post payload 생성
- Firestore post write
- `createPostNotifications` Function이 새 글 대상자 fan-out 후 notification docs 생성
- `dispatchNotificationPush` Function이 notification docs를 FCM으로 발송

### 댓글 / 멘션 흐름
- PostPage에서 댓글 composer editor mount
- mention hook이 `@닉네임` / `@ALL` 감지
- 댓글 write
- notification hook이 post author / reply target / mention target fan-out
- `dispatchNotificationPush` Function이 생성된 notification docs를 FCM으로 발송

### 알림 흐름
- notification docs 구독
- preference docs 구독
- mention / 댓글은 클라이언트가 notification docs 생성
- 새 글은 `createPostNotifications`가 게시판 role 기반 대상자에게 notification docs 생성
- 모든 FCM 발송은 `dispatchNotificationPush`가 모바일/게시판/타입 preference와 push token을 확인한 뒤 수행
- 근무일정 전날/당일 푸시는 `workScheduleTomorrowReminder`, `workScheduleTodayReminder` 예약 Function이 담당

### 관리자 흐름
- Auth/profile bootstrap
- `canAccessAdminSite` 확인
- roles / boards / users / venues read model bootstrap
- modal open -> form draft 수정 -> firestore mutation -> refresh + popup/message

### Excel mode 흐름
- controller에서 sheet model 생성
- Workbook가 cell meta/action을 렌더
- 페이지 핸들러가 actionType/actionPayload를 받아 처리

---

## 12. AI 작업 체크리스트

작업 시작 전:
- 현재 작업이 사용자용 README인지 AI용 README인지 구분
- 대상 페이지의 wrapper/controller/view/data/service 순서 확인
- `docs/refactor-handbook.md` 최근 변경 확인

작업 중:
- split hook 경계 존중
- constants / utils destructuring 누락 없는지 확인
- View가 실제로 쓰는 VM만 유지

작업 후:
- `npm test`
- `npm run build`
- 필요 시 `npm run test:rules`
- 구조 변경이면 `README_AI.md` 또는 `docs/refactor-handbook.md` 갱신
