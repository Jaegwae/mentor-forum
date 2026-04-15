# Refactor Handbook

이 문서는 다음 리팩터링 작업 때 빠르게 컨텍스트를 복구하기 위한 요약 문서다.
배포 관련 작업은 포함하지 않는다.

## 0. 현재 작업 원칙

- GitHub 배포 금지
- Firebase 배포 금지
- 로컬 변경은 **작은 단위로**, **테스트/빌드 통과 확인 후** 진행

## 1. 이번 세션에서 실제로 한 작업

### 완료한 리팩터링

#### 패스 1 — My activity 공통 helper 추출

`MyPostsPage` / `MyCommentsPage` 에 중복되어 있던 공통 로직을 추출했다.

#### 추가된 파일

- `src/pages/my-activity/shared.jsx`
- `tests/my-activity-shared.test.jsx`

#### 수정된 파일

- `src/pages/MyPostsPage.jsx`
- `src/pages/MyCommentsPage.jsx`

#### 추출한 공통 내용

- 자동 로그아웃 메시지
- 역할(role) fallback 정의 병합
- role definition map 생성
- 날짜 포맷
- 모바일/compact 감지
- `AuthorWithRole` 표시 UI
- board name map 로딩

#### 검증 결과

- `npm test` 통과
- `npm run build` 통과
- Firestore rules 테스트는 emulator 없어서 skip

#### 패스 2 — data bootstrap 공통 서비스화

`app-page/post-page/admin-page` 의 `data.js` 에 중복돼 있던
role/profile bootstrap 로직을 공통 서비스로 이동했다.

#### 추가된 파일

- `src/services/profile-bootstrap.js`
- `tests/profile-bootstrap.test.js`

#### 수정된 파일

- `src/pages/app-page/data.js`
- `src/pages/post-page/data.js`
- `src/pages/admin-page/data.js`

#### 정리한 내용

- role definition + fallback 병합 공통화
- user profile 기본 생성 공통화
- normalized role 계산 공통화
- email verified sync 공통화
- 각 page data.js 는 이제 얇은 wrapper 역할만 유지

#### 패스 3 — View unused import 정리

불필요 import가 실제로 남아 있던 view 파일 2개를 정리했다.

#### 수정된 파일

- `src/pages/post-page/PostPageView.jsx`
- `src/pages/admin-page/AdminPageView.jsx`

#### 정리한 내용

- 실제로 쓰지 않는 React hook import 제거
- 쓰지 않는 router/theme/page-meta import 제거
- view에서 불필요하게 들고 있던 일부 legacy import 제거

#### 현재 검증 결과

- `npm test` 통과
- `npm run build` 통과
- Firestore rules 테스트는 emulator 없어서 skip

#### 패스 4 — forum 공통 상수 병합

`app-page/post-page/my-activity/admin-page` 에 퍼져 있던
중복 포럼 상수를 shared constants로 모았다.

#### 추가된 파일

- `src/pages/shared/forum-constants.js`

#### 수정된 파일

- `src/pages/app-page/constants.js`
- `src/pages/post-page/constants.js`
- `src/pages/admin-page/constants.js`
- `src/pages/my-activity/shared.jsx`

#### 정리한 내용

- notice/board/work-schedule id
- cover-for 공통 상태/기본값
- mention 관련 상수
- notification type 공통값
- role alias / fallback role definitions
- auto logout / last board key

#### 패스 5 — RoleBadge UI 공통화

페이지별로 중복돼 있던 role badge UI를 공통 컴포넌트로 이동했다.

#### 추가된 파일

- `src/components/ui/role-badge.jsx`

#### 수정된 파일

- `src/pages/app-page/AppPageView.jsx`
- `src/pages/post-page/PostPageView.jsx`
- `src/pages/admin-page/AdminPageView.jsx`
- `src/pages/my-activity/shared.jsx`

#### 정리한 내용

- `RoleBadge`
- `AuthorWithRole`

를 단일 공통 UI로 통합했다.

#### 패스 6 — `/admin` 접근 원인 추적용 디버그 추가

로컬에서 `/admin` 접근 거부 원인을 바로 확인할 수 있게
권한 계산 결과를 콘솔/메시지에 남기도록 보강했다.

#### 수정된 파일

