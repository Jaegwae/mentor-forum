// 라우팅 스모크 테스트:
// 페이지 컴포넌트를 mock으로 치환해 라우트 매핑 자체만 빠르게 검증한다.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/pages/LoginPage.jsx', () => ({ default: () => <div>LOGIN_ROUTE_OK</div> }));
vi.mock('../src/pages/SignupPage.jsx', () => ({ default: () => <div>SIGNUP_ROUTE_OK</div> }));
vi.mock('../src/pages/AppPage.jsx', () => ({ default: () => <div>APP_ROUTE_OK</div> }));
vi.mock('../src/pages/PostPage.jsx', () => ({ default: () => <div>POST_ROUTE_OK</div> }));
vi.mock('../src/pages/AdminPage.jsx', () => ({ default: () => <div>ADMIN_ROUTE_OK</div> }));
vi.mock('../src/pages/MyPostsPage.jsx', () => ({ default: () => <div>MY_POSTS_ROUTE_OK</div> }));
vi.mock('../src/pages/MyCommentsPage.jsx', () => ({ default: () => <div>MY_COMMENTS_ROUTE_OK</div> }));
vi.mock('../src/pages/NotFoundPage.jsx', () => ({ default: () => <div>NOT_FOUND_ROUTE_OK</div> }));

import App from '../src/App.jsx';

afterEach(() => {
  cleanup();
});

async function renderAt(pathname) {
  // MemoryRouter가 아니라 실제 history pathname을 밀어 넣어 App 라우팅을 확인한다.
  window.history.pushState({}, '', pathname);
  render(<App />);
}

describe('route smoke', () => {
  it('renders /login route', async () => {
    await renderAt('/login');
    expect(await screen.findByText('LOGIN_ROUTE_OK')).toBeInTheDocument();
  });

  it('renders /app route', async () => {
    await renderAt('/app');
    expect(await screen.findByText('APP_ROUTE_OK')).toBeInTheDocument();
  });

  it('renders /post route', async () => {
    await renderAt('/post');
    expect(await screen.findByText('POST_ROUTE_OK')).toBeInTheDocument();
  });

  it('renders /admin route', async () => {
    await renderAt('/admin');
    expect(await screen.findByText('ADMIN_ROUTE_OK')).toBeInTheDocument();
  });
});
