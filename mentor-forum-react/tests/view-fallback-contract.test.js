// View fallback contract tests.
// - Locks a few important fallback/message bindings in the large page views so
//   future refactors do not silently hide controller error messages again.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('view fallback contracts', () => {
  it('PostPageView surfaces controller message text when currentPost is missing', () => {
    const source = readSource('src/pages/post-page/PostPageView.jsx');
    expect(source).toContain("message.text || '게시글 정보를 불러오지 못했습니다.'");
  });

  it('AppPageView keeps page-level message rendering', () => {
    const source = readSource('src/pages/app-page/AppPageView.jsx');
    expect(source).toContain('pageMessage.text');
    expect(source).toContain("{pageMessage.text}");
  });

  it('AdminPageView keeps top-level message rendering', () => {
    const source = readSource('src/pages/admin-page/AdminPageView.jsx');
    expect(source).toContain('message.text');
    expect(source).toContain('{message.text}');
  });
});
