/**
 * 카드 레이아웃 primitive 세트.
 * - 페이지별 카드 UI를 동일한 spacing/typography 규칙으로 재사용한다.
 * - 시맨틱 태그(`section`, `h2`)를 기본 제공해 접근성 기준을 맞춘다.
 */
import React from 'react';
import { cn } from '../../lib/utils.js';

const Card = React.forwardRef(({ className, ...props }, ref) => (
  // 컨테이너는 기본적으로 border + shadow를 제공하고, 페이지에서 className으로 확장한다.
  <section
    ref={ref}
    className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)}
    {...props}
  />
));

Card.displayName = 'Card';

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  // title/description 간 기본 수직 간격을 고정한다.
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5 pb-3', className)} {...props} />
));

CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
));

CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));

CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
));

CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-5 pt-0', className)} {...props} />
));

CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
