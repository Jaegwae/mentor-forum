/*
  Code.gs
  ============================================================================
  [역할]
  - Google Apps Script 서버 사이드 진입점
  - 시트 입출력/리치텍스트 변환/이미지 업로드/캐시 관리 담당

  [주요 시트]
  1) 근무일지: 작성/조회 원본 데이터
  2) 공지사항: 공지 목록/상세 데이터
  3) (외부) 교구 집계 시트: 교구 확인 탭 데이터 소스

  [핵심 포인트]
  - processForm(): 문서락(LockService)으로 동시 제출 충돌 방지
  - getResultsSummaryData()/getNoticeData(): 단기 캐시로 응답 시간 단축
  - getResultDetailData(): 상세 모달 진입 시 단건 리치 데이터 조회
  - richTextToHtml_(): 시트 RichText를 HTML로 직렬화해 클라이언트 렌더
  - buildIssueDetailsRichText_(): 클라이언트 run JSON을 시트 RichText로 복원
*/

// ===== 시스템 상수 =====
// 이미지 업로드 폴더 및 캐시 키/TTL 설정
var ISSUE_IMAGE_FOLDER_NAME = "이슈관리_사진";
var ISSUE_IMAGE_FOLDER_ID_KEY = "issue_image_folder_id";
var ISSUE_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
var ISSUE_IMAGE_ALLOWED_MIME = {
  "image/jpeg": true,
  "image/png": true,
  "image/gif": true,
  "image/webp": true
};
var ISSUE_IMAGE_ALLOWED_EXT = {
  "jpg": true,
  "jpeg": true,
  "png": true,
  "gif": true,
  "webp": true
};
var EQUIPMENT_CHECK_CACHE_KEY = "equipment_check_data_v1";
var EQUIPMENT_CHECK_CACHE_TTL_SEC = 120;
var RESULTS_DATA_CACHE_KEY = "results_data_v2";
var RESULTS_DATA_CACHE_TTL_SEC = 30;
var RESULTS_WINDOW_CURSOR_KEY = "results_window_cursor_v1";
var ISSUE_APPEND_NEXT_ROW_KEY = "issue_append_next_row_v1";
var NOTICE_DATA_CACHE_KEY = "notice_data_v2";
var NOTICE_DATA_CACHE_TTL_SEC = 120;

// 근무일지 시트 헤더명 표준 정의
var ISSUE_HEADERS = {
  date: "이슈 발생 날짜",
  createdAt: "이슈 작성 일자",
  author: "이슈 작성자",
  subject: "구분",
  itemName: "품명",
  serial: "주기번호",
  details: "이슈내용",
  image: "이미지",
  actionOwner: "조치담당자",
  actionDone: "조치완료일",
  actionContent: "조치내용",
  repairPlace: "수리장소",
  repairDate: "수리날짜",
  repairFlag: "수리여부"
};

function getHeaderMap_(sheet) {
  // 1행 헤더를 읽어 "헤더명 -> 컬럼 인덱스" 매핑 생성
  var lastColumn = sheet.getLastColumn();
  if (lastColumn <= 0) return { map: {}, headers: [] };
  var headerRow = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var map = {};
  var headers = [];
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || "").trim();
    headers.push(h);
    if (h) map[h] = i;
  }
  return { map: map, headers: headers };
}

/**
 * 단일 컬럼 기준 마지막 실제 데이터 행을 찾는다.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} col
 * @param {number} startRow
 * @returns {number} 마지막 데이터 행 (없으면 startRow-1)
 */
function findLastDataRowByColumn_(sheet, col, startRow) {
  var usedLastRow = sheet.getLastRow();
  if (usedLastRow < startRow) return startRow - 1;
  var scanCount = usedLastRow - startRow + 1;
  var values = sheet.getRange(startRow, col, scanCount, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var cell = values[i][0];
    if (cell !== "" && cell !== null) return startRow + i;
  }
  return startRow - 1;
}

/**
 * 근무일지 append 목표 행을 계산한다.
 * - ScriptProperties 커서가 유효하면 즉시 사용
 * - 커서가 어긋났으면 createdAt 컬럼 역탐색으로 폴백
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} createdAtCol
 * @returns {number}
 */
function getIssueAppendTargetRow_(sheet, createdAtCol) {
  var props = PropertiesService.getScriptProperties();
  var cursorRaw = props.getProperty(ISSUE_APPEND_NEXT_ROW_KEY);
  var candidate = Math.floor(Number(cursorRaw));
  if (isFinite(candidate) && candidate >= 2 && candidate <= sheet.getMaxRows()) {
    var currentCell = sheet.getRange(candidate, createdAtCol).getValue();
    var prevCell = (candidate <= 2) ? "__HEAD__" : sheet.getRange(candidate - 1, createdAtCol).getValue();
    var isCurrentEmpty = (currentCell === "" || currentCell === null);
    var isPrevFilled = (candidate <= 2) || !(prevCell === "" || prevCell === null);
    if (isCurrentEmpty && isPrevFilled) {
      return candidate;
    }
  }

  var lastDataRow = findLastDataRowByColumn_(sheet, createdAtCol, 2);
  return lastDataRow + 1;
}

/**
 * 근무일지 append 다음 행 커서를 저장한다.
 * @param {number} nextRow
 */
function saveIssueAppendNextRow_(nextRow) {
  var n = Math.max(2, Math.floor(Number(nextRow) || 2));
  try {
    PropertiesService.getScriptProperties().setProperty(ISSUE_APPEND_NEXT_ROW_KEY, String(n));
  } catch (e) {}
}

/**
 * 조회/공지 단기 캐시 무효화.
 * 저장 직후 stale 데이터 노출을 막기 위해 사용한다.
 */
function clearRuntimeCaches_() {
  // 작성 저장 직후 "조회/공지 캐시"를 즉시 비워 stale 데이터 노출 방지
  var cache = CacheService.getScriptCache();
  cache.remove(RESULTS_DATA_CACHE_KEY);
  cache.remove(NOTICE_DATA_CACHE_KEY);
}

/**
 * 공용 조회 캐시 워밍업.
 * 시간기반 트리거에서 호출해 첫 사용자 요청 지연을 줄인다.
 * @returns {string}
 */
