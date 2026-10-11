import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary`: solid accent, one per view; `secondary`: outlined; `destructive`: an underlined
   * text button in the danger color (cancel, delete).
   */
  readonly variant?: 'primary' | 'secondary' | 'destructive';
}

/** A flat button, at least 48 px tall (40 px in the panel). */
export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
