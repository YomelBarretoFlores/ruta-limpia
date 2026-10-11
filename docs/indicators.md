# Impact indicators (Tabla 16)

The panel computes the nine impact indicators of the proposal (Tabla 16, §11.1) from the system logs
and the three field instruments, exactly as recorded: nothing is inferred, filled in or rebuilt
afterwards. This page gives each indicator's operational definition, the methodological decisions
taken for the pilot, the data each one reads, and how to reproduce the paired tests.

## Quick path

1. Panel → **Indicadores**: choose the route and the period (for example Fase 3, S5–S8).
2. Read the table: value, target, valid and missing records, baseline → exit, change, and the
   state (Cumple / No cumple / Sin datos).
3. For analysis outside the panel, download `indicadores.csv` and the instrument exports from
   **Exportaciones**.

API: `GET /api/panel/indicators?route=RI-01&from=YYYY-MM-DD&to=YYYY-MM-DD` (permission
`indicators:read`: administrators, supervisors and observers).

## The period and the phases

Phases such as Fase 3 are not stored in the database. Every request names a route and an inclusive
period of local dates (America/Lima):

| Indicators | What the period selects                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| I1, I5, I7 | The logs of the period (trips, views, alerts, positions).                                                                     |
| I6         | The "active households" (the I5 rule in at least one week of the period).                                                     |
| I2, I3, I8 | Nothing: the Instrument 2 sheets compare their stored `phase` (`baseline` vs `post`; `intervention` sheets are not compared). |
| I4, I9     | Nothing: the Instrument 3 surveys compare their stored `wave` (`pre` vs `post`).                                              |

## Definitions

Medians take the mean of the two middle values for an even count. Every indicator reports
`nValid` (records in the computation), `nMissing` (records that could not enter it) and, where the
instrument defines one, `nIncomplete`.

| ID  | Indicator                  | Operational definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Target and state                      |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| I1  | Precisión del ETA          | Median of \|communicated ETA − actual pass\| in minutes, over the Instrument 1 rows (`instrument1_route_log`) of the trips that **ended** with a service date in the period. A point-trip without an alert sent, or without a recorded pass, is missing: a prediction is never reconstructed.                                                                                                                                                                                                                                                                              | ≤ 5 min                               |
| I2  | Exposición                 | Median of `field_observations.exposure_minutes` per phase. A sheet with `exposure_incomplete` (placement seen before the observation began: a minimum time) is counted as incomplete and kept out of the median; a sheet without minutes is missing.                                                                                                                                                                                                                                                                                                                       | Relative change ≤ −30 %               |
| I3  | Dispersión                 | Events / valid point-trips per phase. A sheet is an **event** when `dispersion` is `few` or `many`; it is valid when `dispersion` is recorded and its window is comparable (`comparable_window` is not `false`). Secondary rates, never used for the target: sheets with `broken_bags > 0`, and sheets with `waste_remaining_after_pass`, among those that recorded them.                                                                                                                                                                                                  | Relative change ≤ −30 %               |
| I4  | Disposición oportuna       | % of households answering Q2 = "0–15 min" per wave ("Después del paso" counts as not timely). A survey without Q2 is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Change ≥ +30 p.p.                     |
| I5  | Adopción                   | Per America/Lima week (Monday–Sunday, clipped to the period): households of the route that are active and enrolled on or before the week's end form the denominator; the numerator is those with ≥ 1 app view linked to the household **or** ≥ 1 alert delivery with status `sent` to one of its subscriptions. The value pools the weeks: household-weeks with use / enrolled household-weeks. Views and subscriptions without a household never count. `details.confirmedValue` is the stricter rate with a confirmed reception (`received_at`) instead of a sent alert. | ≥ 70 %                                |
| I6  | Satisfacción               | % of active households (I5 rule in at least one week of the period) answering Q11 = 4 or 5, among the active households with a post survey and a Q11 answer. Active households without one are missing.                                                                                                                                                                                                                                                                                                                                                                    | ≥ 80 %                                |
| I7  | Disponibilidad             | Each trip of the route is cut into consecutive 60 s intervals from its start to its end (now for a running trip); intervals inside the period count. An interval is available when the vehicle's latest **valid** position received by the interval's end has a fix time at most 60 s before that end.                                                                                                                                                                                                                                                                     | ≥ 95 %                                |
| I8  | Duración del aviso musical | Median of `music_seconds` per phase, at the points that observe the music (`reference_points.observes_music`: P04, P08, P12), over comparable windows (`comparable_window` not `false`). A sheet there without music seconds, or with a non-comparable window, is missing. The field protocol fixes the window length.                                                                                                                                                                                                                                                     | Relative change ≤ −30 % (conditional) |
| I9  | Molestia sonora percibida  | Median of Q12 (0–4) per wave. "No la escuché" is counted as incomplete (`nIncomplete`), never as 0; a survey without Q12 is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Exploratory (no target)               |

### Change between phases and the zero-baseline rule

- Relative change = 100 × (post − baseline) / baseline. A reduction is negative, as the targets
  read ("−30 %"); the proposal's "relative reduction" is its opposite.
- **Baseline = 0**: the relative change is undefined, so the absolute change (post − baseline) is
  reported and the target is not evaluated (state "Sin datos").
