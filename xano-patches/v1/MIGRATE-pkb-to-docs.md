# Migration: pkb_sections → project_docs / doc_pages / doc_blocks / doc_change_requests

A one-shot Xano background task that runs once per workspace after Slice 1 ships and before Slice 2 turns off legacy `pkb_sections` writes.

## Pre-flight

1. All 8 PRD scaffold pages (`overview`, `vision`, `features`, `brand`, `tech`, `marketing`, `operations`, `roadmap`) must already exist for every project (created by `workforce-projects-create.xs` going forward, or by the bootstrap step below for older projects).
2. `WORKER_BASE_URL` and `WORKER_INBOUND_SECRET` configured (only needed if reindexing during the task; otherwise the page batch endpoint will queue reindex on next user edit).

## Bootstrap missing scaffolds

For every project without a `project_docs` row, create one and seed the 8 default pages with the same starter blocks emitted by `workforce-projects-create.xs`. Pseudocode:

```
for project in projects where not exists project_docs(project_id = project.id):
  doc = create project_docs(project_id, tenant_id, title=project.name)
  for slug in [overview, vision, features, brand, tech, marketing, operations, roadmap]:
    create doc_page(doc_id=doc.id, slug, kind, title, icon)
    create doc_blocks(heading_1, callout, paragraph)
```

## Map pkb_sections → blocks

Domain → page slug:

| pkb_sections.layer  | pkb_sections.domain | target page slug      |
|---------------------|---------------------|-----------------------|
| current_state       | code                | tech-stack            |
| current_state       | marketing           | marketing             |
| current_state       | research            | overview              |
| current_state       | design              | brand-and-voice       |
| current_state       | operations          | operations            |
| current_state       | other / null        | overview              |
| intended_state      | code                | features-and-scope    |
| intended_state      | marketing           | marketing             |
| intended_state      | research            | vision-and-audience   |
| intended_state      | design              | brand-and-voice       |
| intended_state      | operations          | operations            |
| intended_state      | other / null        | vision-and-audience   |
| change_queue        | *                   | (handled below)       |

For each non-`change_queue` row:

```
page = doc_pages.where(project_id=row.project_id, slug=mapped_slug)
position = (max(doc_blocks.position where page_id=page.id)) + 1

if row.title:
  add doc_block(type="heading_2", text=[{text: row.title}], position++)

add doc_block(type="paragraph", text=[{text: row.content}], position++)
add doc_block_revision(op="create", actor_type="user", actor_label="PKB migration", change_note=f"Imported from pkb_sections {row.id}")
```

`pkb_sections` `domain_meta` is preserved by writing it onto the block's `props.imported_meta` so nothing is lost.

## Map change_queue → doc_change_requests

```
for row in pkb_sections where layer="change_queue":
  add doc_change_requests(
    project_id, tenant_id,
    title=row.title,
    body=row.content,
    status=row.change_status (default: pending),
    priority=row.priority,
    submitted_by_type=row.submitted_by_type,
    submitted_by_id=row.submitted_by_id,
    target_page_id=null,
    created_at=row.created_at,
    updated_at=row.updated_at
  )
```

## Cut-over

1. Run the bootstrap.
2. Run the migration task (idempotent: skip rows whose `id` is already referenced in `imported_meta.pkb_section_id`).
3. Deploy Slice 2 (frontend uses new endpoints exclusively).
4. Disable `workforce-pkb-create.xs` writes by returning a 410 with body `Use /projects/{id}/doc/change-requests`. Keep `workforce-pkb-list.xs` readable for one release for fallback.
5. Slice 3 deletes the deprecated XS files.

## Verification

- Every legacy `pkb_sections.layer = current_state | intended_state` row has at least one corresponding `doc_blocks` row with `imported_meta.pkb_section_id = <legacy_id>`.
- Every legacy `pkb_sections.layer = change_queue` row has a matching `doc_change_requests` row with the same body and status.
- Old `pkb_sections` rows remain queryable for one release, then dropped together with the deprecated XS files.
