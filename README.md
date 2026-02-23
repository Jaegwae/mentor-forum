# 멘토용 Workspace

레포지토리: `https://github.com/Jaegwae/mentor-forum`

이 저장소는 다음 두 작업물을 함께 관리합니다.

1. Google Apps Script 기반 파일 세트 (`Code.gs`, `appsscript.json` 등)
2. React + Firebase 기반 웹앱 (`mentor-forum-react/`)

## V1 포함 기능

### 사용자 기능
- 로그인 / 회원가입
- 게시판 탐색 및 게시글 목록 조회
- 게시글 작성/조회/댓글 작성
- 내가 쓴 글 / 내가 쓴 댓글 모아보기
- 알림 센터(새 글, 댓글, 멘션)
- 라이트/다크 모드 전환
- 사용 설명서 모달
- 로그인 유지 옵션 + 미선택 시 자동 로그아웃(연장 버튼 포함)

### 운영/권한 기능
- 역할(Role) 기반 접근 제어
- 게시판별 권한 정책
- 관리자 사이트(권한 계정 전용)
- Firestore Rules 기반 데이터 접근 제어

### 특화 기능
- `cover_for` 게시판의 대체근무 요청 작성(날짜/시간/체험관 입력)

## 저장소 구조

```text
멘토용/
├─ Code.gs
├─ Docs.html
├─ JavaScriptCore.html
├─ JavaScriptData.html
├─ index.html
├─ mentorforum.html
├─ style.html
├─ appsscript.json
├─ .clasp.json
└─ mentor-forum-react/
   ├─ src/
   ├─ firebase.json
   ├─ firestore.rules
   ├─ package.json
   └─ ...
```

## 시작하기

### 저장소 받기

```bash
git clone https://github.com/Jaegwae/mentor-forum.git
cd mentor-forum
```

### 변경사항 저장 기본 흐름

```bash
git add .
git commit -m "작업 내용"
git push
```

## React 웹앱 실행 (`mentor-forum-react`)

```bash
cd mentor-forum-react
npm install
npm run dev
```

### 빌드

```bash
npm run build
npm run preview
```

### Firebase 배포

```bash
firebase deploy --only hosting,firestore:rules --project guro-mentor-forum
```

## Apps Script 메모

- Apps Script 메타 정보는 `appsscript.json`, `.clasp.json`에 있습니다.
- `clasp` 사용 시 프로젝트 설정(`scriptId`)은 `.clasp.json`을 통해 연결됩니다.

## 보안 주의

- 비밀번호, 토큰, 서비스 계정 키(JSON private key)는 커밋하지 마세요.
- Firebase 웹 설정값(`apiKey`, `projectId` 등)은 공개값이지만, 실제 보안은 Firestore Rules/인증 정책으로 관리됩니다.
