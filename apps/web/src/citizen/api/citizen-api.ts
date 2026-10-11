import { requestJson, type FetchLike } from '../../shared/http';
import type {
  LiveSnapshot,
  RouteDetail,
  RouteSummary,
  SubscribeRequest,
  SubscribeResponse,
  ViewRequest,
} from './types';

/** The public API calls of the citizen app. Every method throws `ApiError` for non-2xx answers. */
export interface CitizenApi {
  listRoutes(): Promise<readonly RouteSummary[]>;
  getRoute(code: string): Promise<RouteDetail>;
  getLiveSnapshot(routeCode: string): Promise<LiveSnapshot>;
  /** URL of the live stream (Server-Sent Events) of a route. */
  liveStreamUrl(routeCode: string): string;
  getVapidPublicKey(): Promise<string>;
  subscribe(request: SubscribeRequest): Promise<SubscribeResponse>;
  cancelSubscription(subscriptionId: string, managementToken: string): Promise<void>;
  recordView(request: ViewRequest): Promise<void>;
}

const path = (code: string) => encodeURIComponent(code);

/** The API client over `fetch`. `baseUrl` is empty when the API shares the origin (`/api`). */
export function createCitizenApi(fetchFn: FetchLike, baseUrl = ''): CitizenApi {
  const api = `${baseUrl}/api`;
  return {
    async listRoutes() {
      const body = await requestJson<{ routes: RouteSummary[] }>(fetchFn, `${api}/routes`);
      return body.routes;
    },
    getRoute: (code) => requestJson<RouteDetail>(fetchFn, `${api}/routes/${path(code)}`),
    getLiveSnapshot: (routeCode) =>
      requestJson<LiveSnapshot>(fetchFn, `${api}/live/routes/${path(routeCode)}`, {
        cache: 'no-store',
      }),
    liveStreamUrl: (routeCode) => `${api}/live/routes/${path(routeCode)}/stream`,
    async getVapidPublicKey() {
      const body = await requestJson<{ publicKey: string }>(
        fetchFn,
        `${api}/push/vapid-public-key`,
      );
      return body.publicKey;
    },
    subscribe: (request) =>
      requestJson<SubscribeResponse>(fetchFn, `${api}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    cancelSubscription: (subscriptionId, managementToken) =>
      requestJson<void>(fetchFn, `${api}/subscriptions/${path(subscriptionId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${managementToken}` },
      }),
    recordView: (request) =>
      requestJson<void>(fetchFn, `${api}/usage/views`, {
        method: 'POST',
        body: JSON.stringify(request),
        keepalive: true,
      }),
  };
}