- `src/pages/admin-page/useAdminPageController.jsx`
- `src/pages/admin-page/data.js`

#### 디버그 내용

- uid
- email
- profile raw role
- normalized role
- canAccessAdminSite
- canManageBoards / canManageRoles / canManageRoleDefinitions

#### 확인 방법

- 브라우저에서 `/admin` 진입
- DevTools console 확인
- 거부 시 `[admin-access-denied]`
- 허용 시 `[admin-access-granted]`

#### 패스 7 — `usePostComments` 추출

`usePostPageController.jsx` 에 섞여 있던 댓글 스레드 구독/포커스/답글 타깃/삭제 로직을
첫 번째 분리 훅으로 추출했다.

#### 추가된 파일

- `src/pages/post-page/usePostComments.js`

#### 수정된 파일

- `src/pages/post-page/usePostPageController.jsx`
- `src/pages/post-page/PostPageView.jsx`

#### 정리한 내용

- 댓글 실시간 구독
- 댓글 로딩 상태
- 답글 타깃 유지/정리
- focus comment 하이라이트
- 댓글 삭제
- 댓글 상태 reset

이 작업으로 PostPage controller 분해의 첫 단위가 생겼다.

#### 패스 8 — `usePostCommentMentions` 추출

`usePostPageController.jsx` 에 있던 mention 메뉴 상태/후보 로딩/적용/키보드 이동 로직을
전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/post-page/usePostCommentMentions.js`

#### 수정된 파일

- `src/pages/post-page/usePostPageController.jsx`

#### 정리한 내용

- comment mention menu 상태
- edit mention menu 상태
- mention 후보 fetch/cache
- anchor 좌표 계산
- mention 적용
- reply mention 삽입
- mention 키보드 이동/선택
- comment write 가능 여부 / edit modal 상태에 따른 menu close

이제 PostPage controller는
- comments
- mentions

두 덩어리가 훅으로 빠진 상태다.

#### 패스 9 — `usePostEditModal` 추출

`usePostPageController.jsx` 에 있던 수정 모달 상태/표 편집/저장 로직을
전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/post-page/usePostEditModal.js`

#### 수정된 파일

- `src/pages/post-page/usePostPageController.jsx`

#### 정리한 내용

- edit modal open/close 상태
- edit title/html/table rows 상태
- work-schedule 표 행/열 편집
- edit submit
- 수정 권한 오류 디버그 포함 저장 로직

이제 PostPage controller에서 빠진 큰 덩어리:
- comments
- mentions
- edit modal

#### 패스 10 — `usePostNotifications` 추출

`usePostPageController.jsx` 에 있던 댓글 작성 후 알림 fanout / mention 대상 계산 /
push relay dispatch 로직을 전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/post-page/usePostNotifications.js`

#### 수정된 파일

- `src/pages/post-page/usePostPageController.jsx`
- `src/pages/post-page/PostPageView.jsx`

#### 정리한 내용

- mention 대상 해석
- @ALL 대상 해석
- user notification 문서 생성
- fanout dedupe
- push relay dispatch
- controller에서 알림 관련 내부 구현 제거

이제 PostPage controller에서 빠진 큰 덩어리:
- comments
- mentions
- edit modal
- notifications

#### 패스 11 — `useAppBoardFeed` 추출

`useAppPageController.js` 에 있던 게시판/피드 상태와 게시글 목록 계산/페이지네이션/
댓글 수 hydrate 로직을 전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/app-page/useAppBoardFeed.js`

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- boardNavItems / boardList / selectedBoardId
- visiblePosts / commentCountByPost / listMessage / loadingPosts
- currentPage / postListViewMode
- currentBoard/currentBoardName/currentBoardRoles/currentBoardVisibility
- visiblePostById / listedPosts / paginationPages / currentPagePosts
- loadPostsForCurrentBoard
- hydrateCommentCounts

이제 AppPage controller 분해도 시작된 상태다.

#### 패스 12 — `useAppComposerState` 스캐폴드 추가

AppPage composer 분해를 위해 cover-for 입력 상태/업데이트 로직을 담는
전용 훅 스캐폴드를 추가했다.

#### 추가된 파일

- `src/pages/app-page/useAppComposerState.js`

#### 현재 상태