function warmRuntimeCaches() {
  try { getNoticeData(); } catch (e) {}
  try { getResultsSummaryData(); } catch (e) {}
  try { getEquipmentCheckData(); } catch (e) {}
  return "warmed";
}

/**
 * 캐시 워밍업 트리거를 설치한다. (5분 주기)
 * 이미 설치되어 있으면 추가 생성하지 않는다.
 * @returns {string}
 */
function installWarmRuntimeCachesTrigger() {
  var fn = "warmRuntimeCaches";
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction && triggers[i].getHandlerFunction() === fn) {
      return "trigger_exists";
    }
  }
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
  return "trigger_created";
}

/**
 * 캐시 워밍업 트리거 상태를 조회한다.
 * @returns {{installed:boolean, count:number, triggers:Object[]}}
 */
function getWarmTriggerStatus() {
  var fn = "warmRuntimeCaches";
  var triggers = ScriptApp.getProjectTriggers();
  var matched = [];

  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === fn) {
      matched.push({
        id: (t.getUniqueId && t.getUniqueId()) || "",
        eventType: String((t.getEventType && t.getEventType()) || ""),
        source: String((t.getTriggerSource && t.getTriggerSource()) || ""),
        handler: fn
      });
    }
  }

  return {
    installed: matched.length > 0,
    count: matched.length,
    triggers: matched
  };
}

/**
 * 캐시 워밍업 트리거를 제거한다.
 * @returns {string}
 */
function removeWarmRuntimeCachesTrigger() {
  var fn = "warmRuntimeCaches";
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction && triggers[i].getHandlerFunction() === fn) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return "removed_" + removed;
}

/**
 * 허용된 작성 구분인지 확인한다.
 * @param {string} subject
 * @returns {boolean}
 */
function isValidIssueSubject_(subject) {
  return subject === "기자재" || subject === "운영진 확인" || subject === "인수인계";
}

/**
 * 주기번호 토큰 목록을 파싱/검증한다.
 * 포맷: "123-45", "123" 허용
 * @param {string} raw
 * @returns {{ok:boolean, serials:string[]}}
 */
function parseSerialTokens_(raw) {
  var tokens = String(raw || "")
    .split("|")
    .map(function(v) { return String(v || "").trim(); })
    .filter(function(v) { return !!v; });

  var serials = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!/^\d+(?:-\d+)?$/.test(tokens[i])) return { ok: false, serials: [] };
    serials.push(tokens[i]);
  }
  return { ok: true, serials: serials };
}

/**
 * 제출 폼 입력값을 서버에서 다시 검증/정규화한다.
 * @param {Object} formObject
 * @returns {{ok:boolean, message?:string, data?:Object}}
 */
function validateIncomingForm_(formObject) {
  if (!formObject || typeof formObject !== "object") {
    return { ok: false, message: "요청 데이터 형식이 올바르지 않습니다." };
  }

  var date = String(formObject.date || "").trim();
  var userName = String(formObject.userName || "").trim();
  var subject = String(formObject.subject || "").trim();
  var issueDetails = String(formObject.issueDetails || "").replace(/\r/g, "");
  var issueDetailsRich = String(formObject.issueDetailsRich || "");
  var serialParsed = parseSerialTokens_(formObject.allSerials);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "발생 일자 형식이 올바르지 않습니다." };
  }
  if (!userName) return { ok: false, message: "작성자는 필수입니다." };
  if (userName.length > 40) return { ok: false, message: "작성자 길이가 너무 깁니다." };
  if (!isValidIssueSubject_(subject)) {
    return { ok: false, message: "구분 값이 올바르지 않습니다." };
  }
  if (!issueDetails.trim()) return { ok: false, message: "이슈 내용은 필수입니다." };
  if (issueDetails.length > 8000) return { ok: false, message: "이슈 내용이 너무 깁니다." };
  if (!serialParsed.ok) {
    return { ok: false, message: "주기번호 형식이 올바르지 않습니다." };
  }
  if (subject === "기자재" && serialParsed.serials.length === 0) {
    return { ok: false, message: "기자재 선택 시 주기번호는 필수입니다." };
  }
  if (issueDetailsRich.length > 500000) {
    return { ok: false, message: "서식 데이터 크기가 너무 큽니다." };
  }

  return {
    ok: true,
    data: {
      date: date,
      userName: userName,
      subject: subject,
      issueDetails: issueDetails,
      issueDetailsRich: issueDetailsRich,
      serials: serialParsed.serials
    }
  };
}

/**
 * 업로드 이미지를 저장할 Drive 폴더를 가져온다.
 * - ScriptProperties에 저장된 폴더 ID가 있으면 우선 사용
 * - ID가 깨졌으면 재검색 후 신규 생성
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getIssueImageFolder_() {
  // ScriptProperties에 폴더 ID를 캐시해 Drive 조회 비용을 줄임
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty(ISSUE_IMAGE_FOLDER_ID_KEY);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (e) {
      props.deleteProperty(ISSUE_IMAGE_FOLDER_ID_KEY);
    }
  }

  var folders = DriveApp.getFoldersByName(ISSUE_IMAGE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(ISSUE_IMAGE_FOLDER_NAME);
  props.setProperty(ISSUE_IMAGE_FOLDER_ID_KEY, folder.getId());
  return folder;
}

/**
 * 파일명에서 확장자를 추출한다.
 * @param {string} filename
 * @returns {string}
 */
function getFileExtension_(filename) {
  var name = String(filename || "").trim();
  if (!name) return "";
  var dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.substring(dot + 1).toLowerCase();
}

/**
 * 업로드 이미지 파일의 서버 검증.
 * - 허용 확장자/Content-Type만 통과
 * - 최대 용량 초과 차단
 * @param {*} imgFile
 * @returns {{ok:boolean,message:string}}
 */
