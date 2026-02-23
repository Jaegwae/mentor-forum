// Hook to manage document title and body class per page.
import { useEffect } from 'react';

export function usePageMeta(title, bodyClass) {
  useEffect(() => {
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
