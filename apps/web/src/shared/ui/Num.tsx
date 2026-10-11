import type { ReactNode } from 'react';

/** Times, counts and codes with tabular figures, so they line up and do not jitter on update. */
export function Num({ children }: { readonly children: ReactNode }) {
  return <span className="num">{children}</span>;
}
