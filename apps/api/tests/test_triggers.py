"""Unit tests for trigger scheduling (cron parsing, next-run computation)."""

from datetime import datetime

from app.models.trigger import Trigger
from app.services.triggers import compute_next_run, next_cron_run


def test_next_cron_run_every_minute():
    after = datetime(2026, 6, 10, 12, 0, 30)
    nxt = next_cron_run("* * * * *", after)
    assert nxt == datetime(2026, 6, 10, 12, 1)


def test_next_cron_run_daily_at_eight():
    after = datetime(2026, 6, 10, 9, 0)
    nxt = next_cron_run("0 8 * * *", after)
    assert nxt == datetime(2026, 6, 11, 8, 0)


def test_next_cron_run_weekday_only():
    # 2026-06-12 is a Friday; next weekday match for Monday (1) is 06-15.
    after = datetime(2026, 6, 12, 10, 0)
    nxt = next_cron_run("0 9 * * 1", after)
    assert nxt == datetime(2026, 6, 15, 9, 0)


def test_next_cron_run_invalid_expressions():
    after = datetime(2026, 6, 10, 12, 0)
    assert next_cron_run("not a cron", after) is None
    assert next_cron_run("0 8 * *", after) is None


def test_compute_next_run_interval_and_disabled():
    now = datetime(2026, 6, 10, 12, 0)
    trigger = Trigger(tenant_id=None, name="t", kind="interval", interval_minutes=30)
    assert compute_next_run(trigger, now) == datetime(2026, 6, 10, 12, 30)

    trigger.enabled = False
    assert compute_next_run(trigger, now) is None


def test_compute_next_run_webhook_never_scheduled():
    trigger = Trigger(tenant_id=None, name="hook", kind="webhook")
    assert compute_next_run(trigger) is None
