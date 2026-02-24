# Mentor Forum React (V2)

멘토포럼의 React + Firebase 기반 프론트엔드/운영 앱입니다.  
이 디렉터리(`mentor-forum-react/`)가 실제 서비스 배포 단위입니다.

## 1. 프로젝트 개요

멘토포럼은 멘토/운영진 커뮤니티를 위한 게시판 서비스입니다.

- 역할(Role) 기반 접근 제어
- 게시글/댓글/멘션/알림 중심 커뮤니케이션
- 라이트/다크 모드 + 모바일/데스크톱 대응
- Firebase Hosting + Firestore 기반 운영
- Firebase Functions 없이 GAS 릴레이로 모바일 푸시 지원

## 2. 최근 반영 사항 (최신)

- 멘토포럼 UI/레이아웃 V2 리디자인(라이트/다크)
- 게시판 좌측 내비 + 최근 댓글 패널 분리
- 게시글 목록 가독성 개선 (N 배지, 댓글 수 강조, 고정 배지)
- 게시글 상세/내가 쓴 글/내가 쓴 댓글 페이지 구조 통일
- 관리자 상단고정(핀) 기능 반영
- 모바일 알림(PWA + FCM + GAS Relay) 연동
- iOS 중복 알림/빈 본문 알림 이슈 보정
- 알림 fanout 로직 보정(토큰/환경별 skip 처리 개선)
- GAS 릴레이의 `relay_debug` Firestore 저장 코드 제거

## 3. 라우트

- `/login`: 로그인
- `/signup`: 회원가입
- `/app`: 메인 게시판
- `/post`: 게시글 상세
- `/me/posts`: 내가 쓴 글
- `/me/comments`: 내가 쓴 댓글
- `/admin`: 관리자 사이트

레거시 URL도 리다이렉트 처리합니다.

- `/login.html` -> `/login`
- `/signup.html` -> `/signup`
- `/app.html` -> `/app`
- `/post.html` -> `/post`
- `/admin.html` -> `/admin`

## 4. 기능 상세

### 4.1 게시판/목록

- 게시판 선택 시 URL `?boardId=...` 동기화
- 정렬 탭: `최신`, `인기`
- 새 글 `N` 배지 노출
- 댓글 수 강조 색상
- 상단 고정 게시글 `고정` 배지
- 대체근무 게시글 상태(완료/취소) 시각 구분

### 4.2 게시글 상세/복귀

- 상세 진입 시 게시판 컨텍스트 보존
- `목록으로`/브라우저 뒤로가기 시 원래 게시판 복귀 우선
- 댓글 작성/수정/삭제 흐름 일관화

### 4.3 멘션/알림센터

- `@닉네임` 멘션 알림
- `@all` 멘션은 관리자 전용
- 알림센터:
  - 필터(전체/새 글/멘션/댓글)
  - 모두 읽음
  - 게시판별 알림 on/off
  - 댓글/멘션 알림 on/off

### 4.4 모바일 푸시 알림

- Firebase Cloud Messaging(Web Push) 기반
- iOS Safari PWA, Android Chrome 지원
- 게시판별 모바일 알림 수신 선택
- 활성 토큰 상태 표시(지원/권한/활성기기)

### 4.5 내 활동

- 내가 쓴 글 목록
- 내가 쓴 댓글 목록
- 클릭 시 원문 게시글 이동

### 4.6 최근 댓글

- 데스크톱 좌측 패널에서 최신 5개 댓글 표시
- 클릭 시 해당 게시글 상세 이동
- 모바일에서는 비노출(의도된 정책)

## 5. 기술 스택

- React 18 + Vite
- Firebase Auth / Firestore / Hosting / FCM
- React Router
- Tailwind + 커스텀 디자인 시스템 CSS
- Quill 기반 리치에디터
- Framer Motion

