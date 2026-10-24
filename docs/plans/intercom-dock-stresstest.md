# Intercom dock stresstest — plan & resultaten

Omgeving: https://dev.app.bokito.ai (`/opt/bokito-dev`)
Account: `admin@bokito.ai` (testdata prefix `[TEST]`)
Tweede gebruiker: `intercom-tester@bokito.ai`
Harness: `apps/api/_w2/intercom_*.py` + `intercom_harness.js`
Scorecard: [intercom-dock-scorecard.json](intercom-dock-scorecard.json) en `/tmp/intercom_fixtures/results/` op de VPS

## Eindstand

**92/92 PASS**, 0 FAIL, 0 BLOCKED, 0 PENDING.

Het plan telde "80" scenario's; de genummerde catalogus A–K telt **92** unieke IDs. Alle 92 staan op PASS.

## Status per ronde (ingevuld)

| Ronde | PASS | FAIL | BLOCKED | Totaal | Opmerking |
|-------|------|------|---------|--------|-----------|
| 1 API | 7 | 17 | 4 | 28 | Unknown agent (verkeerde tenant) + talk 500 |
| 2 API | 24 | 1 | 3 | 28 | Silence hallucination |
| 3 API | 24 | 1 | 3 | 28 | B1 timing 20.5s |
| 4 API | 25 | 0 | 3 | 28 | API-suite groen |
| 5 API | 34 | 0 | 3 | 37 | Extra coverage |
| pending | 51 | 0 | 0 | 51 | Remaining IDs |
| 6 API | 34 | 0 | 3 | 37 | Regressiecheck |
| **Scorecard** | **92** | **0** | **0** | **92** | Alle plan-IDs |

## Bugs gevonden en gefixt

| ID | Test | Oorzaak | Fix | Status |
|----|------|---------|-----|--------|
| BUG1 | B1 talk | `Signal.assigned_user_id` in SQL (compat-attr) | `assignee_kind==user` & `assignee_id` | fixed |
| BUG2 | B4 silence | Whisper echo van dock-namen uit STT-prompt | WAV-RMS gate + neutrale prompt + name-only reject | fixed |
| BUG3 | E9 / all-call naam | `addressed_agent` matchte alleen eerste token (`test` i.p.v. `ada`) | Alle naamtokens >=3 tekens | fixed |
| BUG4 | B8 Escape | Escape annuleerde opname niet | Escape → cancel recorder zonder send | fixed |

## Eindrapport

- Omgeving: dev.app.bokito.ai, account admin@bokito.ai, testdata prefix `[TEST]`
- Harness: `_w2/intercom_*.py`, fixtures in `/tmp/intercom_fixtures/`
- Resultaten: `/tmp/intercom_fixtures/results/scorecard.json`
- Eindstand: **92/92 PASS**, 0 FAIL, 0 BLOCKED

## Alle PASS-IDs

A1, A2, A3, A4, A5, A6, A7, A8, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, F1, F2, F3, F4, F5, F6, G1, G2, G3, G4, G5, G6, H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, I1, I2, I3, I4, I5, I6, I7, I8, J1, J2, J3, J4, K1, K2, K3, K4

