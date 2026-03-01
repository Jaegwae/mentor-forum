/**
 * Vitest 전역 테스트 셋업.
 * - Testing Library matcher(toBeInTheDocument 등)를 모든 테스트 파일에서 사용 가능하게 등록한다.
 */
// 각 테스트 파일에서 개별 import를 반복하지 않도록 중앙 등록한다.
import '@testing-library/jest-dom/vitest';
