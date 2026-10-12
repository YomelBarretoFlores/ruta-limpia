# Data retention and the personal-data purge

Households' personal data are kept for a fixed period and then purged with one command,
`data:purge`. The indicators and exports keep working on what stays. This page is for the operator
who runs the purge and for whoever confirms the retention period with the municipality.

> **Default policy (to be confirmed with the municipality):** personal data are kept until
> **12 months after the pilot ends** (pilot end: 20 December 2026, so until **20 December 2027**).
> The code derives that date from two constants, `PILOT_END_DATE` and `RETENTION_MONTHS`
> (`apps/api/src/privacy/domain/retention-policy.ts`): a confirmed period changes one number.
> The proposal requires that each household is told the retention period at enrolment (p. 17) and
> that the project follows Ley 29733 (personal data protection). Record the confirmed period in
> the handover record (`docs/entrega/acta-transferencia.md`).

## Quick path

1. Export every indicator and CSV the final report needs (panel, **Exportaciones** and
   **Indicadores**). After a purge, adoption (I5, I6) for the purged weeks can no longer be
   recomputed (see [What is purged](#what-is-purged)).
2. Take a backup: [`backup-restore.md`](backup-restore.md#take-a-backup-now).
3. Preview:

   ```bash
   export RUTA_LIMPIA_VERSION="$(cat /etc/ruta-limpia/release)"
   docker compose -f infra/prod/docker-compose.prod.yml run --rm api \
     node dist/privacy/infrastructure/purge-cli.js --dry-run
   ```

4. Purge (same command without `--dry-run`). It prints the counts and records a `privacy.purge`
   event in the audit trail.

On a development machine the same command is `pnpm --filter api data:purge [--dry-run]`.

## The cutoff

| Option                | Cutoff                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| none                  | 20 December 2027, 00:00 America/Lima (the default retention end).         |
| `--before YYYY-MM-DD` | That day, 00:00 America/Lima. Use only for a period the municipality set. |

A cutoff after today is refused before the command connects to the database, and so are an
invalid date and an unknown option: the command cannot purge data that are still within their
retention period. So running it with the default before 20 December 2027 stops with an error and
changes nothing.

## What is purged

Everything runs in one database transaction: either all of it applies or none.

| Data                                         | Rule (older than the cutoff)                                                                     | Action                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Push subscriptions (browser endpoint, keys)  | Last activity before the cutoff: revocation time, else last successful push, else creation time. | Deleted, with their deliveries.                                                 |
| Alert deliveries (alert ↔ subscription link) | Sent before the cutoff, or belonging to a deleted subscription.                                  | Deleted.                                                                        |
| App views                                    | Viewed before the cutoff.                                                                        | Household and subscription links cleared; the point and the time stay.          |
| App views from the cutoff on                 | Linked to a subscription the purge deletes.                                                      | Subscription link cleared before the subscription is deleted.                   |
| Household codes                              | Inactive household whose last change is before the cutoff.                                       | Code replaced by `ANON-<10 hex>`, notes erased, every later link to it cleared. |

Running the purge again changes nothing more (anonymous codes are never re-anonymized).

### What the counts mean

The command prints these counts, and the `privacy.purge` audit event stores them (never a code, an
endpoint or a note). Each changed row is counted once.

| Printed line                    | Audit field                   | Counts                                                                      |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| households anonymized           | `householdsAnonymized`        | Inactive households given an anonymous code.                                |
| app views before the cutoff     | `viewsUnlinked`               | Views before the cutoff that lost their household or subscription link.     |
| later links to those households | `householdLinksCleared`       | Their subscriptions (any date) and their views from the cutoff on.          |
| later views of deleted devices  | `viewsOfDeletedSubscriptions` | Views from the cutoff on that pointed to a subscription the purge deletes.  |
| alert deliveries deleted        | `deliveriesDeleted`           | Deliveries sent before the cutoff, or of a deleted subscription.            |
| push subscriptions deleted      | `subscriptionsDeleted`        | Subscriptions whose last activity is before the cutoff (endpoint and keys). |

## What is kept

| Data                                                                                | Why it is kept                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Trips, positions, passes (truck GPS: a municipal vehicle, not a person)             | Instrument 1, ETA precision (I1), availability (I7).                |
| Alerts: emission time, communicated ETA, recipients, delivered and failed counts    | The proposal's alert log (p. 27) and I1, aggregated per alert.      |
| Incidents, Instrument 2 field sheets, baseline logs                                 | Exposure, dispersion and noise indicators; no personal data.        |
| Households: route, point, enrolment and consent dates, consent version, active flag | Denominators of adoption; the code becomes anonymous when inactive. |
| Instrument 3 surveys (linked to the household row, now under an anonymous code)     | Satisfaction, perceived noise (I4, I6, I9).                         |
| App views: point and time                                                           | Aggregate usage per point.                                          |
| Panel users, sessions, audit trail                                                  | Municipal staff accounts, outside this policy.                      |

What the purge breaks on purpose: adoption (I5, I6) counts a household as active from its linked
views and its delivered alerts. Both links are gone for purged weeks, so recomputing those weeks
afterwards gives zero. Export the indicators first.

Not covered by this command (handle by hand if needed):

- **Active households** keep their `H-###` code until they are deactivated in the panel and the
  cutoff passes their last change. At the end of the service, deactivate every household first.
- **Free text in surveys** (`q14_other`, `q15_alt_channel`) is kept; it should describe channels,
  not people. Review it before the purge if in doubt.
- **Backups** keep purged data until they rotate out: 7 daily and 4 weekly copies, so about
  one month (see [`backup-restore.md`](backup-restore.md)). Copies taken off the server must be
  deleted by whoever holds them.

## Checklist

- [ ] The municipality confirmed the retention period (handover record).
- [ ] Final indicators and CSV exports archived.
- [ ] Every household deactivated, if the service has ended.
- [ ] Backup taken; dry run reviewed; purge run; counts written in the operations log.
- [ ] Off-server backup copies older than the cutoff deleted after one month.
