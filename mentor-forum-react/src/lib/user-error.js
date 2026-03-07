// Shared user-facing error normalization.
// Converts Firebase/Firestore/internal messages into plain Korean guidance
// while preserving already-friendly custom messages from the app.

function normalizeText(value) {
  return String(value || '').trim();
}

function extractKnownErrorCode(rawText) {
  const raw = normalizeText(rawText).toLowerCase();
  if (!raw) return '';

  const firebaseStyle = raw.match(/\b(?:auth|firestore)\/[a-z0-9-]+\b/);
  if (firebaseStyle) return firebaseStyle[0];

  const wrappedCode = raw.match(/\(([a-z0-9-]+\/[a-z0-9-]+)\)/);
  if (wrappedCode) return wrappedCode[1];

  const genericCodes = [
    'permission-denied',
    'unauthenticated',
    'not-found',
    'already-exists',
    'failed-precondition',
    'deadline-exceeded',
    'resource-exhausted',
    'aborted',
    'cancelled',
    'unavailable',
    'internal',
    'unknown',
    'invalid-argument'
  ];

  return genericCodes.find((code) => raw.includes(code)) || '';
}

function mapKnownErrorCode(code) {
  const key = normalizeText(code).toLowerCase();
  if (!key) return '';

  const mapped = {
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/user-not-found': '가입된 계정을 찾을 수 없습니다. 이메일 주소를 확인해주세요.',
    'auth/invalid-email': '올바른 이메일 주소를 입력해주세요.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인 후 이용해주세요.',
    'auth/weak-password': '비밀번호가 너무 약합니다. 더 안전한 비밀번호로 다시 설정해주세요.',
    'auth/too-many-requests': '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.',
    'auth/network-request-failed': '네트워크 오류가 발생했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.',
    'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도해주세요.',
    'permission-denied': '권한 오류입니다. 현재 계정으로는 이 작업을 수행할 수 없습니다.',
    'firestore/permission-denied': '권한 오류입니다. 현재 계정으로는 이 작업을 수행할 수 없습니다.',
    'unauthenticated': '로그인 정보가 만료되었습니다. 다시 로그인해주세요.',
    'not-found': '요청한 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.',
    'already-exists': '이미 존재하는 데이터입니다. 입력값을 확인해주세요.',
    'failed-precondition': '현재 상태에서는 이 작업을 진행할 수 없습니다. 잠시 후 다시 시도해주세요.',
    'deadline-exceeded': '요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
    'resource-exhausted': '요청이 많아 잠시 처리할 수 없습니다. 잠시 후 다시 시도해주세요.',
    'aborted': '요청이 중단되었습니다. 다시 시도해주세요.',
    'cancelled': '요청이 취소되었습니다. 다시 시도해주세요.',
    'unavailable': '서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.',
    'internal': '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    'unknown': '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    'invalid-argument': '입력값이 올바르지 않습니다. 다시 확인해주세요.'
  };

  return mapped[key] || '';
}

function looksTechnicalMessage(rawText) {
  const raw = normalizeText(rawText);
  if (!raw) return false;

  return [
    /firebase:/i,
    /\bauth\/[a-z0-9-]+\b/i,
    /\bfirestore\/[a-z0-9-]+\b/i,
    /missing or insufficient permissions/i,
    /permission denied/i,
    /network[- ]request[- ]failed/i,
    /client is offline/i,
    /failed to fetch/i,
    /requires (?:an )?(?:index|collection_asc index)/i,
    /deadline[- ]exceeded/i,
    /failed[- ]precondition/i,
    /resource[- ]exhausted/i,
    /too many requests/i,
    /internal error/i,
    /unsupported field value/i,
    /invalid argument/i
  ].some((pattern) => pattern.test(raw));
}

function looksFriendlyUserMessage(rawText) {
  const raw = normalizeText(rawText);
  if (!raw) return false;
  if (looksTechnicalMessage(raw)) return false;
  return /[가-힣]/.test(raw);
}

export function toUserErrorMessage(error, fallback = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.') {
  const safeFallback = normalizeText(fallback) || '문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  const rawMessage = normalizeText(typeof error === 'string' ? error : error?.message);
  const code = normalizeText(typeof error === 'object' && error ? error.code : '').toLowerCase() || extractKnownErrorCode(rawMessage);
  const mappedByCode = mapKnownErrorCode(code);
  if (mappedByCode) return mappedByCode;

  if (/requires (?:an )?(?:index|collection_asc index)/i.test(rawMessage)) {
    return '서비스 설정을 적용 중입니다. 잠시 후 다시 시도해주세요.';
  }

  if (/missing or insufficient permissions|permission denied/i.test(rawMessage)) {
    return '권한 오류입니다. 현재 계정으로는 이 작업을 수행할 수 없습니다.';
  }

  if (/client is offline|network[- ]request[- ]failed|failed to fetch|network error|offline/i.test(rawMessage)) {
    return '네트워크 오류가 발생했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.';
  }

  if (/firebase 설정이 비어 있습니다|firebase 설정 오류/i.test(rawMessage)) {
    return '서비스 설정 문제로 요청을 처리하지 못했습니다. 관리자에게 문의해주세요.';
  }

  if (/no document to update|document does not exist|requested entity was not found/i.test(rawMessage)) {
    return '요청한 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.';
  }

  if (/already exists/i.test(rawMessage)) {
    return '이미 존재하는 데이터입니다. 입력값을 확인해주세요.';
  }

  if (/too many requests/i.test(rawMessage)) {
    return '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.';
  }

  if (looksFriendlyUserMessage(rawMessage)) {
    return rawMessage;
  }

  return safeFallback;
}