## 6. 폴더 구조

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
│  ├─ components/ui/
│  ├─ hooks/
│  ├─ legacy/
│  │  ├─ config.js
│  │  ├─ firebase-app.js
│  │  ├─ push-notifications.js
│  │  ├─ push-relay.js
│  │  ├─ rich-editor.js
│  │  └─ rbac.js
│  └─ styles/design-system.css
├─ public/
│  └─ firebase-messaging-sw.js
├─ scripts/gas-push-relay/
│  ├─ Code.gs
│  └─ README.md
├─ firebase.json
├─ firestore.rules
├─ firestore.indexes.json
├─ package.json
└─ README.md
```

## 7. 로컬 실행

### 7.1 요구사항

- Node.js 18 이상 권장
- npm 9 이상 권장

### 7.2 설치

```bash
npm install
```

### 7.3 개발 서버

```bash
npm run dev
```

### 7.4 빌드/프리뷰

```bash
npm run build
npm run preview
```

## 8. 환경변수

프로젝트 루트(`mentor-forum-react/`)에 `.env.local` 생성:

```bash
VITE_PUSH_RELAY_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
VITE_FIREBASE_MESSAGING_VAPID_KEY=YOUR_VAPID_KEY
```

- `VITE_PUSH_RELAY_URL`: GAS 웹앱 URL
- `VITE_FIREBASE_MESSAGING_VAPID_KEY`: Firebase Cloud Messaging 웹 푸시 VAPID 키

## 9. 배포

### 9.1 Hosting 배포

```bash
./node_modules/.bin/firebase deploy --only hosting --project guro-mentor-forum
```

### 9.2 Hosting + Rules 배포

```bash
./node_modules/.bin/firebase deploy --only hosting,firestore:rules --project guro-mentor-forum
```

## 10. 모바일 푸시 아키텍처 (GAS 릴레이)

Blaze 기반 Functions 없이 푸시를 보내기 위해, GAS를 릴레이로 사용합니다.

동작 흐름:

1. 앱에서 알림 문서 생성(새 글/댓글/멘션)
2. 클라이언트가 GAS로 `idToken + 이벤트 정보` 전송
3. GAS가 ID 토큰 검증
4. Firestore에서 수신 대상/환경설정/토큰 확인
5. FCM HTTP v1로 푸시 발송
6. 브라우저 SW(`firebase-messaging-sw.js`)가 표시 처리

상세 설치는 `scripts/gas-push-relay/README.md` 참고.

## 11. 사용자 가이드: iOS/Android 알림 받기

### 11.1 iOS (iPhone, Safari)

iOS 웹푸시는 반드시 **Safari + 홈 화면 추가(PWA 실행)** 조건이 필요합니다.

1. iPhone Safari에서 포럼 접속
2. Safari 공유 버튼 -> `홈 화면에 추가`
3. 홈 화면 아이콘으로 포럼 실행
4. 로그인 후 `내 정보 -> 모바일 알림`
5. `모바일 알림 켜기` 클릭
6. iOS 권한 팝업에서 `허용`
7. 상태 값 확인
   - 기기 지원 = 지원됨
   - 알림 권한 = 허용
   - 활성 기기 = 1대 이상
8. 게시판별 모바일 알림에서 원하는 게시판 ON
9. 다른 계정으로 테스트 글/댓글/멘션 발생시켜 수신 확인

iOS 점검 포인트:

- Safari 탭에서 실행하면 수신 불가 (홈 화면 앱으로 실행 필요)
- 설정 -> 알림에서 포럼 앱 허용 여부 확인
- 집중 모드/방해금지/저전력 모드 확인
- 앱 재실행 후 다시 테스트

### 11.2 Android (Chrome)

1. Android Chrome에서 포럼 접속
2. 로그인 후 `내 정보 -> 모바일 알림`
3. `모바일 알림 켜기` 클릭
4. 알림 권한 팝업 `허용`
5. 상태 값 확인
   - 기기 지원 = 지원됨
   - 알림 권한 = 허용
   - 활성 기기 = 1대 이상
6. 게시판별 모바일 알림 ON
7. 다른 계정으로 테스트 이벤트 발생 후 수신 확인

Android 점검 포인트:

- Chrome 사이트 알림 권한 허용
- OS 앱 알림 허용
- 배터리 최적화 예외(필요 시)
- 홈 화면 추가(PWA)로 사용하면 안정성 향상

## 12. 알림/데이터 운영 참고

- 게시글/댓글을 지워도 기존 알림 문서는 별도로 남을 수 있습니다.
- 알림만 비우려면 알림 컬렉션(`users/{uid}/notifications`) 정리가 필요합니다.
- `notification_prefs`는 사용자 알림 설정값이므로, 설정을 유지하려면 삭제하지 않습니다.

## 13. 체크리스트 (배포 전)

- 로그인/회원가입 정상 동작
- 게시판 이동 -> 상세 -> 목록 복귀 정상
- 라이트/다크 테마 주요 화면 확인
- 모바일 메뉴/리스트/모달 깨짐 확인
- 최근 댓글 5개 노출/클릭 이동 확인
- 모바일 푸시(iOS/Android) 수신 테스트

## 14. 관련 문서

- GAS 푸시 릴레이 설치 문서: `scripts/gas-push-relay/README.md`
- 메인 페이지: `src/pages/AppPage.jsx`
- 상세 페이지: `src/pages/PostPage.jsx`
- 권한 유틸: `src/legacy/rbac.js`
- Firestore Rules: `firestore.rules`