- 훅 파일 추가 완료
- 다음 단계에서 `useAppPageController`에 실제 연결 예정
- 이번 턴에서는 안전성을 위해 연결 전 스캐폴드만 추가
- 테스트/빌드 통과 상태 유지

#### 패스 13 — `useAppComposerState` 실제 연결

`useAppPageController.js` 안에 남아 있던 composer/cover-for 상태 및 입력 helper를
`useAppComposerState`로 실제 연결했다.

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`
- `src/pages/app-page/useAppComposerState.js`

#### 정리한 내용

- composer 상태 소유권 이전
- cover-for 날짜/시간/체험관 입력 helper 이전
- controller 내 중복 helper 제거
- composer date picker 상태/제어 이전

이제 AppPage controller에서 분리된 큰 덩어리:
- board/feed
- composer state

#### 패스 14 — `useAppComposerMentions` 추출

App composer mention 후보 로딩/메뉴 sync/선택/키보드 이동 로직을
전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/app-page/useAppComposerMentions.js`

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- composer mention candidate fetch
- mention menu open/close
- mention anchor 계산
- mention 선택 적용
- mention keyboard navigation

이제 AppPage controller에서 분리된 큰 덩어리:
- board/feed
- composer state
- composer mention behavior

#### 패스 15 — `useAppComposerActions` 추출

App composer의 실제 동작(close/reset/open/submit post)을 전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/app-page/useAppComposerActions.js`

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- closeComposer
- resetComposer
- openComposer
- submitPost
- cover-for 입력 검증
- post payload 생성
- post-create permission debug
- post-create relay dispatch

이제 AppPage controller에서 분리된 큰 덩어리:
- board/feed
- composer state
- composer mention behavior
- composer actions

#### 패스 16 — `useAppNotificationCenter` 스캐폴드 추가

알림센터/모바일푸시 상태와 파생값/토글 액션을 담는 훅 스캐폴드를 추가했다.

#### 추가된 파일

- `src/pages/app-page/useAppNotificationCenter.js`

#### 현재 상태

- 훅 파일 추가 완료
- 다음 단계에서 `useAppPageController`에 실제 연결 예정
- 이번 턴에서는 안전성을 위해 연결 전 스캐폴드만 추가
- 테스트/빌드 통과 상태 유지

#### 패스 17 — `useAppNotificationCenter` 실제 연결

AppPage controller 안에 있던 notification center state/derived/action ownership을
`useAppNotificationCenter`로 넘겼다.

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`
- `src/pages/app-page/useAppNotificationCenter.js`

#### 정리한 내용

- notification center 상태 ownership 이전
- notification prefs ownership 이전
- mobile push 상태 ownership 이전
- notification derived selectors 이전
- 읽음 처리 / 토글 / 모바일푸시 action 이전

실시간 구독 effect는 아직 controller에 남아 있지만,
state/action ownership은 훅으로 이전된 상태다.

#### 패스 18 — `useAppNotificationSync` 스캐폴드 추가

App notification/realtime subscription effect를 담는 훅 스캐폴드를 추가했다.

#### 추가된 파일

- `src/pages/app-page/useAppNotificationSync.js`

#### 현재 상태

- 훅 파일 추가 완료
- 다음 단계에서 `useAppPageController`에 실제 연결 예정
- 이번 턴에서는 안전성을 위해 연결 전 스캐폴드만 추가
- 테스트/빌드 통과 상태 유지

#### 패스 19 — `useAppNotificationSync` 실제 연결

AppPage controller 안에 남아 있던 notification/realtime subscription effect를
`useAppNotificationSync` 호출로 이전했다.

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- notification prefs ref sync
- mobile push capability check
- viewed posts sync
- push tokens sync
- notifications/prefs sync
- recent posts realtime
- recent comments realtime

이제 AppPage controller에서
notifications 쪽은 state/action + effect가 모두 분리된 상태다.

#### 패스 20 — AppPage VM 축소

