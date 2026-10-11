# Manual check: real Web Push notifications in Chrome

Automated tests replace the push services with a fake. This check proves the real path once per
environment (local, then production): the citizen app subscribes in Chrome, the simulated truck
drives RI-01, and the phone or desktop shows one notification per point, confirmed back to the API.
It takes about 20 minutes.

## Before you start

- [ ] VAPID keys in the root `.env` (`pnpm --filter api vapid:generate mailto:…`; set all three
      `VAPID_*` values). Without them the subscription endpoints answer `503`.
- [ ] Stack running: `pnpm infra:up`, `pnpm dev` (API :3000, web :5173). In production use the
      public HTTPS address instead of `localhost`: Web Push needs a secure origin, and `localhost`
      is the only exception.
- [ ] Traccar prepared: `pnpm sim:bootstrap` (see [`docs/simulator.md`](../simulator.md)).
- [ ] Chrome desktop or Android, with notifications allowed for the site and not in "Do not
      disturb". No trip of UNIDAD-A running (the panel's Seguimiento shows none).

## Quick path

1. **Subscribe.** Open http://localhost:5173/?p=P12 in Chrome (a far point leaves time for the
   alert). Tap **Activar avisos**, accept the consent, and allow notifications when Chrome asks.
   The app confirms the subscription to P12.
2. **Drive.** In a terminal, run `pnpm sim:drive` (real time, about 16 minutes).
3. **Watch.** In the panel (http://localhost:5173/panel → Seguimiento) the truck moves, P01, P02…
   are passed, and the ETAs count down.
4. **Receive.** When P12's ETA reaches about 10 minutes, Chrome shows one notification: "El camión
   recolector pasará por P12 en ~… min". Tapping it opens the app on P12.
5. **Confirm.** Check the receipt and that nothing was sent twice (step "Verify" below).
6. **Cancel.** In the app, tap **Cancelar avisos**. Drive again: no notification arrives.

## Verify

| What                | Where                                                                               | Expected                                                        |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| One alert per point | Panel → Seguimiento → the pass table, P12 row                                       | One alert, sent 1, received 1, failed 0                         |
| One delivery        | `SELECT status, http_status, received_at FROM alert_deliveries;`                    | One `sent` row for P12 (HTTP `201` from FCM), `received_at` set |
| Receipt endpoint    | API log, or the browser's DevTools → Application → Service workers                  | `POST /api/alerts/<alertId>/receipts` answered `204` once       |
| No duplicates       | `SELECT trip_id, point_id, count(*) FROM alerts GROUP BY 1, 2 HAVING count(*) > 1;` | No rows                                                         |
| Cancel works        | After step 6, `SELECT revoked_at, revoke_reason FROM push_subscriptions;`           | `revoked_at` set: the subscription is no longer active          |

Run the SQL with `docker compose -f infra/docker-compose.yml exec db sh -c 'psql -U "$POSTGRES_USER"
"$POSTGRES_DB"'` (the container has the values of your `.env`).

## If no notification arrives

| Symptom                             | Check                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "Activar avisos" fails              | VAPID keys missing (`GET /api/push/vapid-public-key` answers `503`), or the page is not on a secure origin.                 |
| Alert row exists, delivery `failed` | VAPID subject or keys wrong; the API log shows the push service's status.                                                   |
| Delivery `sent`, no notification    | Chrome's site notifications blocked, OS focus mode, or the service worker not active (DevTools → Application).              |
| No alert at all                     | The truck did not start a trip: check that Traccar forwards (`docker compose … logs traccar`) and the API's `INGEST_TOKEN`. |

## Record

Write down the date, the environment, the browser and device, and the result of each row of
"Verify" in the pilot log. Repeat after any change of VAPID keys, domain or service worker.
