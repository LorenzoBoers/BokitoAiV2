# Bokito product help

Operator and developer articles that explain how to use Bokito. This folder is
the single source of truth for four surfaces:

- Public `/docs` site (no login, SEO-indexed, behind the website)
- In-app `/learn` (authenticated)
- Assistant RAG (`source_type=product_help`) and the `search_product_help` tool
- AI consumers via `/llms.txt`, `/llms-full.txt` and `GET /api/docs/{slug}.md`

Write task-oriented copy for operators and integrators, not engineer handbooks.
Keep `docs/company/` and `BOKITO_KNOWLEDGE.md` internal.

A significant platform change that operators or integrators see or do must
update these articles in the same change. Lookup: [`surface-map.yaml`](surface-map.yaml).
Agent rule: [`.cursor/rules/product-help-docs.mdc`](../../.cursor/rules/product-help-docs.mdc).

## Layout

```
{en,nl}/{section}/{slug}.md
assets/{slug}/{usecase}.png
surface-map.yaml
```

Sections (fixed set, in nav order):

| Section | Contents |
| --- | --- |
| `getting-started` | welcome, quickstart, setup-guide, tour, cockpit, members |
| `inbox` | communication, agent-runs, channels, contacts, inbox-ai, widget, help-centers |
| `ai` | agents, decisions, knowledge, projects, agenda |
| `govern` | govern, autonomy, models |
| `integrations` | integrations, mcp |
| `developers` | api-overview, authentication, api-signals, webhooks, mcp-endpoint, widget-embed, rate-limits |

Slugs are globally unique across sections (the filename is the slug; the folder
is the section). URLs: `/docs/{section}/{slug}` public, `/learn/{slug}` in-app.

## Frontmatter

```
---
title: How Cockpit works
intro: One-line summary shown under the title.
description: SEO meta description, 150-160 characters, required.
keywords: comma, separated, search, terms
sort: 10
related: communication,agents
---
```

- `sort` orders articles inside their section (10, 20, 30, ...).
- `related` is a comma-separated list of other slugs (flat, any section).
- `description` is required; it feeds SEO meta tags and search.

## Article shape (operator)

Keep it short. Do not write essays.

1. Two sentences: what the surface is and when you open it.
2. Three to six use-cases as `##` headings. One use-case is one real task
   (review an AI draft and send it), not a feature list.
3. Per use-case: one sentence, a screenshot, three to five steps that name
   the real UI labels (translated per language).
4. Close with **What to do next** / **Wat nu** and `/docs/{section}/{slug}` links.

The steps must still make sense if the image fails to load. Present tense.
No emoji. No internal table names. No "see the codebase".

Developer articles (auth, webhooks, rate-limits, OpenAPI) stay text and code.
Screenshots only when a UI is the task (`widget-embed`).

## Screenshots

- File: `docs/product-help/assets/{slug}/{usecase}.png`
- Markdown: `![alt in the article language](/api/docs/assets/{slug}/{usecase}.png)`
- Caption: the next line, italic (`*The Open queue…*`)
- One shared PNG set for EN and NL. Translate alt and caption only.
- Light theme, about 1440px wide, crop to the panel. No OS taskbar.
- No customer thread in git. Crop or blur names, addresses, and message bodies.
  Prefer an internal assistant thread or an empty state.
- Recapture when the UI of that use-case changed (layout, labels, new primary
  action). A copy-only fix leaves the screenshot in place.
- Register the usecase name under `screenshots:` in `surface-map.yaml`.

## When to add an article vs extend one

- New rail page, settings group, or operator task that fits nowhere → new slug
  in both languages plus a `surface-map.yaml` row.
- Extra control on an existing page → add a use-case (and screenshot) there.
- Renamed UI → update labels, screenshot, and `related`. Do not create a
  second article for the same screen.

## After a significant change

1. Look up changed files and routes in `surface-map.yaml`.
2. Open the matching `en/` and `nl/` articles.
3. Update text, add or drop a use-case, recapture a screenshot, or add an article.
4. Run:

```bash
python apps/api/scripts/dev/sync_product_help.py
```

The sync copies `en/`, `nl/`, and `assets/` to `apps/api/app/data/product_help/`.
Never edit the packaged copy by hand. `apps/api/tests/test_product_help.py`
fails on drift, missing frontmatter, en/nl parity, map gaps, or missing images.

## Cross-links

Use public paths: `/docs/{section}/{slug}`. The in-app renderer rewrites them
for `/learn`.