`AppPageView`가 실제로 사용하지 않는 vm 필드를 controller return과 view destructuring에서 제거했다.

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`
- `src/pages/app-page/AppPageView.jsx`

#### 정리한 내용

- controller/view 계약 슬림화
- 불필요한 setter/ref/debug 값 제거
- AppPageView 읽기 난이도 완화

#### 패스 21 — `useAppNavigationPins` 추출

AppPage의 이동 핸들러와 pin 선택/일괄 고정 액션을 전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/app-page/useAppNavigationPins.js`

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- handleMovePost
- handleSelectBoard
- handleMoveHome / handleBrandTitleKeyDown
- selected pin state
- pin selection / bulk pin update

이제 AppPage controller에서
navigation/pin 쪽도 분리된 상태다.

#### 패스 22 — `useAppCalendar` 추출

AppPage의 cover calendar 상태/모달/파생 이벤트 계산을 전용 훅으로 추출했다.

#### 추가된 파일

- `src/pages/app-page/useAppCalendar.js`

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`

#### 정리한 내용

- coverCalendarCursor / selectedDate / modal state
- calendar month label
- day cell 계산
- work_schedule / cover_for 이벤트 매핑
- modal item/date text 계산

#### 패스 23 — `useAppNotificationSync` 실제 연결

AppPage controller 안의 notification/realtime subscription effect를
`useAppNotificationSync` 호출로 이전했다.

#### 수정된 파일

- `src/pages/app-page/useAppPageController.js`
- `src/pages/app-page/useAppNotificationSync.js`

#### 정리한 내용

- notification prefs ref sync
- mobile push capability sync
- viewed posts sync
- push tokens sync
- notifications/prefs sync
- recent posts realtime
- recent comments realtime

## 2. 프로젝트 큰 구조

### 앱 엔트리

- `src/main.jsx`
  - 앱 부트스트랩
  - 전역 CSS 로드
  - 테마 초기화
  - 일부 레거시 캐시/서비스워커 정리

- `src/App.jsx`
  - 라우트 엔트리
  - lazy import
  - legacy `.html` 경로 리다이렉트

### 페이지 구조 규칙

메인 구조는 아래 패턴이다.

```text
pages/*.jsx            -> thin wrapper
pages/*-page/data.js   -> 데이터 로드/부트스트랩
pages/*-page/utils.js  -> 페이지 도메인 유틸
pages/*-page/constants.js -> 페이지 상수
pages/*-page/use*Controller* -> 상태/이벤트/효과
pages/*-page/*View.jsx -> 렌더링
services/firestore/*   -> Firestore 접근 계층
```

## 3. 주요 파일 역할

### 루트

- `README.md`
  - 현재 아키텍처 설명이 가장 잘 정리된 문서
  - 다음 작업 전 다시 보면 좋음
- `AGENTS.md`
  - 작업 규칙, 검증 원칙, 리팩터링 원칙
- `package.json`
  - 실행/빌드/테스트 스크립트
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`
  - Firebase 설정/규칙/인덱스

### 공통 훅 / 공통 유틸

- `src/hooks/usePageMeta.js`
  - 페이지 title/body class 관리
- `src/hooks/useTheme.js`
  - 테마 상태, localStorage 동기화, mobile/auth 제약
- `src/lib/mobile-layout.js`
  - 모바일/compact 감지 공통 로직
- `src/lib/user-error.js`
  - 에러 메시지를 사용자 친화적으로 변환
- `src/lib/utils.js`
  - `cn()` 유틸

### legacy 계층

- `src/legacy/config.js`
  - 앱/Firebase 런타임 설정 상수
- `src/legacy/firebase-app.js`
  - Firebase SDK 초기화 + 공용 export
- `src/legacy/rbac.js`
  - 역할 권한/배지 정책
- `src/legacy/rich-editor.js`
  - Quill 런타임 wrapper
- `src/legacy/push-notifications.js`
  - 웹푸시 capability/token 발급
- `src/legacy/push-relay.js`
  - GAS relay 전송

> 이름은 legacy지만 실제로는 현재 핵심 의존성이다.

### 공통 UI

- `src/components/ui/*`
  - button/card/dialog/input/label/select/theme-toggle 등 primitive
- `src/components/editor/RichEditorToolbar.jsx`
  - 에디터 툴바
- `src/components/excel/*`
  - Excel mode 렌더링, 시트 모델, workbook 인터랙션

### AppPage

- `src/pages/AppPage.jsx`
  - thin wrapper
- `src/pages/app-page/useAppPageController.js`
  - 가장 큰 컨트롤러
  - 게시판/피드/글작성/알림/모바일푸시/엑셀모드 전부 담당
- `src/pages/app-page/AppPageView.jsx`
  - 렌더 전담이어야 하지만 import가 무겁고 VM도 큼
- `src/pages/app-page/data.js`
  - role/profile/board/post bootstrap 로직
- `src/pages/app-page/utils.js`
  - 공통 helper가 너무 많이 몰려 있음
- `src/services/firestore/app-page.js`
  - AppPage 전용 Firestore gateway

### PostPage

- `src/pages/PostPage.jsx`
  - thin wrapper
- `src/pages/post-page/usePostPageController.jsx`
  - 게시글 상세/댓글/멘션/수정/삭제/엑셀 브리지 담당
- `src/pages/post-page/PostPageView.jsx`
  - VM 렌더링
- `src/pages/post-page/data.js`
  - role/profile bootstrap
- `src/pages/post-page/utils.js`
  - HTML sanitize, work schedule parsing, notification/mention helper 등
- `src/services/firestore/post-page.js`
  - PostPage 전용 Firestore gateway

### AdminPage

- `src/pages/AdminPage.jsx`
  - thin wrapper
- `src/pages/admin-page/useAdminPageController.jsx`
  - 게시판/권한/회원등급/체험관 관리 담당
- `src/pages/admin-page/AdminPageView.jsx`
  - VM 렌더링
- `src/pages/admin-page/data.js`
  - role/profile bootstrap
- `src/pages/admin-page/utils.js`
  - role/board/user/venue helper
- `src/services/firestore/admin-page.js`
  - Admin 전용 Firestore gateway

### My Activity 페이지

- `src/pages/MyPostsPage.jsx`
  - 내가 쓴 글 목록
- `src/pages/MyCommentsPage.jsx`
  - 내가 쓴 댓글 목록
- `src/pages/my-activity/shared.jsx`
  - 두 페이지 공통 helper

### 기타 페이지

- `src/pages/LoginPage.jsx`
  - 로그인 + 비밀번호 재설정
- `src/pages/SignupPage.jsx`
  - 회원가입 + 닉네임 중복 체크
- `src/pages/NotFoundPage.jsx`
  - 404

### Firestore 공통 서비스

- `src/services/firestore/users.js`
  - user profile 읽기/쓰기/수정
- `src/services/firestore/roles.js`
  - role_definitions 로딩
- `src/services/firestore/boards.js`
  - boards 컬렉션 접근
- `src/services/firestore/posts.js`
  - posts 조회 helper
- `src/services/firestore/comments.js`
  - comments helper
- `src/services/firestore/notifications.js`
  - notifications helper

### 테스트

- `tests/routes.smoke.test.jsx`
  - 라우팅 스모크
- `tests/post-page-content-html.test.js`
  - PostPage stored HTML sanitize/render 계약
- `tests/rich-editor-transform.test.js`
  - rich editor transform 순수 함수 계약
- `tests/firestore.rules.test.js`
  - Firestore rules 계약 테스트
- `tests/my-activity-shared.test.jsx`
  - 이번 세션에서 추가한 공통 helper 회귀 테스트

## 4. 지금 가장 큰 구조적 문제

### 1) 거대 controller

- `useAppPageController.js`
- `usePostPageController.jsx`
- `useAdminPageController.jsx`

모두 너무 크다.
상태/이벤트/도메인별 custom hook 분리 필요.

### 2) data bootstrap 중복

중복 패턴:

- `loadRoleDefinitions`
- `ensureUserProfile`

위치:

- `src/pages/app-page/data.js`
- `src/pages/post-page/data.js`
- `src/pages/admin-page/data.js`

### 3) View import 과대/경계 흐림

- `src/pages/post-page/PostPageView.jsx`
- `src/pages/admin-page/AdminPageView.jsx`

프레젠테이션 컴포넌트인데 import가 과하게 무겁다.
실제로 controller로 보내도 되는 의존성이 섞여 있다.

### 4) utils 중복

- `src/pages/app-page/utils.js`
- `src/pages/post-page/utils.js`

공통 helper가 너무 많이 복제되어 있다.

## 5. 다음 리팩터링 우선순위

### 다음 추천 작업 1순위

**role/profile bootstrap 공통화**

대상:

- `src/pages/app-page/data.js`
- `src/pages/post-page/data.js`
- `src/pages/admin-page/data.js`

추천 결과물:

- `src/services/profile-bootstrap.js`
  - `loadRoleDefinitionsWithFallback(...)`
  - `ensureNormalizedUserProfile(...)`

이 작업이 좋은 이유:

- 중복이 명확함
- 로직이 거의 동일함
- controller 분해 전에 기반을 깔 수 있음

### 다음 추천 작업 2순위

**controller 분해 시작**

추천 시작점:

- `useAppPageController.js`
  - `notification`
  - `composer`
  - `board feed`
- `usePostPageController.jsx`
  - `comment mentions`
  - `edit modal`
  - `notification fanout`

### 다음 추천 작업 3순위

**utils 공통 모듈 재배치**

대상:

- `src/pages/app-page/utils.js`
- `src/pages/post-page/utils.js`

## 6. 다음 작업할 때 바로 보면 좋은 파일

1. `README.md`
2. `docs/refactor-handbook.md` ← 이 문서
3. `src/pages/app-page/data.js`
4. `src/pages/post-page/data.js`
5. `src/pages/admin-page/data.js`
6. `src/pages/app-page/useAppPageController.js`
7. `src/pages/post-page/usePostPageController.jsx`
8. `src/pages/admin-page/useAdminPageController.jsx`

## 7. 다음 세션 시작용 짧은 메모

- My activity 공통 helper 추출은 끝남
- data bootstrap 공통화 끝남
- shared forum constants 정리 끝남
- role badge UI 공통화 끝남
- admin 접근 디버그 추가됨
- usePostComments 분리 완료
- usePostCommentMentions 분리 완료
- usePostEditModal 분리 완료
- usePostNotifications 분리 완료
- useAppBoardFeed 분리 완료
- useAppComposerState 스캐폴드 추가됨
- useAppComposerState 실제 연결 완료
- useAppComposerMentions 분리 완료
- useAppComposerActions 분리 완료
- useAppNotificationCenter 스캐폴드 추가됨
- useAppNotificationCenter 실제 연결 완료
- useAppNotificationSync 스캐폴드 추가됨
- useAppNotificationSync 실제 연결 완료
- AppPage VM 축소 완료
- useAppNavigationPins 분리 완료
- useAppCalendar 분리 완료
- Post/Admin VM dead-code 정리 완료
- README 구조 정렬 완료
- 테스트/빌드 통과 상태
- firestore rules 9/9 통과
- 다음 후보는 잔여 AppPage/PostPage dead-code 축소와 문서 미세 정리
- 배포 작업은 사용자 명시 전 금지

## 8. AppPage 안정화 패스 (2026-04-14)

리팩터링 이후 `/app` 런타임에서 hook wiring 누락으로 여러 `ReferenceError`가 발생했다.
이 패스에서는 구조를 더 바꾸지 않고 **기존 refactor 산출물을 정상 연결하는 최소 수정**만 적용했다.

### 이번에 복구한 것

- `useAppComposerState` ↔ `useAppComposerMentions` ↔ `useAppComposerActions` 연결 복구
- `useAppBoardFeed`에서 필요한 setter/파생값 재연결
- `useAppNotificationCenter` ↔ `useAppNotificationSync` 상태/구독 setter 연결 복구
- `closeComposer`, `openComposer`, `submitPost`, `handleExtendSession`, `handleLogout` 복구
- `composerIsCoverForBoard`, `myPostsPage`, `myCommentsPage` 복구
- composer date picker 파생값(`selected/start/end month`) 복구
- AppPage 기본 부트스트랩 effect 복구
  - Firebase 설정 확인
  - auth 구독
  - 프로필/권한 로드
  - 게시판 로드
  - 임시 로그인 만료 카운트다운/연장
  - Rich editor mount

### 핵심 원인

분해한 hook 파일 자체보다, `useAppPageController.js`에서
- hook 인자 전달
- hook 반환값 destructuring
- controller 내부 파생값
- 기존 side-effect

가 일부 빠지면서 AppPage가 런타임에서 깨졌다.

### 이번 패스 원칙

- 새 구조는 유지
- 큰 재설계 금지
- 누락 연결만 복구
- `/app` 렌더 안정화 우선

### 검증

- `npm test` 통과
- `npm run build` 통과
- Vite dev server HMR reload 확인
- /app 런타임 추적용 `window.__appPageDebug` + `[app-page-controller-debug]` 콘솔 덤프 추가

- AppPage 임시 디버그(`window.__appPageDebug`, controller debug console dump) 제거 완료
- AppPage 겹치는 상태 정리 1차: `boardNavItems` 상태 제거, `boardList`에서 파생값으로 축소
- `pageMessage` / `listMessage`는 역할이 달라 이번 패스에서는 유지 (페이지 레벨 오류 vs 목록 레벨 메시지)
- PostPage 안정화 패스: `usePostPageController.jsx`에서 빠진 pageConstants/pageUtils 식별자 묶음 복구 및 `usePostNotifications` 인자 전달/선언 순서 정리
- 임시 디버그 정리: Route error boundary 제거, PostPage dev 디버그 패널 제거, post-load verbose debug 제거
- 회귀 방지: `tests/controller-wiring-regression.test.js` 추가 (AppPage/PostPage 핵심 hook wiring/상수 전달 누락 감지)
- 중복 점검: AppPage/PostPage 핵심 핸들러 중복 정의는 현재 확인되지 않음. `pageMessage`/`listMessage`는 역할 차이로 유지.
- Admin 임시 디버그 제거 완료
- 회귀 방지 테스트 확장: AdminPage controller utility/constants wiring 검사 추가
- dead-code cleanup: AdminPageView/PostPageView의 미사용 legacy/firebase import 제거
- AI readability comment pass: 남아 있던 무주석 source/test/script 파일에 목적/책임 중심 헤더 주석 추가
- AI readability comment pass 2: App/Post/Admin controller 내부 섹션 주석 및 View 반응형 projection 설명 주석 추가
- AI readability comment pass 3: App/Post/Admin utils 및 Firestore service 파일에 내부 섹션 경계 주석 추가
- AI readability comment pass 4: legacy/firebase-app, legacy/rich-editor, RichEditorToolbar, AppExcelWorkbook 섹션 주석 추가
- AI readability comment pass 5: lib/legacy(push/rbac) 및 남은 Firestore service 파일 섹션 주석 추가, README에 AI/새 기여자용 읽기 순서 보강
- AI 전용 안내 문서 분리: `README_AI.md` 추가 (구조, 읽기 순서, 최근 리팩터링, 주의사항, 작업 시작점 정리)
- AI readability comment pass 6: README_AI에 문제 유형별 디버깅 시작점 보강, rich-editor/excel 모델 파일 내부 섹션 주석 추가
- AI readability comment pass 7: App/Post/Admin View의 주요 JSX 블록(히어로/사이드레일/메인컬럼/모달) 목적 설명 주석 추가
- AI readability comment pass 8: hooks/ui primitive 파일 섹션 주석 추가, README_AI에 테스트 관점/주의사항 보강
- AI readability comment pass 9: README_AI에 검증 순서/흐름 요약/증상별 체크리스트 보강, thin wrapper 회귀 테스트(`tests/page-wrapper-contract.test.js`) 추가
- regression hardening: `tests/routes.smoke.test.jsx`에 `/` -> `/app` 리다이렉트와 legacy html 경로 리다이렉트 스모크 추가
- regression hardening: routes.smoke에 /me/posts, /me/comments, 전체 legacy html 경로 리다이렉트 검증 추가
- README_AI에 자주 보던 회귀 시그니처(ReferenceError, 빈 데이터, 권한 오판) 체크리스트 추가
- AI guide polish: README_AI에 권한/글쓰기/댓글/관리자 흐름과 AI 작업 체크리스트 추가
- regression hardening: routes.smoke에 unknown route -> NotFound fallback 검증 추가
- regression hardening: `tests/view-fallback-contract.test.js` 추가 (App/Post/Admin View의 핵심 메시지/fallback 바인딩 보호)
- AI guide polish: README_AI에 변경 전/후 체크리스트 추가
- AI readability comment pass 10: rich-editor payload/delta bridge 설명과 secondary excel sheet builder 공통 helper(applyHero/applyProfile/buildPagination 등) 세부 주석 추가
