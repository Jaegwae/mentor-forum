/**
 * 공통 입력 필드 primitive.
 * - 포커스/비활성/placeholder 상태의 시각 규칙을 중앙화한다.
 */
import React from 'react';
import { cn } from '../../lib/utils.js';

const Input = React.forwardRef(({ className, type = 'text', ...props }, ref) => (
  // 타입별 동작은 브라우저 기본을 따르되, 외형 스타일은 일관되게 유지한다.
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));

Input.displayName = 'Input';

export { Input };
