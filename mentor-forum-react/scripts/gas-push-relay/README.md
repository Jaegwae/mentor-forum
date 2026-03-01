# GAS Push Relay (Firebase Blaze 없이 모바일 푸시)

이 폴더의 `Code.gs`는 **별도 Google Apps Script 프로젝트**에 넣어서 사용합니다.

## 1) 새 GAS 프로젝트 생성
1. `https://script.new` 접속
2. 프로젝트 이름 예: `mentor-forum-push-relay`
3. 기본 코드 삭제 후 `Code.gs` 내용 전체 붙여넣기

## 2) 스크립트 속성 설정
GAS 편집기에서 `프로젝트 설정 > 스크립트 속성`에 아래 키를 추가합니다.

- `FIREBASE_PROJECT_ID`  
  예: `guro-mentor-forum`
- `FIREBASE_WEB_API_KEY`  
  Firebase 웹앱 `apiKey` 값
- `GCP_SA_CLIENT_EMAIL`  
  푸시 릴레이용 서비스계정 이메일
- `GCP_SA_PRIVATE_KEY`  
  서비스계정 private key (JSON의 `private_key`)  
  줄바꿈은 그대로 붙여넣거나 `\n` 형태로 넣어도 코드에서 처리합니다.

## 3) 서비스계정 권한
Google Cloud IAM에서 서비스계정에 최소 아래 권한을 부여합니다.

- `Cloud Datastore User` (Firestore 읽기/삭제)
- `Firebase Cloud Messaging API Admin` (FCM 발송)

서비스계정 키(JSON) 생성 후 `client_email`, `private_key`를 위 속성에 넣습니다.

## 4) GAS 웹앱 배포
1. 우측 상단 `배포 > 새 배포`
2. 유형: `웹 앱`
3. 실행 사용자: `나`
4. 액세스 권한: `모든 사용자`
5. 배포 후 `웹 앱 URL` 복사

## 5) React 앱 환경변수
`mentor-forum-react/.env.local`에 아래 추가:

```bash
VITE_PUSH_RELAY_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec
VITE_FIREBASE_MESSAGING_VAPID_KEY=YOUR_VAPID_KEY
```

그 다음:

```bash
npm run build
```

## 6) 동작 방식
1. 댓글/멘션 알림 문서가 Firestore에 생성됨
2. 클라이언트가 GAS에 `idToken + targetUid + notificationId` 전달
3. GAS가 토큰 검증 후 Firestore에서 알림/설정/푸시토큰 읽음
4. 허용된 경우 FCM 푸시 발송

## 7) 근무일정 서버 스케줄 푸시 (전날/당일)
확장프로그램은 근무표 동기화만 수행하고, 근무일정 푸시는 이 GAS가 서버 트리거로 발송합니다.

1. GAS 편집기에서 `runWorkScheduleTomorrowReminder`, `runWorkScheduleTodayReminder` 함수가 있는지 확인
2. 최초 1회 `setupWorkScheduleReminderTriggers()` 수동 실행
3. 생성되는 트리거
   - `runWorkScheduleTomorrowReminder`: 매일 `21:00` (전날 알림)
   - `runWorkScheduleTodayReminder`: 매일 `08:30` (당일 알림)
4. 해제가 필요하면 `clearWorkScheduleReminderTriggers()` 실행

동작 조건:
- `work_schedule` 게시글의 `workScheduleRows`에서 대상 날짜를 조회
- 사용자 `realName`이 `풀타임/파트1/파트2/파트3/교육`에 매칭될 때만 알림 생성
- `pref_work_schedule_shift_alert`가 `false`면 제외
- 모바일 푸시 글로벌/게시판 토글이 꺼져 있으면 푸시는 제외

## 8) 참고
- iPhone은 `Safari + 홈 화면에 추가(PWA)` 환경에서만 웹푸시 수신 가능
- GAS 웹앱은 브라우저 CORS 제약 때문에 클라이언트에서 `no-cors` 전송으로 처리
- 현재 스크립트는 `relay_debug` 컬렉션에 별도 디버그 로그를 저장하지 않음(실행 로그/콘솔 로그 기준 확인)