function validateIssueImageFile_(imgFile) {
  if (!imgFile || typeof imgFile === "string") {
    return { ok: true, message: "" };
  }

  var name = String((imgFile.getName && imgFile.getName()) || "").trim();
  if (!name) {
    // 파일 미선택 상태는 유효(선택 업로드)
    return { ok: true, message: "" };
  }

  var ext = getFileExtension_(name);
  if (!ISSUE_IMAGE_ALLOWED_EXT[ext]) {
    return { ok: false, message: "이미지 파일 형식은 JPG, PNG, GIF, WEBP만 허용됩니다." };
  }

  var contentType = String((imgFile.getContentType && imgFile.getContentType()) || "").trim().toLowerCase();
  if (contentType.indexOf(";") > -1) contentType = contentType.split(";")[0].trim();
  if (contentType && !ISSUE_IMAGE_ALLOWED_MIME[contentType]) {
    return { ok: false, message: "허용되지 않은 이미지 MIME 타입입니다." };
  }

  var bytes = 0;
  try {
    bytes = (imgFile.getBytes && imgFile.getBytes().length) || 0;
  } catch (e) {
    bytes = 0;
  }
  if (!bytes || bytes <= 0) {
    return { ok: false, message: "이미지 파일을 읽을 수 없습니다." };
  }
  if (bytes > ISSUE_IMAGE_MAX_BYTES) {
    return { ok: false, message: "이미지 파일은 최대 10MB까지 업로드할 수 있습니다." };
  }

  return { ok: true, message: "" };
}

/**
 * 작성 탭 폼 제출 데이터를 근무일지 시트에 저장한다.
 *
 * 처리 순서:
 * 1) 시트/헤더 유효성 검사
 * 2) 이미지 파일(선택) 업로드 및 공유 URL 생성
 * 3) 문서 잠금으로 동시 제출 충돌 방지
 * 4) subject/serial 조건에 맞는 행 배열 생성 후 setValues
 * 5) 이슈내용 RichText(run JSON) 복원 및 셀에 적용
 *
 * @param {Object} formObject - 클라이언트에서 전달한 폼 객체
 * @returns {string} 사용자에게 표시할 처리 결과 메시지
 */
