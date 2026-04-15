// Thin wrapper contract tests.
// - Guards the route-entry page files so they continue delegating runtime logic
//   to controllers/views instead of growing stateful logic inline again.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('page wrapper contracts', () => {
  it('AppPage stays a controller + view thin wrapper', () => {
    const source = readSource('src/pages/AppPage.jsx');
    expect(source).toContain("useAppPageController");
    expect(source).toContain("AppPageView");
    expect(source).toContain("const vm = useAppPageController");
    expect(source).toContain("return <AppPageView vm={vm} />");
  });

  it('PostPage stays a controller + view thin wrapper', () => {
    const source = readSource('src/pages/PostPage.jsx');
    expect(source).toContain("usePostPageController");
    expect(source).toContain("PostPageView");
    expect(source).toContain("const vm = usePostPageController");
    expect(source).toContain("return <PostPageView vm={vm} />");
  });

  it('AdminPage stays a controller + view thin wrapper', () => {
    const source = readSource('src/pages/AdminPage.jsx');
    expect(source).toContain("useAdminPageController");
    expect(source).toContain("AdminPageView");
    expect(source).toContain("const vm = useAdminPageController");
    expect(source).toContain("return <AdminPageView vm={vm} />");
  });
});
