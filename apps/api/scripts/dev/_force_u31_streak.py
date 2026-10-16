"""Force max consecutive turns on mail host for U31 live UI watch."""
from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

ORCH = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"
MAIL = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


async def main() -> None:
    # Prefer /tmp copy on VPS; fall back to repo path.
    for candidate in (
        Path("/tmp/_probe_u_suite_c_d.py"),
        Path(__file__).resolve().parent / "_probe_u_suite_c_d.py",
    ):
        if candidate.exists():
            spec = importlib.util.spec_from_file_location("probe_cd", candidate)
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            out = await mod.force_max_consecutive(MAIL, ORCH, BOKITO)
            print(out)
            return
    raise SystemExit("probe module missing")


asyncio.run(main())
