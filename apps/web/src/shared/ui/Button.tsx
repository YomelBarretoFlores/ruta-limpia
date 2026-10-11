import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary';
}

/** A large, high-contrast button (at least 48 px tall). */
export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