function processForm(formObject) {
  // 폼 제출 처리:
  // 1) 이미지 업로드(선택)
  // 2) 근무일지 시트에 행 추가
  // 3) 이슈내용 리치텍스트 적용
  try {
    /*
      처리 단계 상세
      A) 시트/헤더 검사: 필수 헤더 누락 시 즉시 실패 반환
      B) 이미지 처리: 첨부가 있을 때만 Drive 업로드 + 공개 링크 생성
      C) 락 구간: 마지막행 계산/쓰기/리치텍스트 적용을 원자적으로 수행
      D) 캐시 무효화: 조회/공지 데이터 캐시 제거
    */
    var validated = validateIncomingForm_(formObject);
    if (!validated.ok) return "에러: " + validated.message;
    var payload = validated.data;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("근무일지");
    if (!sheet) return "에러: '근무일지' 시트를 찾을 수 없습니다.";
    var headerInfo = getHeaderMap_(sheet);
    var hmap = headerInfo.map;
    var headers = headerInfo.headers;
    if (!headers.length) return "에러: '근무일지' 시트에 헤더가 없습니다.";
    if (!(ISSUE_HEADERS.date in hmap) || !(ISSUE_HEADERS.createdAt in hmap) || !(ISSUE_HEADERS.author in hmap) || !(ISSUE_HEADERS.subject in hmap) || !(ISSUE_HEADERS.details in hmap)) {
      return "에러: '근무일지' 시트 헤더가 올바르지 않습니다.";
    }

    var fileUrl = "";
    var imgFile = formObject.imageFile;
    var imageValidation = validateIssueImageFile_(imgFile);
    if (!imageValidation.ok) return "에러: " + imageValidation.message;

    // 파일 객체가 실제 첨부된 경우에만 업로드 시도
    if (imgFile && typeof imgFile !== "string" && imgFile.getName() !== "") {
      try {
        var folder = getIssueImageFolder_();

        // 파일 생성
        var file = folder.createFile(imgFile);

        // 파일명 설정 (날짜_작성자_이름)
        var newFileName = payload.date + "_" + payload.userName + "_" + imgFile.getName();
        file.setName(newFileName);

        // 권한 및 URL 추출
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fileUrl = file.getUrl();

        Logger.log("이미지 저장 성공: " + newFileName);
      } catch (fError) {
        var uploadErr = (fError && fError.message) ? fError.message : String(fError);
        Logger.log("드라이브 작업 중 에러: " + uploadErr);
        return "에러: 이미지 업로드에 실패했습니다. 파일 권한/네트워크 상태를 확인한 뒤 다시 시도해주세요.";
      }
    }

    var createdAt = new Date();
    var serials = payload.serials;
    var rowsToWrite = [];

    if (payload.subject === "기자재" && serials.length > 0) {
      serials.forEach(function(sn) {
        var row = new Array(headers.length).fill("");
        row[hmap[ISSUE_HEADERS.date]] = payload.date;
        row[hmap[ISSUE_HEADERS.createdAt]] = createdAt;
        row[hmap[ISSUE_HEADERS.author]] = payload.userName;
        row[hmap[ISSUE_HEADERS.subject]] = payload.subject;
        if (ISSUE_HEADERS.itemName in hmap) row[hmap[ISSUE_HEADERS.itemName]] = "";
        if (ISSUE_HEADERS.serial in hmap) row[hmap[ISSUE_HEADERS.serial]] = "GR-" + sn;
        row[hmap[ISSUE_HEADERS.details]] = payload.issueDetails;
        if (ISSUE_HEADERS.image in hmap) row[hmap[ISSUE_HEADERS.image]] = fileUrl;
        rowsToWrite.push(row);
      });
    } else {
      var rowSingle = new Array(headers.length).fill("");
      rowSingle[hmap[ISSUE_HEADERS.date]] = payload.date;
      rowSingle[hmap[ISSUE_HEADERS.createdAt]] = createdAt;
      rowSingle[hmap[ISSUE_HEADERS.author]] = payload.userName;
      rowSingle[hmap[ISSUE_HEADERS.subject]] = payload.subject;
      if (ISSUE_HEADERS.itemName in hmap) rowSingle[hmap[ISSUE_HEADERS.itemName]] = "";
      if (ISSUE_HEADERS.serial in hmap) rowSingle[hmap[ISSUE_HEADERS.serial]] = "";
      rowSingle[hmap[ISSUE_HEADERS.details]] = payload.issueDetails;
      if (ISSUE_HEADERS.image in hmap) rowSingle[hmap[ISSUE_HEADERS.image]] = fileUrl;
      rowsToWrite.push(rowSingle);
    }

    // 리치텍스트 복원은 락 밖에서 준비해 락 보유 시간을 줄인다.
    var detailsRich = null;
    var richMatrix = null;
    if (ISSUE_HEADERS.details in hmap) {
      detailsRich = buildIssueDetailsRichText_(payload.issueDetailsRich, payload.issueDetails);
      if (detailsRich) {
        richMatrix = [];
        for (var rIdx = 0; rIdx < rowsToWrite.length; rIdx++) {
          richMatrix.push([detailsRich]);
        }
      }
    }

    // 동시 제출 충돌 방지: append 쓰기 구간만 잠금 보호
    // 같은 시트에 동시 append가 몰릴 수 있어 문서 단위 락 사용
    var lock = LockService.getDocumentLock();
    lock.waitLock(30000);
    try {
      var createdAtCol = hmap[ISSUE_HEADERS.createdAt] + 1;
      var targetRow = getIssueAppendTargetRow_(sheet, createdAtCol);

      // 본문/메타를 먼저 일반값으로 일괄 저장
      sheet.getRange(targetRow, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);

      if (richMatrix) {
        var detailsCol = hmap[ISSUE_HEADERS.details] + 1;
        // setRichTextValue 반복 대신 setRichTextValues 일괄 호출로 API round-trip 절감
        sheet.getRange(targetRow, detailsCol, rowsToWrite.length, 1).setRichTextValues(richMatrix);
      }

      saveIssueAppendNextRow_(targetRow + rowsToWrite.length);
    } finally {
      lock.releaseLock();
    }

    clearRuntimeCaches_();
    return "성공적으로 저장되었습니다.";
  } catch (e) {
    var errText = (e && e.stack) ? e.stack : String(e);
    Logger.log("치명적 에러: " + errText);
    return "에러 발생: 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }
}

// ===== 웹앱 엔트리 =====
/**
 * GAS 웹앱 GET 엔트리.
 * index 템플릿을 렌더링하고 기본 메타/보안 옵션을 설정한다.
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile("index").evaluate()
    .setTitle("구로 이슈 관리 시스템")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * HTML 템플릿 파셜 include 헬퍼.
 * index.html에서 Style/JavaScript 파일을 삽입할 때 사용한다.
 * @param {string} filename
 * @returns {string}
 */
function include(filename) { return HtmlService.createTemplateFromFile(filename).evaluate().getContent(); }

/**
 * 클라이언트 헤더 상수 단일 소스 제공.
 * @returns {Object}
 */
function getIssueHeaders() {
  return {
    date: ISSUE_HEADERS.date,
    createdAt: ISSUE_HEADERS.createdAt,
    author: ISSUE_HEADERS.author,
    subject: ISSUE_HEADERS.subject,
    item: ISSUE_HEADERS.itemName,
    serial: ISSUE_HEADERS.serial,
    details: ISSUE_HEADERS.details,
    image: ISSUE_HEADERS.image,
    actionOwner: ISSUE_HEADERS.actionOwner,
    actionDone: ISSUE_HEADERS.actionDone,
    actionContent: ISSUE_HEADERS.actionContent,
    repairPlace: ISSUE_HEADERS.repairPlace,
    repairDate: ISSUE_HEADERS.repairDate,
    repairFlag: ISSUE_HEADERS.repairFlag
  };
}

/**
 * 근무일지 시트 1개 행을 클라이언트 응답 객체로 변환한다.
 * @param {Array} row
 * @param {string[]} headers
 * @param {Array=} richRow
 * @param {Array=} fontRow
 * @param {boolean=} includeRichDetails
 * @returns {Object}
 */
function buildIssueRowObject_(row, headers, richRow, fontRow, includeRichDetails) {
  var obj = {};
  var dateOnlyFields = {};
  dateOnlyFields[ISSUE_HEADERS.date] = true;
  dateOnlyFields[ISSUE_HEADERS.repairDate] = true;
  var dateTimeFields = {};
  dateTimeFields[ISSUE_HEADERS.createdAt] = true;
  dateTimeFields[ISSUE_HEADERS.actionDone] = true;

  for (var c = 0; c < headers.length; c++) {
    var key = headers[c];
    if (!key) continue;
    var cell = row[c];
    if (cell instanceof Date) {
      var format = dateOnlyFields[key] ? "yyyy-MM-dd" : (dateTimeFields[key] ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd HH:mm");
      obj[key] = Utilities.formatDate(cell, "GMT+9", format);
      continue;
    }

    if (key === ISSUE_HEADERS.image) {
      var rawImageUrl = String(cell || "").trim();
      obj[key] = toDriveImageUrl_(rawImageUrl);
      obj.__imageRawUrl = rawImageUrl;
      continue;
    }

    if (key === ISSUE_HEADERS.details) {
      obj[key] = cell;
      if (includeRichDetails && richRow && fontRow) {
        var detailsHtml = richTextToHtml_(richRow[c]);
        var detailsBaseSize = Number(fontRow[c]);
        var detailsScale = (isFinite(detailsBaseSize) && detailsBaseSize > 0 && detailsBaseSize < 14) ? (14 / detailsBaseSize) : 1;
        detailsHtml = scaleFontSizesHtml_(detailsHtml, detailsScale);
        detailsHtml = applyDefaultFontSizeHtml_(detailsHtml, withMinFontSize_(detailsBaseSize, 14));
        if (detailsHtml) obj.__detailsHtml = detailsHtml;
      }
      continue;
    }

    obj[key] = cell;
  }

  return obj;
}

/**
 * 조회 카드 리스트용 경량 데이터.
 * (상세 리치본문은 제외하고 요약 필드만 반환)
 * @returns {Object[]}
 */
function getResultsSummaryData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(RESULTS_DATA_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("근무일지");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow <= 1 || lastColumn <= 0) return [];

  var headerInfo = getHeaderMap_(sheet);
  var hmap = headerInfo.map;
  var headers = headerInfo.headers;
  if (!headers.length) return [];

  var threshold = new Date(new Date().getTime() - (21 * 24 * 60 * 60 * 1000));
  var createdAtIdx = hmap[ISSUE_HEADERS.createdAt];
  if (createdAtIdx === undefined) return [];
  var createdAtCol = createdAtIdx + 1;

  var startRow = findResultsStartRow_(sheet, createdAtCol, threshold, lastRow);
  if (startRow > lastRow) {
    try {
      cache.put(RESULTS_DATA_CACHE_KEY, JSON.stringify([]), RESULTS_DATA_CACHE_TTL_SEC);
    } catch (e) {}
    return [];
  }
  var rowCount = lastRow - startRow + 1;
  var values = sheet.getRange(startRow, 1, rowCount, lastColumn).getValues();

  var results = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var createdAt = row[createdAtIdx];
    if (!(createdAt instanceof Date) || createdAt < threshold) continue;
    var obj = buildIssueRowObject_(row, headers, null, null, false);
    obj.__rowNumber = startRow + i;
    results.push(obj);
  }

  try {
    cache.put(RESULTS_DATA_CACHE_KEY, JSON.stringify(results), RESULTS_DATA_CACHE_TTL_SEC);
  } catch (e) {}
  return results;
}

