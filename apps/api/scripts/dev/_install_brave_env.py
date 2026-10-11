"""Install BRAVE_SEARCH_API_KEY into one or more .env files (value from sidecar)."""
from __future__ import annotations

import sys
from pathlib import Path


def install(env_path: Path, value: str) -> None:
    lines = env_path.read_text(encoding="utf-8", errors="replace").splitlines()
    kept = [
        ln
        for ln in lines
        if not ln.lstrip().startswith("BRAVE_SEARCH_API_KEY")
        and not ln.lstrip().startswith("nBRAVE_SEARCH_API_KEY")
    ]
    while kept and kept[-1] == "":
        kept.pop()
    kept.append(f"BRAVE_SEARCH_API_KEY={value}")
    env_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    print(f"updated {env_path} len={len(value)}")


def main() -> None:
    sidecar = Path("/opt/bokito/.env.brave")
    raw = sidecar.read_text(encoding="utf-8").strip()
    value = raw.split("=", 1)[1].strip() if raw.startswith("BRAVE_SEARCH_API_KEY=") else raw
    if len(value) < 16:
        raise SystemExit(f"brave key too short: {len(value)}")
    targets = [Path(p) for p in sys.argv[1:]] or [
        Path("/opt/bokito/.env.prod"),
        Path("/opt/bokito/.env.staging"),
        Path("/opt/bokito-dev/apps/api/.env"),
    ]
    for path in targets:
        if not path.exists():
            print(f"missing {path}")
            continue
        install(path, value)


if __name__ == "__main__":
    main()
