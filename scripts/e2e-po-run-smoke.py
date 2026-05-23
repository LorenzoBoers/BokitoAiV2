#!/usr/bin/env python3
"""Smoke E2E: PO run -> work_log events -> task_result message."""
import json
import time
import urllib.error
import urllib.request

WORKER_SECRET = "97e28b2fa528dfd1b9863d9a464225618d21970d6821cd953965fd172f720991"
XANO = "https://xrex-nmji-j9ur.f2.xano.io/api:workforce"
WORKER_KEY = "SBP1e-dbWgRcgchFVME6pGKy2VCigp6yR4tkPGsj51I"
PROJECT = "7baa7578-2119-40a5-bbde-b1bb3e2ef27d"
TENANT = "067ebc22-6aac-4986-868b-857bc1c55f5f"
AGENT = "96312783-18b2-4484-a31b-60b815f69740"


def post(url, body, headers=None):
    data = json.dumps(body).encode()
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.status, json.loads(res.read().decode())


def main():
    status, started = post(
        "https://worker.bokito.ai/agent/po/run",
        {"project_id": PROJECT, "tenant_id": TENANT, "po_agent_id": AGENT},
        {"Authorization": f"Bearer {WORKER_SECRET}"},
    )
    print("po_run", status, started)
    wl = started["work_log_id"]

    final = None
    for i in range(36):
        time.sleep(10)
        try:
            _, ctx = post(
                f"{XANO}/runs/context",
                {
                    "worker_api_key": WORKER_KEY,
                    "project_id": PROJECT,
                    "agent_id": AGENT,
                    "work_log_id": wl,
                },
            )
            print(f"poll {i+1} context ok subject={ctx.get('subject')}")
        except Exception as e:
            print(f"poll {i+1} context err", e)

        # lightweight: post empty events merge to verify auth (optional)
        try:
            post(
                f"{XANO}/work_logs/{wl}/events",
                {"auth_token": wl, "events": []},
            )
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code != 400:
                print("events auth check", e.code, body[:200])

    print("work_log_id", wl)
    print("Check Xano work_logs/messages tables for final status and task_result")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