- I4 compares proportions in percentage points (post − pre).

### States

| State                        | Meaning                                                |
| ---------------------------- | ------------------------------------------------------ |
| Cumple (`met`)               | The value or the change reaches the target.            |
| No cumple (`not_met`)        | It does not.                                           |
| Sin datos (`no_data`)        | No valid records, a missing phase, or a zero baseline. |
| Exploratoria (`exploratory`) | I9 has no target.                                      |

## Methodological decisions for the pilot

The proposal leaves four points open. These defaults were decided for the pilot (2026-10-11):

1. **Dispersion event (I3)**: an Instrument 2 record counts as one event when `dispersion` is
   `few` or `many`. The exit phase is `post`. Broken bags (> 0) and waste left after the pass are
   reported as secondary rates, never used for the target. Two Instrument 2 flags were added
   (migration `0014-indicator-inputs`): `exposure_incomplete` (placement seen before the
   observation began, so the exposure is a minimum time) and `comparable_window` ("mismo punto y
   ventana"). Incomplete exposures are reported apart (`nIncomplete`) and excluded from the I2
   median.
2. **Availability (I7)**: the operating intervals are consecutive 60 s intervals over each trip's
   [started_at, ended_at] (running trips up to now) within the period; an interval is available
   when the latest valid position with a fix time at or before the interval's end is at most 60 s
   old. The implementation also requires that position to have been **received** by the interval's
   end, so a fix that arrived late does not make a past interval available.
3. **Adoption (I5)**: per America/Lima ISO week; numerator = active households with ≥ 1 app view
   linked to the household or ≥ 1 alert delivery with status `sent` to one of its subscriptions;
   views without a household are excluded; denominator = households active and enrolled on or
   before the week's end. The stricter rate with a confirmed `received_at` is reported too. The
   "active user" of I6 is a household meeting the adoption rule in at least one week of the period.
4. **Phases**: Fase 3 and the other phases are not stored; every indicator request takes the
   period (`from`, `to`) and the route as parameters, and the field instruments use their stored
   phase (see [The period and the phases](#the-period-and-the-phases)).

Two further choices made while implementing:

- The non-comparable window (`comparable_window = false`) excludes a sheet from the window
  comparisons (I3, I8), as §11.5 compares "ventanas equivalentes"; it does not affect I2.
- I5 pools the weeks (household-weeks with use / enrolled household-weeks) rather than averaging
  weekly percentages, so weeks with more enrolled households weigh more. The weekly figures are in
  the response (`adoptionWeeks`) and in `uso.csv`.

## Paired tests (§11.5)

The pairing unit is the point (Instrument 2) or the household (Instrument 3); repeated sheets of a
point are first reduced to the point's median per phase, so they are not treated as independent.

| Indicator | Test                                                  | Pairs                                                                            |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| I2, I8    | Wilcoxon signed-rank on post − baseline point medians | points with a median in both phases                                              |
| I4        | McNemar, exact binomial                               | households with Q2 in both waves (`yesToNo`, `noToYes` are the discordant pairs) |
| I9        | Wilcoxon signed-rank on post − pre Q12                | households with a Q12 score in both waves                                        |

The Wilcoxon test drops zero differences and gives tied magnitudes their average rank. Without ties
and with at most 25 pairs the p-value is exact; otherwise it is the normal approximation with the
tie and continuity corrections. McNemar's p-value is the exact two-sided binomial one. Both were
checked against scipy 1.17.

To reproduce them outside the panel, take the pairs from the exports and run, for example in Python:

```python
from scipy import stats
stats.wilcoxon(post_minus_baseline)            # exact when possible, as the panel
stats.wilcoxon(d, method="approx", correction=True)  # the panel's choice with ties
stats.binomtest(min(b, c), b + c, 0.5).pvalue  # McNemar exact (b, c: discordant pairs)
```

In R: `wilcox.test(post, baseline, paired = TRUE)` and `mcnemar.test` (or
`binom.test(min(b, c), b + c)` for the exact version).

## Data sources

| Indicator  | Tables and views                                                    |
| ---------- | ------------------------------------------------------------------- |
| I1         | `instrument1_route_log` (alerts, passes), `trips`                   |
| I2, I3, I8 | `field_observations`, `reference_points`                            |
| I4, I6, I9 | `household_surveys`, `households`                                   |
| I5, I6     | `households`, `app_views`, `alert_deliveries`, `push_subscriptions` |
| I7         | `trips`, `positions`                                                |

The nine indicators are read in one read-only `REPEATABLE READ` snapshot, so they describe the same
moment. The cost per household served (§11.5) needs the executed budget, which the system does not
hold: divide it by `details.activeHouseholds` of I6.

## Checked example

The integration test `apps/api/test/integration/panel-indicators.integration.test.ts` seeds a small
pilot (`apps/api/test/support/indicator-fixtures.ts`) and asserts hand-computed values, for
example: I1 = 4 min (errors 2, 7, 4; 12 missing point-trips), I2 = 80 → 35 min (−56.25 %, one
incomplete exposure apart), I3 with a zero baseline (absolute change +0.33, "Sin datos"), I5 =
3 / 7 household-weeks = 42.86 %, I7 = 31 / 60 intervals = 51.67 %.
