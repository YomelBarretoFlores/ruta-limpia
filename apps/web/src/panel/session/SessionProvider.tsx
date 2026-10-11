import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from '../../shared/http';
import type { PanelUser } from '../api/types';
import { errorMessage } from '../components/errors';
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
  const signOut = useCallback(async (): Promise<string | null> => {
    try {
      await api.logout();
    } catch (error) {
      // A 401: the session had already ended on the server, so the person is signed out anyway.
      // Otherwise the server-side session may still be open: say so instead of pretending.
      if (!(error instanceof ApiError && error.status === 401)) return errorMessage(error);
    }
    setState({ status: 'anonymous', expired: false });
    return null;
  }, [api]);

  const session = useMemo<Session>(
    () => ({ state, signedIn, signOut }),
    [state, signedIn, signOut],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