/**
 * 최근 N일 조회 윈도우의 시작행을 찾아 반환한다.
 * 이전 계산 결과를 ScriptProperties에 커서로 저장해 대량 데이터에서 풀스캔을 피한다.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} createdAtCol
 * @param {Date} threshold
 * @param {number} lastRow
 * @returns {number} 최근 윈도우 시작행 (없으면 lastRow+1)
 */
function findResultsStartRow_(sheet, createdAtCol, threshold, lastRow) {
  var props = PropertiesService.getScriptProperties();
  var cursorRaw = props.getProperty(RESULTS_WINDOW_CURSOR_KEY);
  var cursor = null;
  try {
    cursor = cursorRaw ? JSON.parse(cursorRaw) : null;
  } catch (e) {
    cursor = null;
  }

  var sheetId = sheet.getSheetId();
  var startRow = 2;
  var nowMs = Date.now();
  var isCursorFresh = false;
  if (
    cursor &&
    Number(cursor.sheetId) === Number(sheetId) &&
    Number(cursor.createdAtCol) === Number(createdAtCol) &&
    Number(cursor.startRow) >= 2 &&
    Number(cursor.updatedAt) > 0 &&
    (nowMs - Number(cursor.updatedAt)) < (6 * 60 * 60 * 1000) &&
    !(Number(cursor.lastRow) > 0 && lastRow < Number(cursor.lastRow))
  ) {
    isCursorFresh = true;
    startRow = Math.min(lastRow + 1, Math.max(2, Math.floor(Number(cursor.startRow))));
  }

  if (!isCursorFresh) startRow = 2;

  if (startRow > lastRow) return lastRow + 1;

  var foundRow = lastRow + 1;
  var scanRow = startRow;
  var chunkSize = 500;
  while (scanRow <= lastRow) {
    var count = Math.min(chunkSize, lastRow - scanRow + 1);
    var values = sheet.getRange(scanRow, createdAtCol, count, 1).getValues();
    var localFound = -1;
    for (var i = 0; i < values.length; i++) {
      var cell = values[i][0];
      if (cell instanceof Date && cell >= threshold) {
        localFound = i;
        break;
      }
    }
    if (localFound >= 0) {
      foundRow = scanRow + localFound;
      break;
    }
    scanRow += count;
  }

  try {
    props.setProperty(
      RESULTS_WINDOW_CURSOR_KEY,
      JSON.stringify({
        sheetId: sheetId,
        createdAtCol: createdAtCol,
        startRow: foundRow,
        lastRow: lastRow,
        updatedAt: nowMs
      })
    );
  } catch (e) {}

  return foundRow;
}

/**
 * 기존 클라이언트 호환을 위한 alias.
 * @returns {Object[]}
 */
function getResultsData() {
  return getResultsSummaryData();
}

/**
 * 조회 상세 모달용 단건 데이터.
 * @param {number|string} rowNumber
 * @returns {Object|null}
 */
function getResultDetailData(rowNumber) {
  var targetRow = Math.floor(Number(rowNumber));
  if (!isFinite(targetRow) || targetRow < 2) return null;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("근무일지");
  if (!sheet) return null;

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (targetRow > lastRow || lastColumn <= 0) return null;

  var headerInfo = getHeaderMap_(sheet);
  var headers = headerInfo.headers;
  if (!headers.length) return null;

  var range = sheet.getRange(targetRow, 1, 1, lastColumn);
  var row = range.getValues()[0];
  var richRow = range.getRichTextValues()[0];
  var fontRow = range.getFontSizes()[0];

  var obj = buildIssueRowObject_(row, headers, richRow, fontRow, true);
  obj.__rowNumber = targetRow;
  return obj;
}

/**
 * 주기번호 표준화.
 * 예: "GR-100-2" -> {base:"GR-100", unit:"2"}
 * @param {string} serial
 * @returns {{base:string, unit:string}}
 */
function normalizeSerial(serial) {
  // GR-xxx-yy 형태를 base/unit으로 분해해 정렬에 활용
  var s = String(serial || "").trim().toUpperCase();
  var m = s.match(/^(GR-\d+)(?:-(\d+))?$/);
  if (!m) return { base: s, unit: "" };
  return { base: m[1], unit: m[2] || "" };
}

/**
 * 파손 여부 셀 값을 boolean 성격으로 정규화한다.
 * 다양한 false 표현(정상/없음/no/0 등)을 흡수한다.
 * @param {*} value
 * @returns {boolean}
 */
function isDamagedValue(value) {
  // 시트의 다양한 입력값(정상/없음/false 등)을 파손 여부 boolean으로 정규화
  var raw = String(value || "").trim();
  if (raw === "") return false;
  var v = raw.toLowerCase();
  var falsey = ["false", "0", "n", "no", "정상", "-", "x", "미파손", "해당없음", "없음"];
  if (falsey.indexOf(v) !== -1) return false;
  return true;
}

