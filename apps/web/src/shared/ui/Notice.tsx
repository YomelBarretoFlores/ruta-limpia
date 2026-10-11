import type { ReactNode } from 'react';

export interface NoticeProps {
  readonly tone: 'info' | 'warning' | 'success' | 'error';
  readonly children: ReactNode;
}

/** A highlighted message. Errors are announced to screen readers at once. */
export function Notice({ tone, children }: NoticeProps) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
