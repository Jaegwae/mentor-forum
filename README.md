# 멘토포럼 Workspace (V2)

레포지토리: `https://github.com/Jaegwae/mentor-forum`

이 저장소는 두 영역을 함께 관리합니다.

- `mentor-forum-react/`: 실제 운영 중인 React + Firebase 웹앱 (현행)
- 루트의 GAS 파일(`Code.gs`, `style.html` 등): 과거/연동 레거시 자산

현재 서비스 기준 문서/개발/배포는 **`mentor-forum-react/`를 기준**으로 진행합니다.

## 1. 서비스 개요

- 운영 URL: `https://guro-mentor-forum.web.app`
- 로컬 개발 URL(기본): `http://localhost:5173` (포트 충돌 시 Vite가 자동 변경)
- 주요 목적:
  - 멘토 커뮤니티 게시판 운영
  - 역할(Role) 기반 게시판 접근 제어
  - 알림/멘션/내 활동 추적
  - 데스크톱/모바일 공통 사용성 보장

## 2. V2 핵심 변경 사항

V2는 V1 대비 "레이아웃 정돈 + 다크모드 완성도 + 게시글 맥락 유지 + 알림 가시성"을 중심으로 개선되었습니다.

### 2.1 UI/UX

- 라이트/다크 테마를 모든 주요 화면(목록/상세/글작성/알림/내 활동/관리자)에 일관 적용
- 목록 정렬 탭 단순화: `최신`, `인기`만 유지
- 모바일 카드형 목록 가독성 개선
- 모바일 햄버거 메뉴 및 패널 레이아웃 안정화
- 사용 설명서 모달을 순서형 온보딩 문서로 재작성

### 2.2 게시글 목록/상세 흐름

- 게시글 상세 진입 후 `목록으로` 복귀 시, 원래 보던 게시판 맥락 유지 강화
- 브라우저 뒤로가기 시에도 게시판 컨텍스트를 최대한 보존
- 고정 게시글은 `고정` 배지로 명확히 식별
- 새 글 `N` 배지와 댓글 수 시인성 보강

### 2.3 커뮤니케이션

- 알림센터 구조 개선
  - 전체/새 글/멘션/댓글 필터
  - 읽음 처리/모두 읽음
  - 게시판별 알림 on/off
  - 댓글 알림/멘션 알림 on/off
- 멘션 정책 정리
  - `@닉네임`: 대상 사용자 멘션 알림
  - `@all`: 관리자 계정 전용 멘션

### 2.4 사이드 패널

- 게시판 목록과 최근 댓글 영역을 분리
- 최근 댓글은 전체 댓글 기준 최신 5개를 노출 (데스크톱)
- 모바일에서는 최근 댓글 영역 비노출(의도된 단순화)

### 2.5 운영 기능

- 관리자/개발자 권한으로 게시글 상단 고정/고정해제 지원
- 일반 사용자에게는 관리 버튼 대신 `고정` 상태만 시각적으로 노출

## 3. 저장소 구조

```text
멘토용/
├─ Code.gs
├─ Docs.html
├─ JavaScriptCore.html
├─ JavaScriptData.html
├─ index.html
├─ style.html
├─ appsscript.json
├─ .clasp.json
└─ mentor-forum-react/
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
   │  ├─ components/ui/
   │  ├─ hooks/
   │  ├─ legacy/
   │  └─ styles/
   ├─ firebase.json
   ├─ firestore.rules
   ├─ firestore.indexes.json
   ├─ package.json
   └─ README.md
```

## 4. 사용자 기능 상세 가이드

아래는 실제 사용자 관점에서 "처음 접속부터 일상 사용"까지 순서대로 정리한 가이드입니다.

### 4.1 로그인/회원가입

1. `/login` 접속 후 이메일/비밀번호 입력
2. 계정이 없으면 `/signup`으로 이동
3. 회원가입 시:
   - 이메일 형식 검증
   - 닉네임 중복 확인
   - 비밀번호 강도(영문/숫자/특수문자 포함 8자 이상)
4. 가입 완료 후 이메일 인증 메일 확인
5. 인증 완료 후 로그인 가능

#### 로그인 상태 유지 옵션

- 체크 시: 로그인 상태를 지속
- 미체크 시: 임시 세션(자동 로그아웃 타이머 적용)
- 임시 세션 사용 중에는 연장 버튼으로 세션 갱신 가능

