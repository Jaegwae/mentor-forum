# Mentor Forum React

기존 `mentor-forum`(HTML + vanilla JS) 자유게시판 기능을 React 기반으로 마이그레이션한 프로젝트입니다.

## 포함 범위
- 로그인 (`/login`) - React 컴포넌트
- 회원가입 (`/signup`) - React 컴포넌트
- 게시글 목록/작성 (`/app`)
- 게시글 상세/댓글 (`/post`)
- 관리자 사이트 (`/admin`)
- Role/게시판 권한 정책
- 로그인 유지 + 미유지 10분 자동 로그아웃 + 연장 버튼

## 리팩토링 상태
- React Router 기반 라우팅으로 정리
- 전체 페이지(`login/signup/app/post/admin`)를 레거시 템플릿/페이지 스크립트 없이 React 컴포넌트로 전환
- UI 스택을 `Tailwind CSS + shadcn/ui 패턴 + lucide-react + framer-motion` 기반으로 정리

## 구조
- `src/App.jsx`: Router
- `src/pages/*`: React 페이지 컴포넌트
- `src/components/ui/*`: shadcn 스타일 공통 UI 컴포넌트(Button/Card/Input/Checkbox 등)
- `src/lib/utils.js`: `cn` 유틸(`clsx + tailwind-merge`)
- `src/legacy/firebase-app.js`: Firebase 공통 모듈
- `src/legacy/config.js`: 앱 공통 설정
- `src/legacy/rbac.js`: 권한/Role 유틸
- `src/legacy/rich-editor.js`: 리치 에디터 유틸
- `src/legacy/ui.js`: 공통 UI 유틸
- `src/styles/common.css`: 기존 공통 스타일
- `src/styles/design-system.css`: Tailwind 토큰/컴포넌트 레이어

## 실행
```bash
cd mentor-forum-react
npm install
npm run dev
```

## 빌드
```bash
npm run build
npm run preview
```

## 배포 메모
SPA 라우팅(`/login`, `/app`, `/post`, `/admin`)을 사용하므로, 정적 호스팅에서는 `index.html`로 rewrite 설정이 필요합니다.
`firebase.json` 예시가 포함되어 있습니다.