/**
 * 교구 확인 데이터(캐시 우선) 반환.
 * @returns {Object[]}
 */
function getEquipmentCheckData() {
  return getEquipmentCheckDataInternal_(false);
}

/**
 * 교구 확인 데이터 강제 새로고침 반환.
 * @returns {Object[]}
 */
function getEquipmentCheckDataFresh() {
  return getEquipmentCheckDataInternal_(true);
}

/**
 * 교구 확인 데이터 내부 구현.
 * - forceRefresh=false면 ScriptCache 우선
 * - 외부 스프레드시트에서 읽어 품목별 그룹/정렬 후 반환
 *
 * @param {boolean} forceRefresh
 * @returns {Object[]}
 */
function getEquipmentCheckDataInternal_(forceRefresh) {
  // 교구 현황:
  // 외부 시트에서 읽어 품목별 그룹화하고 캐시에 저장
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get(EQUIPMENT_CHECK_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
  }
  var spreadsheetId = "1wdLVYOXgPl23gEHajOsAWTQ2GNX0cL6Y8xZtAPqfgqQ";
  var sheetName = "총합(원본,구매,이동,파손,대여 적용)";
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  var startRow = 4;
  if (lastRow < startRow) return [];

  // B:Q 범위(4행~)에서 필요한 컬럼만 사용
  var values = sheet.getRange(startRow, 2, lastRow - startRow + 1, 16).getDisplayValues();
  var groups = {};

  values.forEach(function(r) {
    var serial = String(r[0] || "").trim();    // B
    var itemName = String(r[8] || "").trim();  // J
    var location = String(r[13] || "").trim(); // O
    var rentalInfo = String(r[14] || "").trim(); // P
    var damageRaw = String(r[15] || "").trim();  // Q

    if (!itemName) return;

    var serialInfo = normalizeSerial(serial);
    var isDamaged = isDamagedValue(damageRaw);
    var damageText = isDamaged ? (damageRaw || "파손") : (damageRaw || "정상");

    if (!groups[itemName]) {
      groups[itemName] = {
        itemName: itemName,
        rentalCount: 0,
        damageCount: 0,
        rows: []
      };
    }

    if (rentalInfo) groups[itemName].rentalCount++;
    if (isDamaged) groups[itemName].damageCount++;

    groups[itemName].rows.push({
      serial: serial,
      baseSerial: serialInfo.base,
      unitNo: serialInfo.unit,
      location: location || "-",
      rentalInfo: rentalInfo || "-",
      damage: damageText,
      isDamaged: isDamaged
    });
  });

  var list = Object.keys(groups).map(function(key) {
    return groups[key];
  });

  list.forEach(function(item) {
    item.rows.sort(function(a, b) {
      var baseCmp = String(a.baseSerial).localeCompare(String(b.baseSerial));
      if (baseCmp !== 0) return baseCmp;
      var au = a.unitNo ? parseInt(a.unitNo, 10) : -1;
      var bu = b.unitNo ? parseInt(b.unitNo, 10) : -1;
      if (au !== bu) return au - bu;
      return String(a.serial).localeCompare(String(b.serial));
    });
  });

  list.sort(function(a, b) {
    return String(a.itemName).localeCompare(String(b.itemName));
  });

  try {
    cache.put(EQUIPMENT_CHECK_CACHE_KEY, JSON.stringify(list), EQUIPMENT_CHECK_CACHE_TTL_SEC);
  } catch (e) {}
  return list;
}

/**
 * 공지/조회 표시용 날짜 문자열 포맷터.
 * Date 또는 문자열 입력을 받아 "yyyy년 M월 d일 요일" 형태로 반환.
 * @param {Date|string} value
 * @returns {string}
 */
function toDisplayDate_(value) {
  // 공지사항 날짜를 "yyyy년 M월 d일 요일" 포맷으로 통일
  var d = null;
  if (value instanceof Date) {
    d = value;
  } else {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) d = parsed;
    else return raw;
  }

  var base = Utilities.formatDate(d, "GMT+9", "yyyy년 M월 d일");
  var dayNum = Number(Utilities.formatDate(d, "GMT+9", "u")); // 1(월) ~ 7(일)
  var dayMap = { 1: "월요일", 2: "화요일", 3: "수요일", 4: "목요일", 5: "금요일", 6: "토요일", 7: "일요일" };
  return base + " " + (dayMap[dayNum] || "");
}

/**
 * Drive 공유 URL을 이미지 태그 친화적인 URL로 변환.
 * - /d/{id} 또는 ?id={id} 패턴을 파싱
 * - 파싱 실패 시 원문 유지
 * @param {string} url
 * @returns {string}
 */
function toDriveImageUrl_(url) {
  // Drive 링크를 img 태그 친화적인 thumbnail 엔드포인트로 변환
  var s = String(url || "").trim();
  if (!s) return "";
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  var id = m && m[1] ? m[1] : "";
  if (!id) {
    var m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    id = m2 && m2[1] ? m2[1] : "";
  }
  if (!id) return s;
  return "https://drive.google.com/thumbnail?id=" + id + "&sz=w2000";
}

/**
 * 링크 URL을 http/https만 허용하도록 정규화한다.
 * @param {*} url
 * @returns {string}
 */
