// Application router with lazy-loaded page routes.
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const SignupPage = lazy(() => import('./pages/SignupPage.jsx'));
const AppPage = lazy(() => import('./pages/AppPage.jsx'));
const PostPage = lazy(() => import('./pages/PostPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const MyPostsPage = lazy(() => import('./pages/MyPostsPage.jsx'));
const MyCommentsPage = lazy(() => import('./pages/MyCommentsPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={(
        <main className="page flex min-h-[calc(100vh-2rem)] items-center justify-center">
          <section className="card w-full max-w-xl text-center">
            <p className="hero-kicker">Loading</p>
            <h1>페이지를 불러오는 중입니다.</h1>
            <p className="hero-copy">잠시만 기다려주세요.</p>
          </section>
        </main>
      )}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />

          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/app" element={<AppPage />} />
          <Route path="/post" element={<PostPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/me/posts" element={<MyPostsPage />} />
          <Route path="/me/comments" element={<MyCommentsPage />} />

          <Route path="/login.html" element={<Navigate to="/login" replace />} />
          <Route path="/signup.html" element={<Navigate to="/signup" replace />} />
          <Route path="/app.html" element={<Navigate to="/app" replace />} />
          <Route path="/post.html" element={<Navigate to="/post" replace />} />
          <Route path="/admin.html" element={<Navigate to="/admin" replace />} />
          <Route path="/me/posts.html" element={<Navigate to="/me/posts" replace />} />
          <Route path="/me/comments.html" element={<Navigate to="/me/comments" replace />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