### 4.2 게시판 탐색

1. 좌측 게시판 목록에서 게시판 선택
2. 선택 즉시 목록이 해당 게시판 기준으로 갱신
3. URL은 `?boardId=...` 형태로 동기화되어 공유/복구 가능
4. 모바일에서는 햄버거 메뉴에서 동일 기능 제공

### 4.3 게시글 목록 읽기

- 정렬: `최신`, `인기`
- 표시 요소:
  - 게시글 번호
  - 제목
  - 작성자/역할 배지
  - 날짜
  - 댓글 수
  - 게시판명
- 상태 배지:
  - `N`: 새 글
  - `고정`: 상단 고정 글
  - 대체근무 상태(구하는 중/완료/취소)

### 4.4 글 작성

1. 먼저 게시판을 선택
2. `글쓰기` 버튼 클릭
3. 제목/본문 입력
4. `글 등록` 클릭

주의:

- `전체 게시글` 화면에서는 작성하지 않고, 실제 게시판 화면에서 작성

### 4.5 대체근무(cover_for) 작성

`cover_for` 게시판에서는 일반 글과 달리 근무 정보를 함께 입력합니다.

- 날짜
- 시작/종료 시간
- 구분/체험관 정보
- 필요 시 여러 날짜 블록 등록

등록 후 목록/상세에서 상태(구하는 중/완료/취소)를 확인할 수 있습니다.

### 4.6 게시글 상세/댓글

1. 목록에서 제목 클릭
2. 상세에서 본문 확인
3. 댓글 작성/등록
4. 필요 시 수정/삭제(권한 조건 충족 시)
5. `목록으로`를 누르면 기존 게시판 문맥으로 복귀

### 4.7 멘션

- `@닉네임`: 해당 사용자에게 멘션 알림
- `@all`: 관리자 전용

### 4.8 알림센터

알림센터에서는 다음 작업을 수행할 수 있습니다.

- 최신 알림 확인
- 필터 전환: 전체/새 글/멘션/댓글
- 모두 읽음 처리
- 댓글 알림 on/off
- 멘션 알림 on/off
- 게시판별 알림 on/off

### 4.9 내가 쓴 글 / 내가 쓴 댓글

- `/me/posts`: 작성 글 목록
- `/me/comments`: 작성 댓글 목록
- 목록 항목 클릭 시 원본 게시글로 이동
- 댓글 페이지는 게시글 제목/게시판/작성일을 함께 보여줌

### 4.10 최근 댓글 패널

- 전체 댓글에서 최신 5개를 노출
- 클릭하면 해당 게시글로 이동
- 모바일에서는 화면 단순화를 위해 숨김 처리

### 4.11 테마 전환

- 상단 토글로 라이트/다크 모드 전환
- 로그인/회원가입/글목록/상세/모달/관리자 페이지까지 일관 적용

## 5. 운영 기능 상세 (관리자/개발자)

### 5.1 관리자 사이트

- 경로: `/admin`
- 접근: 권한 계정 전용
- 역할/게시판/운영 설정 관리

### 5.2 상단 고정

- 게시판 단위로 상단 고정/해제
- 전체 게시글 뷰에서는 관리 액션 제한
- 일반 사용자에게는 `고정` 배지만 표시

## 6. 역할/권한 요약

실제 판정은 `mentor-forum-react/firestore.rules` + 클라이언트 가드 로직을 함께 따릅니다.

기본 역할 키:

- `Newbie`
- `Mentor`
- `Staff`
- `Admin`
- `Super_Admin`

핵심 원칙:

- 역할별 게시판 접근 가능 여부가 다름
- 관리자 사이트는 관리자 권한 이상만 접근
- 고정/운영 액션은 관리자 계층만 수행
- `@all` 멘션은 관리자 계층 전용

## 7. 데이터 모델 요약

주요 컬렉션:

- `users`
- `posts`
- `boards`
- `role_definitions`
- `nickname_index`
- `venue_options`
- `posts/{postId}/comments`
- `users/{uid}/notifications`
- `users/{uid}/notification_prefs`
- `users/{uid}/viewed_posts`

### 7.1 posts 주요 필드(예시)

