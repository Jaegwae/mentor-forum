// 리치 에디터 델타/저장 포맷 변환 계약을 검증하는 단위 테스트.
import { describe, expect, it } from 'vitest';
import {
  deltaToPayload,
  payloadToQuillDelta,
  sanitizeDeltaAttributes,
  sanitizeHttpUrl
} from '../src/services/editor/rich-editor-transform.js';
describe('rich-editor transform', () => {
  // 보안: 위험 스킴은 저장 단계에서 제거되어야 한다.
  it('sanitizes http url only', () => {
    expect(sanitizeHttpUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeHttpUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBe('');
  });

  it('normalizes delta attributes and clamps values', () => {
    const attrs = sanitizeDeltaAttributes({
      bold: true,
      header: 3,
      align: 'justify',
      list: 'ordered',
      indent: 99,
      size: '72px',
      link: 'javascript:evil()'
    }, 10, 48);

    expect(attrs.bold).toBe(true);
    expect(attrs.list).toBe('ordered');
    expect(attrs.align).toBe('justify');
    expect(attrs.indent).toBe(8);
    expect(attrs.size).toBe('48px');
    expect(attrs.link).toBeUndefined();
    expect(attrs.header).toBeUndefined();
  });

  it('converts payload to quill delta with trailing newline', () => {
    const delta = payloadToQuillDelta({
      text: 'hello',
      runs: [
        {
          start: 0,
          end: 5,
          style: { bold: true, fontSize: 24 }
        }
      ]
    }, 10, 48);

    // Quill 규약상 마지막 op는 줄바꿈이어야 한다.
    expect(Array.isArray(delta.ops)).toBe(true);
    expect(delta.ops[delta.ops.length - 1].insert).toBe('\n');
  });

  it('converts mention-chip delta back to payload text', () => {
    const payload = deltaToPayload({
      ops: [
        { insert: { 'mention-chip': { uid: 'u1', nickname: 'tester' } } },
        { insert: ' hello\n' }
      ]
    }, 10, 48);

    expect(payload.text).toBe('@tester hello');
    expect(payload.runs.length).toBeGreaterThan(0);
  });
});
