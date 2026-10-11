import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { EventSourceLike } from '../../citizen/live/live-connection';
import { PanelDepsContext } from '../panel-deps';
import { fakePanelApi, fakePanelDeps } from '../test/fake-panel-deps';
import { useLivePanel } from './useLivePanel';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string) {
    this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type));
  }
}

describe('useLivePanel', () => {
  it('reports "connecting" again for a newly selected route until its stream opens', () => {
    const streams: FakeStream[] = [];
    const deps = {
      ...fakePanelDeps(fakePanelApi()),
      createEventSource: (url: string) => {
        const stream = new FakeStream(url);
        streams.push(stream);
        return stream;
      },
    };
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <PanelDepsContext.Provider value={deps}>{children}</PanelDepsContext.Provider>
    );
    const { result, rerender } = renderHook(({ route }) => useLivePanel(route), {
      wrapper,
      initialProps: { route: 'RI-01' },
    });
    act(() => streams[0]!.emit('snapshot'));
    expect(result.current.connection).toBe('live');

    rerender({ route: 'RI-02' });

    expect(result.current.connection).toBe('connecting');
    expect(streams.at(-1)?.url).toBe('/api/live/routes/RI-02/stream');
    act(() => streams.at(-1)!.emit('snapshot'));
    expect(result.current.connection).toBe('live');
  });
});
