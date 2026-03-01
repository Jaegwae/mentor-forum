/**
 * 공통 폼 라벨 primitive.
 * - disabled peer와 연동된 opacity/cursor 규칙을 기본 제공한다.
 */
import React from 'react';
import { cn } from '../../lib/utils.js';

const Label = React.forwardRef(({ className, ...props }, ref) => (
  // 라벨 시각 규칙만 담당하고 htmlFor 연결은 호출부가 결정한다.
  <label
    ref={ref}
    className={cn('text-sm font-medium text-foreground/90 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
    {...props}
  />
));

Label.displayName = 'Label';

export { Label };
