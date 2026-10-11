import { ApiError, type FetchLike } from '../../shared/http';
import type { RouteDetail, RouteSummary } from '../../citizen/api/types';
import type {
  BaselineLog,
  BaselineLogInput,
  BaselineQuery,
  Household,
  HouseholdChanges,
  HouseholdListItem,
  HouseholdQuery,
  Incident,
  IndicatorQuery,
  IndicatorReport,
  IncidentChanges,
  IncidentQuery,
  NewHousehold,
  NewIncident,
  NewUser,
  Observation,
  ObservationProblem,
  ObservationQuery,
  ObservationSheet,
  Paged,
  PanelLiveSnapshot,
  PanelUser,
  Sticker,
  Trip,
  TripDetail,
  TripQuery,
  UserChanges,
  Vehicle,
} from './types';

/** The header every mutating panel request carries (with `SameSite=Strict`, the CSRF defense). */
export const CSRF_HEADER = { name: 'X-Requested-With', value: 'ruta-limpia' } as const;

/** A panel answer outside 2xx: the API's code plus what the panel shows next to the fields. */
export class PanelApiError extends ApiError {
  constructor(
    status: number,
    code: string | null,
    /** `422 invalid_observation`: the inconsistencies of a field sheet. */
    readonly problems: readonly ObservationProblem[] = [],
    /** `400 weak_password`: `too_short` or `too_long`. */
    readonly problem: string | null = null,
    /** `422 duplicate_point` and `unknown_point` of a baseline log name the point. */
    readonly pointCode: string | null = null,
  ) {
    super(status, code);
  }
}

export interface PanelApiOptions {
  readonly fetch: FetchLike;
  /** Called on `401` (no valid session) from any call but the login. */
  readonly onUnauthorized?: () => void;
  readonly baseUrl?: string;
}

