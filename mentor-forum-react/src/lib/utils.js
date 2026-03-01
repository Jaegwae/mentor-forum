/**
 * UI 공통 유틸리티.
 * - `clsx`로 조건부 class를 조합하고 `tailwind-merge`로 충돌 클래스를 정리한다.
 */
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  // 마지막에 선언된 Tailwind class가 우선되도록 merge를 적용한다.
  return twMerge(clsx(inputs));
}
