/**
 * Radix Dialog 기반 모달 primitive.
 * - 오버레이/포털/키보드 포커스 트랩은 Radix 동작을 그대로 사용한다.
 * - 디자인 시스템 class만 얹어서 페이지별 모달 스타일을 통일한다.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-[200] bg-gray-950/40 backdrop-blur-[1px]', className)}
      {...props}
    />
  );
});

const DialogContent = React.forwardRef(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPortal>
      {/* 오버레이와 콘텐츠를 동일 포털 레이어(z-index)로 고정 */}
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-[200] w-[calc(100%-2rem)] max-w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-lg',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">닫기</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

const DialogHeader = function DialogHeader({ className, ...props }) {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
  );
};

const DialogFooter = function DialogFooter({ className, ...props }) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  );
};

const DialogTitle = React.forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
});

const DialogDescription = React.forwardRef(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
};
