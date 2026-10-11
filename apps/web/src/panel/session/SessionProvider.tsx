import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { PanelUser } from '../api/types';
import { usePanelDeps } from '../panel-deps';
import { SessionContext, type Session, type SessionState } from './session-context';

/**
 * Who is signed in: asks `GET /auth/me` once, then follows sign-in, sign-out and any `401` (the
 * session ended on the server: idle, revoked, expired), which turns the state anonymous.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const { api, onSessionExpired } = usePanelDeps();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    api.me().then(
      (user) => current && setState({ status: 'authenticated', user }),
      () => current && setState({ status: 'anonymous', expired: false }),
    );
    return () => {
      current = false;
    };
  }, [api]);

  useEffect(
    () =>
      onSessionExpired(() =>
        setState((previous) =>
          previous.status === 'authenticated' ? { status: 'anonymous', expired: true } : previous,
        ),
      ),
    [onSessionExpired],
  );

  const signedIn = useCallback(
    (user: PanelUser) => setState({ status: 'authenticated', user }),
    [],
  );
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ status: 'anonymous', expired: false });
    }
  }, [api]);

  const session = useMemo<Session>(
    () => ({ state, signedIn, signOut }),
    [state, signedIn, signOut],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