function sanitizeHttpUrl_(url) {
  var s = String(url || "").trim();
  if (!s) return "";
  // 제어문자/줄바꿈 제거로 스킴 우회 시도 차단
  s = s.replace(/[\u0000-\u001F\u007F]/g, "");
  if (!/^https?:\/\//i.test(s)) return "";
  return s;
}

/**
 * 공지 제목 fallback 생성.
 * 제목이 비어 있으면 내용 앞 10자를 사용한다.
 * @param {string} title
 * @param {string} content
 * @returns {string}
 */
function buildNoticeTitle_(title, content) {
  var t = String(title || "").trim();
  if (t) return t;
  var c = String(content || "").replace(/\s+/g, " ").trim();
  if (!c) return "(제목 없음)";
  return c.length > 10 ? c.substring(0, 10) + "..." : c;
}

/**
 * HTML 이스케이프 유틸.
 * @param {*} text
 * @returns {string}
 */
function escapeHtml_(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * TextStyle을 HTML inline 스타일/태그로 변환.
 * bold/italic/underline/strike + color + font-size를 반영한다.
 * @param {string} text - 이미 escape 처리된 텍스트 조각
 * @param {GoogleAppsScript.Spreadsheet.TextStyle} style
 * @returns {string}
 */
function applyTextStyleHtml_(text, style) {
  // 시트 TextStyle -> HTML 태그/inline-style 변환
  var out = text;
  if (!style) return out;

  if (style.isBold()) out = "<strong>" + out + "</strong>";
  if (style.isItalic()) out = "<em>" + out + "</em>";
  if (style.isUnderline()) out = "<u>" + out + "</u>";
  if (style.isStrikethrough()) out = "<s>" + out + "</s>";

  var spanStyles = [];
  var color = style.getForegroundColor();
  if (color && /^#?[0-9a-fA-F]{6}$/.test(color)) {
    if (color.charAt(0) !== "#") color = "#" + color;
    spanStyles.push("color:" + color);
  }

  var fontSize = style.getFontSize();
  // 10px 기본값은 과도하게 작아 보일 수 있어 별도 보정 로직과 함께 사용
  if (fontSize && Number(fontSize) > 0 && Number(fontSize) !== 10) {
    spanStyles.push("font-size:" + Number(fontSize) + "px");
  }

  if (spanStyles.length > 0) {
    out = '<span style="' + spanStyles.join(";") + ';">' + out + "</span>";
  }

  return out;
}

/**
 * RichTextValue 전체를 HTML 문자열로 직렬화.
 * run 단위 스타일/링크를 유지하며 줄바꿈은 <br>로 변환한다.
 * @param {GoogleAppsScript.Spreadsheet.RichTextValue} richTextValue
 * @returns {string}
 */
function richTextToHtml_(richTextValue) {
  // RichTextValue의 run 단위 스타일/링크를 안전한 HTML로 직렬화
  if (!richTextValue) return "";
  var fullText = String(richTextValue.getText() || "");
  if (!fullText) return "";

  var runs = richTextValue.getRuns();
  if (!runs || runs.length === 0) {
    var fallback = escapeHtml_(fullText).replace(/\r?\n/g, "<br>");
    fallback = applyTextStyleHtml_(fallback, richTextValue.getTextStyle());
    var fallbackLink = sanitizeHttpUrl_(richTextValue.getLinkUrl());
    if (fallbackLink) {
      fallback = '<a href="' + escapeHtml_(fallbackLink) + '" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">' + fallback + "</a>";
    }
    return fallback;
  }

  var parts = [];
  runs.forEach(function(run) {
    var runText = escapeHtml_(run.getText() || "").replace(/\r?\n/g, "<br>");
    if (!runText) return;

    runText = applyTextStyleHtml_(runText, run.getTextStyle());

    var link = sanitizeHttpUrl_(run.getLinkUrl());
    if (link) {
      runText = '<a href="' + escapeHtml_(link) + '" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">' + runText + "</a>";
    }

    parts.push(runText);
  });

  return parts.join("");
}

/**
 * HTML 전체를 기본 폰트 크기 span으로 감싼다.
 * @param {string} html
 * @param {number} fontSize
 * @returns {string}
 */
function applyDefaultFontSizeHtml_(html, fontSize) {
  var out = String(html || "");
  if (!out) return out;
  var n = Number(fontSize);
  if (!isFinite(n) || n <= 0) return out;
  return '<span style="font-size:' + Math.floor(n) + 'px;">' + out + "</span>";
}

/**
 * 최소 가독성 보장을 위한 폰트 하한 적용.
 * @param {number} fontSize
 * @param {number} minSize
 * @returns {number}
 */
function withMinFontSize_(fontSize, minSize) {
  // 최소 가독성 보장을 위한 폰트 하한값 적용
  var n = Number(fontSize);
  var m = Number(minSize);
  if (!isFinite(m) || m <= 0) m = 12;
  if (!isFinite(n) || n <= 0) return m;
  return n < m ? m : n;
}

/**
 * HTML 내 inline font-size 값을 비율로 스케일링한다.
 * 상대적인 강조 비율(큰 글자/작은 글자 차이)을 유지할 때 사용.
 * @param {string} html
 * @param {number} factor
 * @returns {string}
 */
function scaleFontSizesHtml_(html, factor) {
  // inline font-size를 비율 확대(상대적인 크기 차 유지)
  var out = String(html || "");
  var f = Number(factor);
  if (!out || !isFinite(f) || f <= 1) return out;
  return out.replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, function(_, numStr) {
    var n = Number(numStr);
    if (!isFinite(n) || n <= 0) return _;
    var scaled = Math.round(n * f * 10) / 10;
    return "font-size:" + scaled + "px";
  });
}

/**
 * 공지 중요도 셀 값을 boolean으로 판정.
 * true/1/y/체크 등 다양한 표현 허용.
 * @param {*} value
 * @returns {boolean}
 */
function isImportantNotice_(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  var v = String(value).trim().toLowerCase();
  return v === "true" || v === "1" || v === "y" || v === "yes" || v === "t" || v === "체크";
}

/**
 * CSS 색상 문자열을 #RRGGBB로 정규화.
 * 지원: #RGB, #RRGGBB, rgb(r,g,b)
 * @param {string} value
 * @returns {string}
 */
function normalizeHexColor_(value) {
  var s = String(value || "").trim();
  if (!s) return "";

  var m3 = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    return "#" + m3[1][0] + m3[1][0] + m3[1][1] + m3[1][1] + m3[1][2] + m3[1][2];
  }
  var m6 = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return "#" + m6[1];

  var mrgb = s.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (mrgb) {
    var r = Math.max(0, Math.min(255, Number(mrgb[1])));
    var g = Math.max(0, Math.min(255, Number(mrgb[2])));
    var b = Math.max(0, Math.min(255, Number(mrgb[3])));
    function to2Hex(n) {
      var h = n.toString(16);
      return h.length === 1 ? "0" + h : h;
    }
    return "#" + to2Hex(r) + to2Hex(g) + to2Hex(b);
  }
  return "";
}

