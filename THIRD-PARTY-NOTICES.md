# Third-party notices

## grok-build

Parts of the Bokito API adopt schemas, contracts, limits and default values
from **grok-build** by SpaceXAI.

- Upstream: https://github.com/xai-org/grok-build
- Upstream commit: `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`
  (`SOURCE_REV` `559751fdcec02d413e4c57c8832ab275e4f44980`)
- Copyright 2023-2026 SpaceXAI
- License: Apache License, Version 2.0 — full text in
  [`docs/third_party/grok-build/LICENSE`](docs/third_party/grok-build/LICENSE)

No grok-build source files are redistributed. Bokito re-implements the
adopted behavior in Python. Every Python module that derives from grok-build
says so in its module docstring, and
[`docs/third_party/grok-build/CHANGES.md`](docs/third_party/grok-build/CHANGES.md)
lists what was adopted and how Bokito changed it.

Derived modules:

- `apps/api/app/tools/permission_rules.py`
- `apps/api/app/tools/policy.py`
- `apps/api/app/services/agent_definition.py`
- `apps/api/app/services/compaction.py`
- `apps/api/app/services/subagents.py`
- `apps/api/app/services/agent/stop_gate.py`
