/**
 * Extension popup controller.
 * - Displays latest sync status snapshot from background.
 * - Provides one-click manual sync and settings shortcut.
 */
const summaryEl = document.getElementById('summary');
const syncNowBtn = document.getElementById('syncNowBtn');
const openOptionsBtn = document.getElementById('openOptionsBtn');

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || '요청 실패');
  }
  return response.result;
}

function renderStatus(status, auth) {
  // Popup uses compact multi-line summary for quick operator diagnosis.
  const authText = auth?.email ? `계정: ${auth.email}` : '계정: 미연결';
  const message = status?.message || '상태 없음';
  const at = status?.lastRunAtMs ? new Date(status.lastRunAtMs).toLocaleString() : '-';
  summaryEl.textContent = `${authText}\n최근 실행: ${at}\n${message}`;
}

async function refresh() {
  const data = await sendMessage('getStatus');
  renderStatus(data.status, data.auth);
}

syncNowBtn.addEventListener('click', async () => {
  summaryEl.textContent = '수동 동기화 실행 중...';
  try {
    const result = await sendMessage('runSyncNow', {});
    renderStatus(result, null);
  } catch (error) {
    summaryEl.textContent = `실패: ${error.message}`;
  }
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refresh().catch((error) => {
  summaryEl.textContent = `상태 조회 실패: ${error.message}`;
});
