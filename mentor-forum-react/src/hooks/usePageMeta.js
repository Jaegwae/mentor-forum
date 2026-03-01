/**
 * 페이지 진입/이탈 시 문서 메타를 복구 가능한 형태로 관리하는 훅.
 * - title과 body class를 페이지 단위로 교체한다.
 * - unmount 시 이전 값을 원복해 다른 페이지에 side-effect가 전파되지 않게 한다.
 */
import { useEffect } from 'react';

export function usePageMeta(title, bodyClass) {
  useEffect(() => {
    // 페이지별 메타를 적용하기 전에 기존 값을 보관한다.
    const prevTitle = document.title;
    const prevBodyClass = document.body.className;

    if (title) document.title = title;
    document.body.className = bodyClass || '';

    return () => {
      document.title = prevTitle;
      document.body.className = prevBodyClass;
    };
  }, [title, bodyClass]);
}
