/**
 * Post 상세 페이지 thin wrapper.
 * - 컨트롤러에서 VM을 만들고 View에 전달하는 연결 레이어만 담당한다.
 */
import React from 'react';
import { usePostPageController } from './post-page/usePostPageController.jsx';
import { PostPageView } from './post-page/PostPageView.jsx';

export default function PostPage() {
  // VM 인터페이스는 기존 PostPage JSX 식별자와 1:1로 맞춘다.
  const vm = usePostPageController();
  return <PostPageView vm={vm} />;
}