export interface PanelApi {
  login(username: string, password: string): Promise<PanelUser>;
  logout(): Promise<void>;
  me(): Promise<PanelUser>;
  listRoutes(): Promise<readonly RouteSummary[]>;
  getRoute(code: string): Promise<RouteDetail>;
  liveStreamUrl(routeCode: string): string;
  getLive(routeCode: string): Promise<PanelLiveSnapshot>;
  listVehicles(): Promise<readonly Vehicle[]>;
  listTrips(query: TripQuery): Promise<Paged<Trip>>;
  getTrip(id: string): Promise<TripDetail>;
  startTrip(vehicleCode: string, routeCode: string): Promise<Trip>;
  endTrip(id: string, note: string): Promise<Trip>;
  listIncidents(query: IncidentQuery): Promise<Paged<Incident>>;
  createIncident(incident: NewIncident): Promise<Incident>;
  updateIncident(id: string, changes: IncidentChanges): Promise<Incident>;
  listHouseholds(query: HouseholdQuery): Promise<Paged<HouseholdListItem>>;
  createHousehold(household: NewHousehold): Promise<Household>;
  updateHousehold(code: string, changes: HouseholdChanges): Promise<Household>;
  getSticker(code: string): Promise<Sticker>;
  listObservations(query: ObservationQuery): Promise<Paged<Observation>>;
  getObservation(id: string): Promise<Observation>;
  createObservation(sheet: ObservationSheet): Promise<Observation>;
  updateObservation(id: string, sheet: ObservationSheet): Promise<Observation>;
  deleteObservation(id: string): Promise<void>;
  listBaselineLogs(query: BaselineQuery): Promise<Paged<BaselineLog>>;
  getBaselineLog(id: string): Promise<BaselineLog>;
  createBaselineLog(log: BaselineLogInput): Promise<BaselineLog>;
  updateBaselineLog(id: string, log: BaselineLogInput): Promise<BaselineLog>;
  deleteBaselineLog(id: string): Promise<void>;
  getIndicators(query: IndicatorQuery): Promise<IndicatorReport>;
  /** The URL of a CSV export (a plain link: the session cookie travels with it). */
  exportUrl(file: string, query?: object): string;
  listUsers(): Promise<readonly PanelUser[]>;
  createUser(user: NewUser): Promise<PanelUser>;
  updateUser(id: string, changes: UserChanges): Promise<PanelUser>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const path = (value: string) => encodeURIComponent(value);

/** `?a=1&b=x` from the defined, non-empty values of a query object. */
export function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The panel API client. Every request carries the session cookie (`credentials: 'include'`);
 * mutating ones add the CSRF header. A `401` outside the login calls `onUnauthorized` (the panel
 * sends the user back to the sign-in page) and rejects like every other failure, with a
 * `PanelApiError`. Network errors (`TypeError`) pass through.
 */
export function createPanelApi({ fetch, onUnauthorized, baseUrl = '' }: PanelApiOptions): PanelApi {
  const api = `${baseUrl}/api`;
  const panel = `${api}/panel`;

  async function request<T>(
    url: string,
    init: { method?: string; body?: unknown; isLogin?: boolean } = {},
  ): Promise<T> {
    const method = init.method ?? 'GET';
    const headers = new Headers({ accept: 'application/json' });
    if (MUTATING.has(method)) headers.set(CSRF_HEADER.name, CSRF_HEADER.value);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) {
      const error = await errorOf(response);
      if (response.status === 401 && init.isLogin !== true) onUnauthorized?.();
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const send = <T>(method: string, url: string, body?: unknown) =>
    request<T>(url, { method, body });

  return {
    login: async (username, password) =>
      (
        await request<{ user: PanelUser }>(`${panel}/auth/login`, {
          method: 'POST',
          body: { username, password },
          isLogin: true,
        })
      ).user,
    logout: () => send<void>('POST', `${panel}/auth/logout`),
    me: async () => (await request<{ user: PanelUser }>(`${panel}/auth/me`)).user,
    listRoutes: async () => (await request<{ routes: RouteSummary[] }>(`${api}/routes`)).routes,
    getRoute: (code) => request<RouteDetail>(`${api}/routes/${path(code)}`),
    liveStreamUrl: (routeCode) => `${api}/live/routes/${path(routeCode)}/stream`,
    getLive: (routeCode) => request<PanelLiveSnapshot>(`${panel}/live/routes/${path(routeCode)}`),
    listVehicles: async () =>
      (await request<{ vehicles: Vehicle[] }>(`${panel}/vehicles`)).vehicles,
    listTrips: (query) => request<Paged<Trip>>(`${panel}/trips${queryString(query)}`),
    getTrip: (id) => request<TripDetail>(`${panel}/trips/${path(id)}`),
    startTrip: async (vehicleCode, routeCode) =>
      (await send<{ trip: Trip }>('POST', `${panel}/trips`, { vehicleCode, routeCode })).trip,
    endTrip: async (id, note) =>
      (await send<{ trip: Trip }>('POST', `${panel}/trips/${path(id)}/end`, { note })).trip,
    listIncidents: (query) => request<Paged<Incident>>(`${panel}/incidents${queryString(query)}`),
    createIncident: async (incident) =>
      (await send<{ incident: Incident }>('POST', `${panel}/incidents`, incident)).incident,
    updateIncident: async (id, changes) =>
      (await send<{ incident: Incident }>('PATCH', `${panel}/incidents/${path(id)}`, changes))
        .incident,
    listHouseholds: (query) =>
      request<Paged<HouseholdListItem>>(`${panel}/households${queryString(query)}`),
    createHousehold: async (household) =>
      (await send<{ household: Household }>('POST', `${panel}/households`, household)).household,
    updateHousehold: async (code, changes) =>
      (await send<{ household: Household }>('PATCH', `${panel}/households/${path(code)}`, changes))
        .household,
    getSticker: (code) => request<Sticker>(`${panel}/households/${path(code)}/sticker`),
    listObservations: (query) =>
      request<Paged<Observation>>(`${panel}/field-observations${queryString(query)}`),
    getObservation: async (id) =>
      (await request<{ observation: Observation }>(`${panel}/field-observations/${path(id)}`))
        .observation,
    createObservation: async (sheet) =>
      (await send<{ observation: Observation }>('POST', `${panel}/field-observations`, sheet))
        .observation,
    updateObservation: async (id, sheet) =>
      (
        await send<{ observation: Observation }>(
          'PUT',
          `${panel}/field-observations/${path(id)}`,
          sheet,
        )
      ).observation,
    deleteObservation: (id) => send<void>('DELETE', `${panel}/field-observations/${path(id)}`),
    listBaselineLogs: (query) =>
      request<Paged<BaselineLog>>(`${panel}/baseline-logs${queryString(query)}`),
    getBaselineLog: async (id) =>
      (await request<{ log: BaselineLog }>(`${panel}/baseline-logs/${path(id)}`)).log,
    createBaselineLog: async (log) =>
      (await send<{ log: BaselineLog }>('POST', `${panel}/baseline-logs`, log)).log,
    updateBaselineLog: async (id, log) =>
      (await send<{ log: BaselineLog }>('PUT', `${panel}/baseline-logs/${path(id)}`, log)).log,
    deleteBaselineLog: (id) => send<void>('DELETE', `${panel}/baseline-logs/${path(id)}`),
    getIndicators: (query) => request<IndicatorReport>(`${panel}/indicators${queryString(query)}`),
    exportUrl: (file, query = {}) => `${panel}/exports/${path(file)}${queryString(query)}`,
    listUsers: async () => (await request<{ users: PanelUser[] }>(`${panel}/users`)).users,
    createUser: async (user) =>
      (await send<{ user: PanelUser }>('POST', `${panel}/users`, user)).user,
    updateUser: async (id, changes) =>
      (await send<{ user: PanelUser }>('PATCH', `${panel}/users/${path(id)}`, changes)).user,
  };
}

async function errorOf(response: Response): Promise<PanelApiError> {
  try {
    const body = (await response.json()) as {
      error?: unknown;
      problems?: unknown;
      problem?: unknown;
      pointCode?: unknown;
    };
    return new PanelApiError(
      response.status,
      typeof body.error === 'string' ? body.error : null,
      Array.isArray(body.problems) ? (body.problems as ObservationProblem[]) : [],
      typeof body.problem === 'string' ? body.problem : null,
      typeof body.pointCode === 'string' ? body.pointCode : null,
    );
  } catch {
    return new PanelApiError(response.status, null);
  }
}
