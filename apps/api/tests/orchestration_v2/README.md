# orchestration_v2: stricter orchestration and voice tests

These are new files only. No existing test or source file was changed. Everything is mocked and local:

- in-memory SQLite and `BOKITO_MOCK_EXECUTION=true`, from `tests/conftest.py`
- fake STT/TTS (`FakeVoice`), fake storage and fake publish
- a fake LLM router (`route_fake`)
- a fake work backend (`FakeBackend`: ok / slow / fail / timeout)
- `create_realtime_secret` runs against a fake HTTP client

Any real LLM provider request fails the test (`_no_paid_calls`).

| File | Rule |
|---|---|
| `test_v2_r1_decoupled_work.py` | 1. Background work with a task id, a fast ack, no silence, the result reported later |
| `test_v2_r2_turn_taking.py` | 2. Turn-taking: push-to-talk, open-mic VAD, endpointing, barge-in versus backchannels |
| `test_v2_r3_confirmation.py` | 3. Irreversible actions only after an explicit 'ja, doe maar' (not 'misschien'/'eh') |
| `test_v2_r4_honest_done.py` | 4. Report "done" only when the backend confirms; report failures and timeouts honestly |
| `_v2_support.py` | Budgets, `Timeline`, `FakeVoice`, `FakeBackend`, Dutch claim and failure regexes |
| `conftest.py` | Autouse no-paid-calls guard and the `route_fake` and `seeded` fixtures |

The pass criteria are listed at the top of each file (R1.1 … R4.5).

## Knobs

These are environment variables:

- `ORCH_V2_REPEATS`: number of repeats per scenario (default 5, minimum 5).
- `ORCH_V2_ACK_BUDGET_MS`: latency budget from the end of the utterance until the ack is published (default 1200).
- `ORCH_V2_FAILURE_BUDGET_MS`: time allowed between a backend failure and the user being told (default 1000).

Latency is measured on a warm worker: `_warm_imports` pre-imports the lazily imported modules once per session. Cold-start timings are reported separately in the first run log.

## Hooks (formerly xfail)

These tests were first written as `xfail` against the interface each rule needed. The orchestration fix of 2026-10-24 added those hooks, so they now run as normal tests:

- R1.9/R1.10 `intercom.speak_progress` plus the sweep filler (`agent_turns._speak_progress_due`).
- R2.3/R2.4 `app.services.turn_taking.is_complete_utterance` / `classify_barge_in`. These turn back into xfail automatically if that module is missing.
- R2.5 the dock ignores backchannels while work runs.
- R3.4 the voice dock resolves open decision cards with the same explicit-yes rule.

Backups of the files changed by that fix are in `_backup_20261024_113939/`. Its `conftest.py` keeps pytest from collecting them.

## Run (Windows, from apps/api)

```powershell
cd C:\Users\Test\Documents\Coding\BokitoAiV2\apps\api
.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q -rA tests/orchestration_v2
# One rule:
.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q tests/orchestration_v2/test_v2_r3_confirmation.py
# Background with a log:
$ts=Get-Date -Format yyyyMMdd_HHmmss; Start-Process .venv\Scripts\python.exe -ArgumentList '-m','pytest','-p','no:cacheprovider','-q','-rA','tests/orchestration_v2' -RedirectStandardOutput "tests\orchestration_v2\logs\v2_$ts.log" -RedirectStandardError "tests\orchestration_v2\logs\v2_$ts.log.err" -WindowStyle Hidden
```

Baseline of the existing related tests (same mocked setup):

```powershell
.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q -rA tests/test_intercom.py tests/test_orchestration.py tests/test_agent_calls.py tests/test_voice_models.py tests/test_agent_turn.py tests/test_agent_turns.py tests/test_turn_surface.py tests/test_talk_lines.py tests/test_decision_gate.py tests/test_soft_yes_stacked.py tests/test_production_approval.py
```

Logs go to `tests/orchestration_v2/logs/`.
