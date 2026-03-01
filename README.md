# 멘토스 Workspace

레포지토리: [Jaegwae/mentor-forum](https://github.com/Jaegwae/mentor-forum)

이 저장소는 **2개 운영 영역**을 함께 관리합니다.

| 영역 | 경로 | 역할 | 현재 운영 기준 |
|---|---|---|---|
| React 웹앱(멘토스) | `mentor-forum-react/` | 멘토스 커뮤니티 서비스(게시판/댓글/관리자/테마) | ✅ 운영 중 |
| GAS 이슈관리 시스템(스프레드시트 기반) | 루트 (`Code.gs`, `index.html` 등) | 교구/이슈 접수·조회 운영 화면 + 멘토스 진입 버튼 제공 | ✅ 운영 중 |

## 운영 URL
- 멘토포럼 : [https://guro-mentor-forum.web.app](https://guro-mentor-forum.web.app)
- 이슈 관리 시트 : [구로 이슈 관리 시트](https://script.google.com/macros/s/AKfycbxyr-Ml5t99Ykf-uVlJbXNijXDbTQJdbDpNMzIGtZrkx64VJUOxIgjrWrNumeKskO5u/exec)
- Firebase 프로젝트: `guro-mentor-forum`

## 운영 흐름
- GAS 이슈관리 시스템에서 이슈 등록/조회/관리 업무를 수행합니다.
- GAS 화면의 `멘토스` 버튼을 누르면 별도 운영 중인 React 멘토스으로 이동합니다.
  - 코드 기준: `JavaScriptCore.html`의 `openMentorForum()` → `https://guro-mentor-forum.web.app/app`

---

## 1. 최근 주요 변경(요약)

### UI/테마
- 테마 3단계 순환: `라이트 → 다크 → 엑셀 → 라이트`
- 엑셀 모드 강화
  - 상단 리본/수식바/시트탭/상태바 반영
  - `/app`은 Jspreadsheet CE 기반 셀 UI 적용

### 성능/보안
- 사용자 화면의 내부 디버그 문자열 노출 제거(요약 오류만 노출)
- `/me/posts` 조회 최적화
  - `where(authorUid) + orderBy(createdAt) + limit + startAfter`
- `/me/comments` 최적화
  - cursor 페이지네이션
  - 게시글 hydrate N+1 제거(`documentId() in (...)` 청크 조회)
- 관리자 게시판 순서 저장 최적화
  - 순차 저장 → `writeBatch` 청크 커밋
- Firestore 인덱스 정리
  - `comments(authorUid, createdAt)`
  - `posts(authorUid, createdAt)`
  - `posts(boardId, createdAt)`

### 의존성 보안 업데이트
- `firebase@12.9.0`, `vite@7.3.1`, `quill@2.0.2` 반영
- `npm audit`: `0 vulnerabilities`

---

## 2. 워크스페이스 구조

```text
mentor-forum/
├─ README.md
├─ Code.gs
├─ appsscript.json
├─ index.html
├─ style.html
├─ Docs.html
├─ JavaScriptCore.html
├─ JavaScriptData.html
└─ mentor-forum-react/
   ├─ src/
   ├─ public/
   ├─ scripts/gas-push-relay/
   ├─ firebase.json
   ├─ firestore.rules
   ├─ firestore.indexes.json
   ├─ package.json
   └─ README.md
```

---

## 3. 어떤 README를 먼저 보면 되나?

- 전체 구조/역할 확인: **이 문서(루트 README)**
- 실제 웹앱 개발/실행/배포: [`mentor-forum-react/README.md`](./mentor-forum-react/README.md)
- GAS 푸시 릴레이 설치: [`mentor-forum-react/scripts/gas-push-relay/README.md`](./mentor-forum-react/scripts/gas-push-relay/README.md)

---

## 4. 루트 GAS 운영 파일 설명

루트 파일들은 실제 운영 중인 스프레드시트+GAS 이슈관리 시스템 코드입니다.

- `Code.gs`
  - GAS 웹앱 엔트리(`doGet`) 및 시트 입출력/검증/리치텍스트 처리
  - 이슈 데이터 저장, 이미지 업로드, 조회/가공 로직
- `index.html`, `style.html`, `Docs.html`, `JavaScriptCore.html`, `JavaScriptData.html`
  - 이슈관리 UI(탭/폼/조회/상세/문서)와 클라이언트 동작
  - `openMentorForum()`을 통해 멘토스(React) 이동 제공
- `appsscript.json`, `.clasp.json`
  - GAS 프로젝트 메타데이터

주의:
- GAS와 React 앱은 목적이 다르며 함께 운영됩니다.
- React 앱 개발/배포는 `mentor-forum-react/` 기준으로 진행합니다.

---

## 5. React 앱 빠른 시작

```bash
cd mentor-forum-react
npm install
npm run dev
```

빌드:

```bash
npm run build
npm run preview
```

---

## 6. 배포

루트가 git 루트이므로, 배포 명령은 React 앱 디렉터리에서 실행합니다.

```bash
cd mentor-forum-react
npx firebase deploy --only hosting,firestore:rules,firestore:indexes --project guro-mentor-forum
```

---

## 7. GitHub 반영(루트 기준)

```bash
git status
git add -A
git commit -m "docs: refresh workspace and app README"
git push origin <branch>
```

---

## 8. 참고 링크
- 서비스 콘솔: [Firebase Console](https://console.firebase.google.com/project/guro-mentor-forum/overview)
- 앱 README: [`mentor-forum-react/README.md`](./mentor-forum-react/README.md)
- GAS 푸시 릴레이 문서: [`mentor-forum-react/scripts/gas-push-relay/README.md`](./mentor-forum-react/scripts/gas-push-relay/README.md)
