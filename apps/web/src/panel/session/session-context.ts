import { createContext, useContext } from 'react';

import type { PanelUser } from '../api/types';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'anonymous'; readonly expired: boolean }
  | { readonly status: 'authenticated'; readonly user: PanelUser };

export interface Session {
  readonly state: SessionState;
  readonly signedIn: (user: PanelUser) => void;
  readonly signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession outside SessionProvider');
  return session;
}

/** The signed-in user; only inside `RequireSession`. */
export function useUser(): PanelUser {
  const { state } = useSession();
  if (state.status !== 'authenticated') throw new Error('useUser without a session');
  return state.user;
}
