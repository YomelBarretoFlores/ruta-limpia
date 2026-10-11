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
   **Exportaciones** (see [Exports](#exports)).

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

## Instrument 3: survey codes and the CSV import

Surveys are typed in the panel (**Encuestas**) or imported from a CSV file (`POST
/api/panel/household-surveys/import`, `Content-Type: text/csv`; permission `surveys:write`:
administrators and supervisors). One row per household and wave, keyed by `household_code` and
`wave`: a new pair is created, an existing one is replaced. The import is all or nothing: every row
is checked first, and the answer lists each problem with its line and column; one problem anywhere
imports none. Each import is audited (`household_survey.imported`, with the row counts) and its rows
carry the batch id. The template is `GET /api/panel/household-surveys/template.csv`; the
`instrumento3.csv` export has the same columns, so it imports back.

| Column                                 | Question                                  | Codes                                                                |
| -------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `household_code`                       | Código del hogar (required)               | `H-001` …                                                            |
| `route_code`                           | — (informative, ignored on import)        | `RI-01`                                                              |
| `wave`                                 | Aplicación (required)                     | `pre`, `post`                                                        |
| `surveyed_on`                          | Date (required)                           | `YYYY-MM-DD`                                                         |
| `q1_knows_schedule`                    | Q1 knows the schedule                     | `yes`, `no` (also `si`, `sí`, `true`, `false`, `1`, `0`)             |
| `q2_lead_time`                         | Q2 how long before the pass               | `0_15`, `15_60`, `1_3h`, `gt_3h`, `after_pass`                       |
| `q3_missed_pickups`                    | Q3 missed the truck, last month           | `0`, `1_2`, `3_plus`                                                 |
| `q4_litter_seen`                       | Q4 broken bags or litter, last week       | `never`, `sometimes`, `often`                                        |
| `q5_separates`                         | Q5 separates waste                        | `yes`, `sometimes`, `no`                                             |
| `q6_alerts_helped` … `q10_keep_system` | Q6–Q10 agreement (post only)              | `1` … `5`                                                            |
| `q11_satisfaction`                     | Q11 overall satisfaction (post only)      | `1` … `5`                                                            |
| `q12_annoyance`                        | Q12 annoyance, last 7 days                | `0` … `4`                                                            |
| `q12_not_heard`                        | Q12 "No la escuché"                       | `yes`, `no` (empty = no)                                             |
| `q13_interrupted`                      | Q13 interrupted rest or activities        | `never`, `1_2`, `3_plus`, `not_heard`                                |
| `q14_channels`                         | Q14 channels (several, separated by `\|`) | `music`, `alert`, `web_map`, `printed_schedule`, `neighbor`, `other` |
| `q14_other`                            | Q14 "Otro" text                           | up to 200 characters                                                 |
| `q15_access`                           | Q15 access to the alerts                  | `yes`, `with_help`, `no`                                             |
| `q15_alt_channel`                      | Q15 alternative channel required          | up to 200 characters, only with `no`                                 |

Empty cells are unanswered questions. A survey is refused when a question 6–11 is answered in the
pre wave, when Q12 has a score and "No la escuché", when Q14 "Otro" lacks its text (or the text
lacks "Otro"), or when an alternative channel is given without Q15 = `no`. Deleting a household
(consent withdrawn) deletes its surveys.

## Exports

Panel → **Exportaciones**, or `GET /api/panel/exports/<file>` with the session cookie (permission
`exports:read`: administrators and supervisors). Every file is UTF-8 with a byte order mark (Excel
opens it as UTF-8), comma separated, CRLF line ends and RFC 4180 quoting. Dates are ISO
(`YYYY-MM-DD`), times of day America/Lima `HH:MM`, booleans `yes`/`no`, lists separated by `|`,
empty cells are unknown or not recorded. No file holds personal data: no addresses, no user
accounts or e-mails; observers appear as written on the sheet (initials). A text cell that starts
with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so a spreadsheet
never runs it as a formula.

| File               | Filters                                            | One row per                                             |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| `instrumento1.csv` | `route`, `from`, `to` (optional)                   | reference point of a trip (system) or of a baseline log |
| `instrumento2.csv` | `route`, `from`, `to` (optional, on `observed_on`) | Instrument 2 sheet                                      |
| `instrumento3.csv` | `route` (optional)                                 | household survey (the import format, see above)         |
| `indicadores.csv`  | `route`, `from`, `to` (required)                   | indicator × scope × phase                               |
| `uso.csv`          | `route`, `from`, `to` (required)                   | enrolled household × week                               |

### `instrumento1.csv`

| Column                                 | Meaning                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `source`                               | `system` (the trip log) or `baseline_manual` (a hand-written baseline log)             |
| `record_id`                            | The trip or baseline log id                                                            |
| `service_date`                         | Local service date                                                                     |
| `route_code`, `vehicle`                | Route; vehicle code (system) or label (baseline)                                       |
| `planned_start`, `actual_start`        | Planned and actual start, `HH:MM`                                                      |
| `point_sequence`, `point_code`         | The reference point                                                                    |
| `actual_passed_at`                     | When the truck passed the point, `HH:MM`                                               |
| `alert_emitted_at`, `communicated_eta` | When the alert was sent and the arrival it announced, `HH:MM` (empty without an alert) |
| `abs_error_minutes`                    | \|communicated ETA − pass\| in minutes, 2 decimals (empty without an alert or a pass)  |
| `point_incidents_count`                | Incidents of the trip at that point                                                    |
| `notes`                                | Baseline log notes                                                                     |

### `instrumento2.csv`

| Column                                                                             | Meaning                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `record_id`, `observed_on`, `route_code`, `point_code`, `phase`                    | The sheet, its date, point and phase (`baseline`, `intervention`, `post`)                        |
| `observers`                                                                        | As written on the sheet                                                                          |
| `trip_id`                                                                          | The trip observed, when linked                                                                   |
| `first_placement_time`, `truck_pass_time`                                          | `HH:MM`                                                                                          |
| `exposure_minutes`, `exposure_computed`                                            | Exposure; `yes` when computed from the two times                                                 |
| `exposure_incomplete`                                                              | `yes`: placement seen before the observation began (a minimum time)                              |
| `bags_at_pass`, `broken_bags`                                                      | Counts                                                                                           |
| `dispersion`                                                                       | `none`, `few`, `many`                                                                            |
| `dispersion_causes`, `dispersion_cause_other`                                      | `animals`, `wind`, `manipulation`, `undetermined`, `other` (separated by `\|`); the "other" text |
| `waste_remaining_after_pass`                                                       | `yes`/`no`                                                                                       |
| `photo_before_taken`, `photo_before_code`, `photo_after_taken`, `photo_after_code` | Photo taken and its archive code (never the image)                                               |
| `music_window_start`, `music_window_end`, `music_seconds`, `music_conditions`      | The music observation window, seconds of music heard in it, and conditions                       |
| `comparable_window`                                                                | "Mismo punto y ventana": `yes`, `no`, or empty when not answered                                 |
| `notes`                                                                            | Sheet notes                                                                                      |

### `indicadores.csv`

Long form, one row per indicator, scope and phase:

| Column                                         | Meaning                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route_code`, `period_from`, `period_to`       | The request                                                                                                                                                                           |
| `indicator`, `name`                            | `I1` … `I9` and the Tabla 16 name                                                                                                                                                     |
| `scope`                                        | `route`, or a point code for the per-point rows                                                                                                                                       |
| `phase`                                        | `all` (the headline row), `baseline`/`pre`/`post` (a compared phase), or the name of a secondary figure (`confirmedValue`, `weeks`, `activeHouseholds`, `brokenBagsShareBaseline`, …) |
| `value`, `unit`                                | The value (2 decimals; 4 for secondary figures) and its unit (`minutes`, `ratio`, `percent`, `seconds`, `score`)                                                                      |
| `n_valid`, `n_missing`, `n_incomplete`         | Record counts                                                                                                                                                                         |
| `target`                                       | `<= 5`, `>= 70`, `<= -30%` (relative change), `>= +30 pp`, or empty (exploratory); on `all` rows                                                                                      |
| `change_kind`, `change`                        | `relative` (%), `absolute` (zero baseline) or `points` (p.p.)                                                                                                                         |
| `paired_test`, `pairs`, `statistic`, `p_value` | `wilcoxon` or `mcnemar`, the pairs, the Wilcoxon statistic, the p-value (4 decimals)                                                                                                  |
| `status`                                       | `met`, `not_met`, `no_data`, `exploratory`; on `all` rows                                                                                                                             |

### `uso.csv`

| Column                                    | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `route_code`, `week_start`                | The route and the Monday of the week (clipped to the period)                       |
| `household_code`                          | An active household enrolled by the week's end                                     |
| `viewed`, `alert_sent`, `alert_confirmed` | A linked app view; an alert delivered (`sent`); a confirmed reception, in the week |
| `active`                                  | The I5 rule: `viewed` or `alert_sent`                                              |
| `active_confirmed`                        | The stricter rule: `viewed` or `alert_confirmed`                                   |

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