/**
 * 클라이언트에서 받은 이슈내용 run JSON을 시트 RichTextValue로 복원.
 * - start/end는 end-exclusive 인덱스
 * - 지원 스타일: bold/italic/underline/strikethrough/color/fontSize/link
 *
 * @param {string|Object} payload
 * @param {string} fallbackText
 * @returns {GoogleAppsScript.Spreadsheet.RichTextValue|null}
 */
function buildIssueDetailsRichText_(payload, fallbackText) {
  if (!payload) return null;
  var parsed = null;
  try {
    parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch (e) {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  var text = String(parsed.text || "");
  if (!text) return null;

  var runs = Array.isArray(parsed.runs) ? parsed.runs : [];
  var builder = SpreadsheetApp.newRichTextValue().setText(text);

  for (var i = 0; i < runs.length; i++) {
    var run = runs[i];
    if (!run || typeof run !== "object") continue;

    var start = Number(run.start);
    var end = Number(run.end);
    if (!isFinite(start) || !isFinite(end)) continue;
    start = Math.max(0, Math.floor(start));
    end = Math.min(text.length, Math.floor(end));
    if (end <= start) continue;

    var style = run.style || {};
    var textStyleBuilder = SpreadsheetApp.newTextStyle();
    var hasTextStyle = false;

    if (style.bold !== undefined) { textStyleBuilder.setBold(!!style.bold); hasTextStyle = true; }
    if (style.italic !== undefined) { textStyleBuilder.setItalic(!!style.italic); hasTextStyle = true; }
    if (style.strikethrough !== undefined) { textStyleBuilder.setStrikethrough(!!style.strikethrough); hasTextStyle = true; }
    if (style.underline !== undefined) { textStyleBuilder.setUnderline(!!style.underline); hasTextStyle = true; }

    var normalizedColor = normalizeHexColor_(style.color);
    if (normalizedColor) {
      textStyleBuilder.setForegroundColor(normalizedColor);
      hasTextStyle = true;
    }

    var fontSize = Number(style.fontSize);
    if (isFinite(fontSize) && fontSize >= 8 && fontSize <= 72) {
      textStyleBuilder.setFontSize(Math.floor(fontSize));
      hasTextStyle = true;
    }

    if (hasTextStyle) {
      builder.setTextStyle(start, end, textStyleBuilder.build());
    }

    var link = sanitizeHttpUrl_(style.link);
    if (link) {
      builder.setLinkUrl(start, end, link);
    }
  }

  return builder.build();
}

/**
 * 공지사항 탭 데이터 빌더.
 *
 * 반환 필드:
 * - isImportant/date/author/title/content
 * - titleHtml/contentHtml (RichText 직렬화 결과)
 * - imageUrl/imageRawUrl
 *
 * 폰트 처리:
 * - 셀 기본 폰트가 작은 경우 최소 크기 보정
 * - run 내부 font-size는 비율 확대로 상대 크기 보존
 *
 * @returns {Object[]}
 */
function getNoticeData() {
  // 공지사항 데이터 생성:
  // 중요도/작성자/날짜 + RichText HTML + 이미지 URL 정규화
  /*
    성능/표현 정책
    - 캐시 우선 사용(짧은 TTL)
    - 제목/내용 RichText를 HTML로 변환
    - 셀 기본 fontSize가 작은 경우 최소 가독성 크기로 보정
    - run 내부 크기 비율은 유지해 강조 체계가 깨지지 않게 처리
  */
  var cache = CacheService.getScriptCache();
  var cached = cache.get(NOTICE_DATA_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("공지사항");
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A: 중요, B: 날짜, C: 작성자, D: 제목, E: 내용, F: 이미지
  var range = sheet.getRange(2, 1, lastRow - 1, 6);
  var values = range.getValues();
  var richValues = range.getRichTextValues();
  var fontSizes = range.getFontSizes();
  var result = [];

  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var richRow = richValues[i];
    var isImportant = isImportantNotice_(row[0]);
    var date = toDisplayDate_(row[1]);
    var author = String(row[2] || "").trim();
    var title = String(row[3] || "").trim();
    var content = String(row[4] || "").trim();
    var imageRaw = String(row[5] || "").trim();
    var titleHtml = richTextToHtml_(richRow[3]);
    var contentHtml = richTextToHtml_(richRow[4]);
    // 기본 가독성 보장 + 상대 크기 유지:
    // 셀 기본 폰트가 작으면 내부 run 폰트도 같은 비율로 함께 확대
    var titleBaseSize = Number(fontSizes[i][3]);
    var contentBaseSize = Number(fontSizes[i][4]);
    var titleScale = (isFinite(titleBaseSize) && titleBaseSize > 0 && titleBaseSize < 18) ? (18 / titleBaseSize) : 1;
    var contentScale = (isFinite(contentBaseSize) && contentBaseSize > 0 && contentBaseSize < 14) ? (14 / contentBaseSize) : 1;

    titleHtml = scaleFontSizesHtml_(titleHtml, titleScale);
    contentHtml = scaleFontSizesHtml_(contentHtml, contentScale);

    titleHtml = applyDefaultFontSizeHtml_(titleHtml, withMinFontSize_(titleBaseSize, 18));
    contentHtml = applyDefaultFontSizeHtml_(contentHtml, withMinFontSize_(contentBaseSize, 14));

    if (!date && !author && !title && !content && !imageRaw && !isImportant) continue;

    result.push({
      isImportant: isImportant,
      date: date,
      author: author,
      title: title,
      displayTitle: buildNoticeTitle_(title, content),
      content: content,
      titleHtml: titleHtml,
      contentHtml: contentHtml,
      imageUrl: toDriveImageUrl_(imageRaw),
      imageRawUrl: imageRaw
    });
  }
  try {
    cache.put(NOTICE_DATA_CACHE_KEY, JSON.stringify(result), NOTICE_DATA_CACHE_TTL_SEC);
  } catch (e) {}
  return result;
}
