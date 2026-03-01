// 동기화 게시글 HTML(표 포함) 렌더링 보존/정화 계약 테스트.
import { describe, expect, it } from 'vitest';
import { renderStoredContentHtml, sanitizeStoredContentHtml } from '../src/pages/post-page/utils.js';

describe('post page stored html rendering', () => {
  it('keeps table structure and removes unsafe tags/attributes', () => {
    const input = `
      <div>
        <script>alert(1)</script>
        <table onclick="evil()">
          <thead><tr><th scope="col">날짜</th><th>요일</th></tr></thead>
          <tbody>
            <tr><td colspan="2">3/3</td></tr>
            <tr><td><a href="javascript:alert(1)">bad</a></td><td><a href="https://example.com">ok</a></td></tr>
          </tbody>
        </table>
      </div>
    `;

    const html = sanitizeStoredContentHtml(input);
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('colspan="2"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
  });

  it('prefers contentHtml over plain delta fallback when available', () => {
    const rendered = renderStoredContentHtml({
      contentHtml: '<table><tr><th>날짜</th></tr><tr><td>3/3</td></tr></table>',
      contentDelta: { ops: [{ insert: 'plain text only\n' }] }
    });

    expect(rendered).toContain('stored-html-content');
    expect(rendered).toContain('<table>');
    expect(rendered).not.toContain('plain text only');
  });
});
