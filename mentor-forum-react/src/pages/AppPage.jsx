/**
 * App 메인 페이지 thin wrapper.
 * - 페이지 메타, 라우터 훅, 테마 훅만 연결한다.
 * - 실제 상태/이펙트/렌더링은 app-page/controller+view 모듈에 위임한다.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { useTheme } from '../hooks/useTheme.js';
import { useAppPageController } from './app-page/useAppPageController.js';
import { AppPageView } from './app-page/AppPageView.jsx';

export default function AppPage() {
  usePageMeta('멘토스', 'app-page');

  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  // 기존 JSX에서 사용하던 식별자 이름을 controller가 그대로 제공한다.
  const vm = useAppPageController({ navigate, location, theme, toggleTheme });

  return <AppPageView vm={vm} />;
}