- `title`, `content`, `contentText`
- `boardId`, `boardName`
- `authorUid`, `authorName`
- `createdAt`, `updatedAt`
- `views`
- `deleted`
- `isPinned`, `pinnedAt`, `pinnedBy`
- 대체근무 전용 필드(날짜/시간/상태)

### 7.2 comments 주요 필드(예시)

- `postId`
- `authorUid`, `authorName`
- `content`, `contentText`
- `createdAt`, `updatedAt`
- 멘션 파싱/알림 생성에 필요한 메타

## 8. 기술 스택

프론트엔드:

- React 18
- React Router
- Tailwind CSS + shadcn/ui 패턴
- framer-motion
- lucide-react
- Quill 기반 리치 에디터

백엔드(BaaS):

- Firebase Authentication
- Cloud Firestore
- Firebase Hosting

## 9. 로컬 개발

### 9.1 요구사항

- Node.js 18+
- npm
- (선택) Firebase CLI

### 9.2 설치/실행

```bash
cd mentor-forum-react
npm install
npm run dev
```

### 9.3 빌드/프리뷰

```bash
npm run build
npm run preview
```

### 9.4 개발 시 점검 체크리스트

- 로그인/로그아웃 정상 동작
- 게시판 선택 후 URL 동기화 확인
- 상세 진입 후 복귀 시 게시판 유지 확인
- 다크/라이트 전환 시 대비 이슈 없는지 확인
- 모바일(좁은 너비)에서 메뉴/목록 깨짐 여부 확인
- 최근 댓글 카드 클릭 이동 확인

## 10. 배포 (Firebase)

`.firebaserc` 없이 프로젝트 ID를 명시해 배포할 수 있습니다.

```bash
cd mentor-forum-react
./node_modules/.bin/firebase deploy --only hosting --project guro-mentor-forum
```

Rules 포함:

```bash
./node_modules/.bin/firebase deploy --only hosting,firestore:rules --project guro-mentor-forum
```

배포 후 확인:

- `https://guro-mentor-forum.web.app/app`
- 로그인/게시판 이동/상세/알림센터 빠른 스모크 테스트

## 11. GitHub 반영 절차

현재 git 루트는 상위 폴더 `멘토용`입니다.

```bash
cd /mnt/c/Users/kimjk/Desktop/VSCode/멘토용

git status
git add -A
git commit -m "docs: update README for V2 and annotate key flows"
git push origin main
```

원격 선행 커밋이 있어 push 거절 시:

```bash
git pull --rebase origin main
git push origin main
```

## 12. 트러블슈팅

### 12.1 `'vite' is not recognized`

원인:

- 의존성 미설치 또는 설치 실패

해결:

```bash
cd mentor-forum-react
npm install
npm run dev
```

### 12.2 상세에서 목록 복귀 시 전체 게시글로 이동

원인 후보:

- `boardId`/`fromBoardId`/state 동기화 누락

대응:

- 상세 진입 시 `fromBoardId`를 함께 전달
- `backBoardId` 계산 우선순위를 post 실제 `boardId` 중심으로 유지

### 12.3 최근 댓글이 보이지 않음

원인 후보:

- 레거시 데이터의 timestamp/board 식별값 불일치

대응:

- ordered query + fallback query 사용
- strict boardId + loose identity 매칭 병행

### 12.4 모바일에서 사이드 패널 겹침

원인 후보:

- sticky 레이아웃 중첩

대응:

- 사이드 영역 분리
- 내부 sticky 중복 제거
- 오버플로우/스크롤 컨테이너 재정렬

## 13. V2 릴리즈 노트

### V2.0

- 포럼 메인/상세/글쓰기/내 활동 UI 리디자인
- 다크모드 일괄 개선
- 모바일 레이아웃 보강

### V2.1

- 최근 댓글 패널 도입
- 정렬 탭 단순화(최신/인기)
- 고정 배지 노출 개선

### V2.2

- 상세 복귀/브라우저 뒤로가기 맥락 유지 강화
- 알림센터 사용성 개선
- 사용 설명서 문서화 강화

## 14. 참고 문서

- React 앱 상세 문서: `mentor-forum-react/README.md`
- 라우터 구성: `mentor-forum-react/src/App.jsx`
- 권한 정책: `mentor-forum-react/firestore.rules`
- 메인 게시판 페이지: `mentor-forum-react/src/pages/AppPage.jsx`
- 게시글 상세 페이지: `mentor-forum-react/src/pages/PostPage.jsx`
