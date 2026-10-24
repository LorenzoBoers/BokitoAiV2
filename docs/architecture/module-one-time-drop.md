# Modules as a one-time drop

**Status:** shipped  
**Date:** 2026-10-18  
**Supersedes:** ModuleInstall as active lifecycle owner; re-entrant install/hire/bind/seed reconcile

Shipped in alembic `116_module_one_time_drop`. Install materialises once onto
`Department.origin_module_slug`; prefs live in `settings_json.modules`;
`module_installs` is dropped.

---

## Decision

A module is a **catalog package** that the operator installs **once**. Install materialises tenant objects (department, specialist, tags, flows, sources, skill). After that drop, those objects are ordinary workspace data: operators edit them freely. The module does **not** keep owning, reconciling, or overwriting them.

“Is this module installed?” is answered from the **department**, not from a module lifecycle row.

---

## Rules (definitive)

### 1. Install = one-time drop

On install, create (if missing):

- department (with origin — see §2)
- specialist agent + roster / membership as today at first drop
- packaged tags, flows, sources, skill doc

After the drop, everything is freely editable. No later catalog push overwrites operator changes.

### 2. Origin on the department

Add on `departments`:

| Column | Meaning |
|--------|---------|
| `origin_module_slug` | Nullable, indexed. Catalog slug that created this island. `NULL` = hand-made department. |

**Uniqueness:** at most one live department per `(tenant_id, origin_module_slug)` where the slug is not null (and `deleted_at` is null).

**Installed?**

```text
exists Department
  where tenant_id = …
    and origin_module_slug = <slug>
    and deleted_at is null
```

Affiliation, Grid, marketplace “installed” badges, and tool enablement that today read `ModuleInstall.install_state` switch to this check (tool access follows the module department: agents in it or below it, plus module `ResourceGrant`s).

### 3. Remove ModuleInstall

Delete the `module_installs` table and all lifecycle around it:

- no `install_state` machine (`setup` / `installed` / `not_installed`)
- no ongoing reconcile, template sync, specialist restore-via-rehire, or re-stamp of `department_id` on existing rows
- prefs that lived on the row (`writes_enabled`, defaults, user access, customer tools) move to other homes in the same change (connection prefs, department `settings_json`, or workspace settings keyed by slug) — not left as a thin ModuleInstall shadow

### 4. Uninstall = delete the department

There is **no** separate module-uninstall lifecycle.

- De-install = remove (soft-delete / bin) the department that carries `origin_module_slug`
- When that origin is gone, the marketplace shows the module as not installed again
- Specialist archive / roster clear follow from tearing down that department’s members and related ACL — not from a second ModuleInstall path

### 5. Partner connections stay on module slug

Integration bindings remain keyed by **module slug** (not by department id), so a **new** install of the same slug can discover existing attachments.

Connections are **not** created by install. Operators still attach (or reconnect) manually; auto-attach on OAuth may still run as a one-shot connect helper, not as module lifecycle.

### 6. Re-entrant paths become create-once

These paths today re-patch or overwrite on later calls. Target behaviour: **only on first install** (create-if-missing); thereafter no-op or refuse without mutating tenant edits.

| Path | Today (remove as reconcile) |
|------|-----------------------------|
| `install_module` | Can demote `installed` → `setup` and re-run hire/bind/seeds |
| `hire_module_agent` → `ensure_managed_agent` | Patches prompt/tools on active specialist |
| `bind_module_department` | Overwrites skill, restamps homes, `_copy_flows` + `sync_flow_stages` |
| `ensure_platform_seeds` on GET sources / list tools | Mutates seed meta and queues on every list |
| `complete_module_setup` | Second pipeline that re-hires / re-seeds |

Weekly `reindex_module_sources_job` **stays** as knowledge ops (crawl existing source rows). It is not module lifecycle.

### 7. Unify uninstall behaviour

Today `uninstall_module` does not archive the department while `set_module_enabled(False)` does. That split disappears: de-install is department removal only (§4). Legacy enable/disable module flags collapse into install-once / department-gone.

---

## Target shape

```text
Catalog ModuleSpec (static)
        │
        │  one-time install
        ▼
Department.origin_module_slug = "accounting"
        ├── specialist (member)
        ├── tags / flows / sources / skill (home on this department)
        └── freely editable thereafter

IntegrationBinding config.module_slug = "accounting"
        └── survives department delete; re-used on next install
```

`ModuleInstall` is gone.

---

## Out of scope for this decision (but related)

- **Module tool access** — follows the origin department and the departments below it, plus module `ResourceGrant`s to an agent or a non-root department. The `module_agents` roster and `can_write` are gone (alembic 160).
- **Verb runtime / dispatch / write gates** — stay; relocate any gate that currently reads `ModuleInstall.writes_enabled`.
- **Trading / other `ensure_managed_agent` stacks** — separate from module drop; do not silently reintroduce module patch-on-hire.

---

## Implementation notes (when building)

Suggested order (do not start until explicitly asked):

1. Add `departments.origin_module_slug` + unique index; backfill from `ModuleInstall.department_id` + `module_slug`.
2. Switch readers (org graph, affiliations, enabled checks, marketplace) to origin exists.
3. Make install/hire/bind/seeds create-once; stop GET-path seed ensure.
4. Point de-install at department delete; remove dual enable/uninstall paths.
5. Move prefs off ModuleInstall; drop table + alembic.
6. Update product-help EN/NL + `BOKITO_KNOWLEDGE.md` to match shipped behaviour.

---

## References

- Current materialization: `apps/api/app/modules/catalog.py` (`install_module`, `hire_module_agent`, `complete_module_setup`, `uninstall_module`)
- Department bind: `apps/api/app/services/module_department.py` (`bind_module_department`, `ensure_module_department`)
- Pack agent reconcile: `apps/api/app/services/managed_resources.py` (`ensure_managed_agent`)
- Seeds: `apps/api/app/services/module_sources.py` (`ensure_platform_seeds`, reindex job)
- Attach: `apps/api/app/services/module_attach.py`
- Operator copy today: `docs/product-help/en/integrations/integrations.md` (update when this ships)
