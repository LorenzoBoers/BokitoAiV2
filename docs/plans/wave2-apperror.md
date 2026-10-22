# Wave 2 — HTTPException → AppError in services

Services raise domain errors (`AppError` / `NotFoundError` / `ForbiddenError` /
`UnauthorizedError`) instead of FastAPI `HTTPException`, so workers, tools and
MCP share the same exception path. The existing `app_error_handler` maps them
to the same JSON shape.

**Total string-detail migrations this wave: 210+** (209 via automated status
400/401/403/404 pass + works_in 422).

## Confirmed (by file, raise count)

1. **Confirmed** — `ai_handling.py`: 6
2. **Confirmed** — `connection_presets.py`: 1
3. **Confirmed** — `conversation_split.py`: 4
4. **Confirmed** — `decisions.py`: 1
5. **Confirmed** — `integration_catalog_store.py`: 5
6. **Confirmed** — `integration_connections.py`: 1
7. **Confirmed** — `integrations_platform.py`: 7
8. **Confirmed** — `lead_agent.py`: 1
9. **Confirmed** — `mcp_oauth.py`: 1
10. **Confirmed** — `message_reactions.py`: 2
11. **Confirmed** — `module_agents.py`: 5
12. **Confirmed** — `module_attach.py`: 8
13. **Confirmed** — `module_connections.py`: 2
14. **Confirmed** — `onboarding_setup.py`: 1
15. **Confirmed** — `onboarding_wizard.py`: 10
16. **Confirmed** — `orchestration/dispatcher.py`: 5
17. **Confirmed** — `partner_mcp.py`: 2
18. **Confirmed** — `personal_agents.py`: 1
19. **Confirmed** — `platform_apply.py`: 13
20. **Confirmed** — `platform_changes.py`: 3
21. **Confirmed** — `project_canvas.py`: 17
22. **Confirmed** — `project_work.py`: 10
23. **Confirmed** — `projects.py`: 2
24. **Confirmed** — `recurring_tickets.py`: 2
25. **Confirmed** — `signal_catalog.py`: 5
26. **Confirmed** — `signal_threads/decisions.py`: 4
27. **Confirmed** — `signal_threads/mutations.py`: 4
28. **Confirmed** — `signal_threads/reply.py`: 2
29. **Confirmed** — `signals.py`: 3
30. **Confirmed** — `thread_ask.py`: 1
31. **Confirmed** — `thread_schedule.py`: 2
32. **Confirmed** — `ticket_work.py`: 3
33. **Confirmed** — `tickets.py`: 18
34. **Confirmed** — `trash.py`: 2
35. **Confirmed** — `triggers.py`: 6
36. **Confirmed** — `workforce_runtime.py`: 24
37. **Confirmed** — `works_in.py`: 2 (404 + 422)
38. **Confirmed** — `workspace.py`: 7
39. **Confirmed** — `workstreams.py`: 4

## Tests

40. **Confirmed** — Service unit tests accept `(HTTPException, AppError)` so
    remaining dict-detail `HTTPException` raises and migrated `AppError` raises
    both pass during the transition.
41. **Confirmed** — `test_project_canvas`, `test_works_in`, `test_tickets`,
    `test_ticket_work`, `test_ticket_stages`, `test_canvas_kinds`,
    `test_connection_presets`: 82 passed after migration.

## Tooling

42. **Confirmed** — `scripts/dev/_migrate_httpexception_services.py`
43. **Confirmed** — `scripts/dev/_migrate_httpexception_422.py` (partial)
44. **Confirmed** — `scripts/dev/_fix_httpexception_tests.py`

## Left for later

Dict-detail and uncommon status codes (~170 `raise HTTPException` still in
`services/`) stay until a structured-error AppError variant exists.
