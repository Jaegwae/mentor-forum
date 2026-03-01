/**
 * Admin 페이지 thin wrapper.
 * - 라우트 엔트리에서는 controller/view 결합만 유지해 리팩토링 경계를 명확히 한다.
 */
import React from 'react';
import { useAdminPageController } from './admin-page/useAdminPageController.jsx';
import { AdminPageView } from './admin-page/AdminPageView.jsx';

export default function AdminPage() {
  // 관리자 페이지의 복잡한 상태는 controller 내부로 캡슐화되어 있다.
  const vm = useAdminPageController();
  return <AdminPageView vm={vm} />;
}
