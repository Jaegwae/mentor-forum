// 최소 라우트 가용성만 확인하는 브라우저 스모크 테스트.
// CI/로컬에서 무거운 E2E를 기본 비활성화하고 RUN_E2E=1일 때만 실행한다.
import { test, expect } from '@playwright/test';

const runE2E = process.env.RUN_E2E === '1';

test.describe('core flow smoke', () => {
  // 기본 파이프라인에서는 비활성화하고, 명시 플래그가 있을 때만 실행한다.
  test.skip(!runE2E, 'Set RUN_E2E=1 to run browser smoke flows.');

  test('login route loads', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText('멘토스');
  });

  test('app route is reachable', async ({ page }) => {
    const response = await page.goto('/app');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('post route is reachable', async ({ page }) => {
    const response = await page.goto('/post');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('admin route is reachable', async ({ page }) => {
    const response = await page.goto('/admin');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });
});
