# Improvements confirmed (working tree vs origin/master)

Concrete improvements already present in the working tree versus `origin/master`
(HEAD on master). Sourced from `git status --short`, file listings, and spot-checks
of new/changed modules. Every item below is **Confirmed**. Not a commit list.

**Total: 318**

---

## CI

1. **Confirmed** — `.github/workflows/ci.yml`: API job Python version `3.11` → `3.12`
2. **Confirmed** — `.github/workflows/ci.yml`: e2e job Python version `3.11` → `3.12`
3. **Confirmed** — `.github/workflows/ci.yml`: dashboard job adds `npx tsc --noEmit -p apps/dashboard`
4. **Confirmed** — `.github/workflows/ci.yml`: dashboard job adds `npm test -w bokito-dashboard` before build

## Security

5. **Confirmed** — `apps/api/app/config.py`: `expose_dev_auth_tokens` setting (default `False`)
6. **Confirmed** — `apps/api/app/routers/auth.py`: reset/verify token exposure gated on `EXPOSE_DEV_AUTH_TOKENS` (not merely “not production”)
7. **Confirmed** — `apps/api/.env.example`: documents `EXPOSE_DEV_AUTH_TOKENS` with local-only warning
8. **Confirmed** — `apps/api/tests/conftest.py`: enables `EXPOSE_DEV_AUTH_TOKENS` for the test suite
9. **Confirmed** — `apps/api/scripts/run_e2e_api.py`: enables `EXPOSE_DEV_AUTH_TOKENS` for e2e
10. **Confirmed** — New `apps/api/tests/test_auth_hardening.py`: covers auth-token exposure hardening
11. **Confirmed** — `apps/api/app/config.py`: `trusted_proxy_hops` (default `1` for Caddy)
12. **Confirmed** — `apps/api/app/middleware/rate_limit.py`: client IP from trusted right-hand X-Forwarded-For hop (not leftmost spoofable entry)
13. **Confirmed** — `apps/api/tests/test_auth_hardening.py`: covers forwarded-for hop selection
14. **Confirmed** — `apps/api/pyproject.toml`: replace unmaintained `python-jose` with `pyjwt[crypto]>=2.9.0`
15. **Confirmed** — `apps/api/pyproject.toml`: replace unmaintained `passlib[bcrypt]` with direct `bcrypt>=4.0.0` (drop `<5` pin)
16. **Confirmed** — `apps/api/app/services/auth.py`: JWT encode/decode via PyJWT (`import jwt`)
17. **Confirmed** — `apps/api/app/services/auth.py`: password hash/verify via `bcrypt.hashpw` / `bcrypt.checkpw`
18. **Confirmed** — `apps/api/app/services/auth.py`: explicit 72-byte bcrypt secret truncation (compat with bcrypt≥5)
19. **Confirmed** — `apps/api/app/dependencies.py`: updated for PyJWT stack
20. **Confirmed** — `apps/api/app/routers/uploads.py`: updated for PyJWT stack
21. **Confirmed** — `apps/api/app/services/livechat_compat.py`: updated for PyJWT stack
22. **Confirmed** — `apps/api/tests/test_auth_libs.py`: existing hashes/tokens stay valid under PyJWT+bcrypt
23. **Confirmed** — `apps/api/tests/test_gateway.py`: `from jose import jwt` → `import jwt`
24. **Confirmed** — `apps/api/uv.lock`: lockfile updated for PyJWT/bcrypt dependency swap

## Integrity fixes (tests)

25. **Confirmed** — `apps/api/tests/test_gateway.py`: monkeypatch path fixed to `app.services.signal_threads.mutations.publish_thread_update` after package split
26. **Confirmed** — `apps/api/tests/test_agent_calls.py`: autouse fixture monkeypatches `app.services.reach.in_quiet_hours` → `False` (quiet-hours flake fix, default 22:00–07:00)
27. **Confirmed** — New `apps/api/app/services/reach.py` provides `in_quiet_hours` used by agent-call path (patch target for the flake fix)

## Silent exception logging (~20+ sites)

28. **Confirmed** — `services/agent/loop.py`: bare chat-prepare rollback logs with context
29. **Confirmed** — `workers/tasks.py`: handoff interrupt on inbound logs warning
30. **Confirmed** — `gateway/bus.py`: redis `aclose` failure logged
31. **Confirmed** — `gateway/bus.py`: redis reader cleanup failure logged
32. **Confirmed** — `gateway/router.py`: unauthorized WS error send logged
33. **Confirmed** — `gateway/router.py`: disconnect presence update logged
34. **Confirmed** — `main.py`: arq pool close failure logged
35. **Confirmed** — `signal_threads/reply.py`: cancel coalesced agent-reply task logged
36. **Confirmed** — `routers/signal_chat.py`: rollback after stream failure logged
37. **Confirmed** — `services/oauth_flow.py`: Moneybird admin lookup failure logged
38. **Confirmed** — `services/subagents.py`: rollback after subagent failure logged
39. **Confirmed** — `services/internal_signals.py`: live push failure logged
40. **Confirmed** — `services/message_reactions.py`: publish reaction failure logged
41. **Confirmed** — `routers/channels.py`: demo-thread cleanup after connect logged
42. **Confirmed** — `routers/channels.py`: demo-thread cleanup after create logged
43. **Confirmed** — `services/integrations_platform.py`: demo-thread cleanup after mailbox connect logged
44. **Confirmed** — `modules/catalog.py`: auto tag install failure logged
45. **Confirmed** — `modules/catalog.py`: add module agent failure logged
46. **Confirmed** — `services/workspace.py`: approved examples prompt section failure logged
47. **Confirmed** — `services/workspace.py`: recent corrections prompt section failure logged
48. **Confirmed** — `services/workspace.py`: module skills prompt section failure logged
49. **Confirmed** — `services/workspace.py`: tenant snapshot prompt section failure logged
50. **Confirmed** — `services/livechat_compat.py`: bearer token resolve failure logged
51. **Confirmed** — `services/module_connections.py`: Moneybird admin lookup on verify logged
52. **Confirmed** — `services/smtp_imap.py`: imap/smtp cleanup paths log instead of silent pass (multiple sites)

## utcnow helper + call-site migrations

53. **Confirmed** — New `apps/api/app/core/time.py`: `utcnow()` naive-UTC helper (`datetime.now(timezone.utc).replace(tzinfo=None)`)
54. **Confirmed** — New `apps/api/app/core/__init__.py`: core package marker
55. **Confirmed** — Migrated `utcnow()` in `gateway/bus.py` (1 call)
56. **Confirmed** — Migrated `utcnow()` in `routers/auth.py` (10 calls)
57. **Confirmed** — Migrated `utcnow()` in `routers/signal_chat.py` (7 calls)
58. **Confirmed** — Migrated `utcnow()` in `services/agent/turn_persist.py` (8 calls)
59. **Confirmed** — Migrated `utcnow()` in `services/agent_calls.py` (12 calls)
60. **Confirmed** — Migrated `utcnow()` in `services/agent_sessions.py` (6 calls)
61. **Confirmed** — Migrated `utcnow()` in `services/agent_turns.py` (12 calls)
62. **Confirmed** — Migrated `utcnow()` in `services/ai_handling.py` (7 calls)
63. **Confirmed** — Migrated `utcnow()` in `services/auth.py` (5 calls)
64. **Confirmed** — Migrated `utcnow()` in `services/calendar_sync.py` (12 calls)
65. **Confirmed** — Migrated `utcnow()` in `services/cockpit.py` (9 calls)
66. **Confirmed** — Migrated `utcnow()` in `services/email_sync.py` (7 calls)
67. **Confirmed** — Migrated `utcnow()` in `services/flow_proposals.py` (4 calls)
68. **Confirmed** — Migrated `utcnow()` in `services/folders.py` (2 calls)
69. **Confirmed** — Migrated `utcnow()` in `services/handover.py` (5 calls)
70. **Confirmed** — Migrated `utcnow()` in `services/inbound_agent.py` (8 calls)
71. **Confirmed** — Migrated `utcnow()` in `services/inbox_rules.py` (11 calls)
72. **Confirmed** — Migrated `utcnow()` in `services/integration_catalog_store.py` (4 calls)
73. **Confirmed** — Migrated `utcnow()` in `services/internal_signals.py` (1 call)
74. **Confirmed** — Migrated `utcnow()` in `services/learning.py` (9 calls)
75. **Confirmed** — Migrated `utcnow()` in `services/mcp_oauth_as.py` (16 calls)
76. **Confirmed** — Migrated `utcnow()` in `services/message_reactions.py` (1 call)
77. **Confirmed** — Migrated `utcnow()` in `services/module_sources.py` (7 calls)
78. **Confirmed** — Migrated `utcnow()` in `services/notifications.py` (3 calls)
79. **Confirmed** — Migrated `utcnow()` in `services/notify.py` (5 calls)
80. **Confirmed** — Migrated `utcnow()` in `services/orchestration/dispatcher.py` (6 calls)
81. **Confirmed** — Migrated `utcnow()` in `services/orchestration/runner.py` (9 calls)
82. **Confirmed** — Migrated `utcnow()` in `services/platform_apply.py` (4 calls)
83. **Confirmed** — Migrated `utcnow()` in `services/platform_changes.py` (7 calls)
84. **Confirmed** — Migrated `utcnow()` in `services/presence.py` (7 calls)
85. **Confirmed** — Migrated `utcnow()` in `services/privacy.py` (4 calls)
86. **Confirmed** — Migrated `utcnow()` in `services/project_canvas.py` (6 calls)
87. **Confirmed** — Migrated `utcnow()` in `services/project_work.py` (5 calls)
88. **Confirmed** — Migrated `utcnow()` in `services/recurring_tickets.py` (4 calls)
89. **Confirmed** — Migrated `utcnow()` in `services/repo_index.py` (4 calls)
90. **Confirmed** — Migrated `utcnow()` in `services/signal_decisions.py` (9 calls)
91. **Confirmed** — Migrated `utcnow()` in `services/signal_tags.py` (11 calls)
92. **Confirmed** — Migrated `utcnow()` in `services/signal_threads/decisions.py` (3 calls)
93. **Confirmed** — Migrated `utcnow()` in `services/signal_threads/mutations.py` (3 calls)
94. **Confirmed** — Migrated `utcnow()` in `services/signal_threads/pins.py` (1 call)
95. **Confirmed** — Migrated `utcnow()` in `services/signal_threads/queries.py` (3 calls)
96. **Confirmed** — Migrated `utcnow()` in `services/signal_threads/reply.py` (3 calls)
97. **Confirmed** — Migrated `utcnow()` in `services/signals.py` (4 calls)
98. **Confirmed** — Migrated `utcnow()` in `services/subagents.py` (5 calls)
99. **Confirmed** — Migrated `utcnow()` in `services/thread_schedule.py` (18 calls)
100. **Confirmed** — Migrated `utcnow()` in `services/tickets.py` (12 calls)
101. **Confirmed** — Migrated `utcnow()` in `services/triggers.py` (7 calls)
102. **Confirmed** — Migrated `utcnow()` in `services/workbench/gateway.py` (16 calls)
103. **Confirmed** — Migrated `utcnow()` in `services/workforce_runtime.py` (16 calls)
104. **Confirmed** — Migrated `utcnow()` in `services/workspace.py` (7 calls)
105. **Confirmed** — Migrated `utcnow()` in `services/workspaces_portal.py` (5 calls)
106. **Confirmed** — Migrated `utcnow()` in `workers/tasks.py` (6 calls)
107. **Confirmed** — Aggregate: **52 files** import `from app.core.time import utcnow`; **~357 `utcnow()` call sites** in `app/` (migration wave vs prior `datetime.utcnow`)

## Tools modularity + vocab cleanup

108. **Confirmed** — New `apps/api/app/tools/_common.py` shared helpers
109. **Confirmed** — New `apps/api/app/tools/messaging.py` (reply / notes / handoff / close / …)
110. **Confirmed** — New `apps/api/app/tools/decisions.py`
111. **Confirmed** — New `apps/api/app/tools/tags.py`
112. **Confirmed** — New `apps/api/app/tools/scheduling.py`
113. **Confirmed** — New `apps/api/app/tools/work.py`
114. **Confirmed** — New `apps/api/app/tools/platform.py`
115. **Confirmed** — New `apps/api/app/tools/subagents.py`
116. **Confirmed** — New `apps/api/app/tools/trash.py`
117. **Confirmed** — New `apps/api/app/tools/workspace_read.py`
118. **Confirmed** — `apps/api/app/tools/builtin.py` thinned to import/register submodules and re-export handlers
119. **Confirmed** — `tools/builtin.py` wires messaging handler set
120. **Confirmed** — `tools/builtin.py` wires decisions handler set
121. **Confirmed** — `tools/builtin.py` wires tags handler set
122. **Confirmed** — `tools/builtin.py` wires scheduling handler set
123. **Confirmed** — `tools/builtin.py` wires work handler set
124. **Confirmed** — `tools/builtin.py` wires platform handler set
125. **Confirmed** — `tools/builtin.py` wires subagents handler set
126. **Confirmed** — `tools/builtin.py` wires trash handler set
127. **Confirmed** — `tools/builtin.py` wires workspace_read handler set
128. **Confirmed** — Retired tools `add_graph_node` / `connect_graph_nodes` removed from registry (OS-graph era)
129. **Confirmed** — `apps/api/tests/test_agent_vocabulary.py` updated: tool descriptions use no forbidden synonyms
130. **Confirmed** — `apps/api/tests/test_agent_vocabulary.py`: builtin tool descriptions vocabulary check
131. **Confirmed** — Vocab cleanup: agent/tool copy aligned to Set C (Conversation / Label / Flow / Folder / Contact / Agent / Decision) across touched tool modules
132. **Confirmed** — `tools/executor.py` / `tools/registry.py` / `tools/policy.py` updated for split modules
133. **Confirmed** — `tools/decision_copy.py` / `tools/tickets.py` / `tools/project_work.py` updated for new stack
134. **Confirmed** — Existing `tools/calendar.py` / `tools/contacts.py` retained as split precedent

## signal_threads package split

135. **Confirmed** — Deleted monolith `apps/api/app/services/signal_threads.py`
136. **Confirmed** — New `apps/api/app/services/signal_threads/__init__.py` re-exports public API
137. **Confirmed** — New `apps/api/app/services/signal_threads/serialize.py`
138. **Confirmed** — New `apps/api/app/services/signal_threads/queries.py`
139. **Confirmed** — New `apps/api/app/services/signal_threads/mutations.py`
140. **Confirmed** — New `apps/api/app/services/signal_threads/reply.py`
141. **Confirmed** — New `apps/api/app/services/signal_threads/pins.py`
142. **Confirmed** — New `apps/api/app/services/signal_threads/decisions.py`
143. **Confirmed** — Call sites / imports updated across routers and services to the package layout

## LLM efficiency

144. **Confirmed** — New `apps/api/app/services/agent/llm_efficiency.py` (prompt caching + shared SDK clients)
145. **Confirmed** — `llm_efficiency.shared_client`: process-wide reused provider clients
146. **Confirmed** — `llm_efficiency.apply_prompt_caching` / `prompt_caching_enabled`
147. **Confirmed** — `apps/api/app/config.py`: `llm_prompt_caching` flag (default `True`)
148. **Confirmed** — `apps/api/app/services/agent/llm.py`: hooks into llm_efficiency helpers
149. **Confirmed** — Cache-aware input token billing (writes ×1.25, reads ×0.1)
150. **Confirmed** — New `apps/api/tests/test_llm_efficiency.py`
151. **Confirmed** — New `apps/api/app/services/agent/effort_policy.py` (`normalize_effort`, `turn_effort`, small-talk downshift)
152. **Confirmed** — `apps/api/app/config.py`: `chat_thinking_budget` replaced by `chat_default_effort`
153. **Confirmed** — New migration `146_agent_effort.py`: agent `effort` replaces thinking token budget
154. **Confirmed** — Deleted `apps/api/app/services/agent/reasoning_policy.py`
155. **Confirmed** — Deleted `apps/api/tests/test_reasoning_policy.py`
156. **Confirmed** — New `apps/api/tests/test_effort_policy.py`
157. **Confirmed** — New `apps/api/app/services/agent/leaked_tools.py`: lift pasted `<propose_action>` markup into real tool calls
158. **Confirmed** — New `apps/api/tests/test_leaked_tools.py`
159. **Confirmed** — `apps/api/app/config.py`: default realtime model `gpt-realtime` → `gpt-realtime-mini` (cost)
160. **Confirmed** — Agent loop / turn / stop_gate / style / turn_persist / turn_surface updated for effort + efficiency path

## Schema migrations 136–147

161. **Confirmed** — `136_ticket_work.py`: stage-entry policy, `due_at` / `due_source` / `due_basis`, `ticket_checklist_json`
162. **Confirmed** — `137_signal_outcome.py`: `signals.outcome_json`
163. **Confirmed** — `138_work_kind_flow_recipe.py`: work kind + flow recipe columns (`work_kinds_json`, instructions, capabilities, expected_outcome)
164. **Confirmed** — `139_label_is_work_kind.py`: drop signal/workstream work_kind columns; label is the work kind
165. **Confirmed** — `140_flow_autonomy.py`: `workstreams.autonomy` replaces Always review
166. **Confirmed** — `141_membership_scope_hours.py`: `memberships.scope` + `hours_per_week`
167. **Confirmed** — `142_recurring_ticket.py`: recurring ticket trigger purpose + fields
168. **Confirmed** — `143_canvas_kind.py`: canvas `kind` + code language
169. **Confirmed** — `144_thread_ux.py`: temporary thread UX event log table
170. **Confirmed** — `145_debug_dom.py`: per-tenant browser DOM debug log (48h retention)
171. **Confirmed** — `146_agent_effort.py`: agents.effort from thinking_budget
172. **Confirmed** — `147_canvas_thread_only.py`: canvas belongs only to conversation; drop folder owner columns
173. **Confirmed** — `apps/api/app/db/schema_patch.py` kept in sync with new columns
174. **Confirmed** — Models updated: `agent.py`, `auth.py`, `learning.py`, `orchestra.py`, `orchestration.py`, `project_canvas.py`, `signal.py`, `trigger.py`

## New backend services / modules

175. **Confirmed** — New `services/agent_awareness.py`
176. **Confirmed** — New `services/awareness.py`
177. **Confirmed** — New `services/canvas_content.py`
178. **Confirmed** — New `services/canvas_sheet.py`
179. **Confirmed** — New `services/client_approval.py`
180. **Confirmed** — New `services/connection_health.py`
181. **Confirmed** — New `services/connection_presets.py`
182. **Confirmed** — New `services/content_calendar.py`
183. **Confirmed** — New `services/counts.py`
184. **Confirmed** — New `services/debug_dom.py`
185. **Confirmed** — New `services/decision_actions.py`
186. **Confirmed** — New `services/department_domain.py`
187. **Confirmed** — New `services/department_overview.py`
188. **Confirmed** — New `services/event_wakes.py`
189. **Confirmed** — New `services/flow_proposals.py`
190. **Confirmed** — New `services/internal_signals.py`
191. **Confirmed** — New `services/mcp_remote_client.py`
192. **Confirmed** — New `services/reach.py`
193. **Confirmed** — New `services/recurring_tickets.py`
194. **Confirmed** — New `services/thread_ux.py`
195. **Confirmed** — New `services/ticket_work.py`
196. **Confirmed** — New `services/trends.py`
197. **Confirmed** — New `services/native_connectors/__init__.py`
198. **Confirmed** — New `services/native_connectors/_http.py`
199. **Confirmed** — New `services/native_connectors/mailblue.py`
200. **Confirmed** — New `services/native_connectors/metricool.py`
201. **Confirmed** — New `modules/documents/router.py`
202. **Confirmed** — New `modules/documents/adapters/__init__.py`
203. **Confirmed** — New `modules/documents/adapters/google_drive.py`
204. **Confirmed** — New `app/data/platform_icons.py`
205. **Confirmed** — New `app/data/__init__.py`
206. **Confirmed** — `app/data/mcp_remote_catalog.json` updated

## Deleted OS graph + dead surfaces

207. **Confirmed** — Deleted `apps/api/app/models/os_graph.py`
208. **Confirmed** — Deleted `apps/api/app/services/os_graph.py`
209. **Confirmed** — Workforce router cleaned of OS-graph endpoints/stubs
210. **Confirmed** — No remaining `os_graph` / `add_graph_node` / `connect_graph_nodes` product path in `app/`
211. **Confirmed** — Deleted `apps/api/tests/test_handled_externally.py` (obsolete)

## Frontend architecture

212. **Confirmed** — `apps/dashboard/src/lib/api.ts`: `createClient(base)` consolidates HTTP wrappers
213. **Confirmed** — `api.ts`: `appApi` via createClient
214. **Confirmed** — `api.ts`: `appScopedApi` via createClient
215. **Confirmed** — `api.ts`: `workforceApi` via createClient
216. **Confirmed** — `api.ts`: `foldersApi` via createClient
217. **Confirmed** — `api.ts`: `settingsApi` via createClient
218. **Confirmed** — `api.ts`: `staffApi` via createClient
219. **Confirmed** — `api.ts`: `authApi` via createClient
220. **Confirmed** — New `apps/dashboard/src/lib/preferences.ts` unified preferences store (cache, subscribe, patch, clear hooks)
221. **Confirmed** — Lazy i18n loading in `src/i18n/index.ts` via `import.meta.glob` backend
222. **Confirmed** — New `src/i18n/index.test.ts` for lazy locale loading
223. **Confirmed** — `main.tsx` waits for active language before first render
224. **Confirmed** — `DocsChrome.tsx` loads docs language on demand
225. **Confirmed** — Self-hosted `@fontsource/inter` (package.json dependency)
226. **Confirmed** — Self-hosted `@fontsource/jetbrains-mono` (package.json dependency)
227. **Confirmed** — `index.html` no longer pulls Google Fonts CDN
228. **Confirmed** — New chat-stack: `components/chat-stack/ChatStack.tsx`
229. **Confirmed** — New chat-stack: `components/chat-stack/ChatStackCard.tsx`
230. **Confirmed** — New chat-stack: `components/chat-stack/FloatingThreadWindow.tsx`
231. **Confirmed** — New `hooks/useChatStack.ts`
232. **Confirmed** — New `lib/chat-stack.ts`
233. **Confirmed** — New `lib/chat-stack-follow.ts` + `chat-stack-follow.test.ts`
234. **Confirmed** — New `lib/thread-ux.ts`
235. **Confirmed** — New `lib/debug-dom.ts`
236. **Confirmed** — New `lib/platform-icons.ts` + test
237. **Confirmed** — New `lib/mark-scale.ts` + test
238. **Confirmed** — New `lib/agent-call-live.ts`
239. **Confirmed** — New `lib/landing-preference.test.ts`
240. **Confirmed** — New `components/flows/FlowRecipe.tsx`
241. **Confirmed** — New `components/flows/FlowStageEntryControl.tsx`
242. **Confirmed** — New `components/flows/TicketWork.tsx`
243. **Confirmed** — New `components/departments/DepartmentFlowPipeline.tsx`
244. **Confirmed** — New `pages/DepartmentPage.tsx`
245. **Confirmed** — New canvas UI: `CanvasKindBody.tsx`
246. **Confirmed** — New canvas UI: `CanvasStage.tsx`
247. **Confirmed** — New canvas UI: `CanvasWindow.tsx`
248. **Confirmed** — New `components/shell/WorkforceLayout.tsx`
249. **Confirmed** — New `components/integrations/setup/IntegrationFieldsSetupPanel.tsx`
250. **Confirmed** — New `components/workforce/AgentDefinitionCard.test.tsx`
251. **Confirmed** — New `types/jsdom.d.ts`
252. **Confirmed** — Dashboard API routes updated (`app`, `categories`, `folders`, `integrations`, `workspace`, index)
253. **Confirmed** — Locales EN/NL updated (`common`, `communication`, `nav`, `profile`)
254. **Confirmed** — `vite.config.ts` / `tsconfig.json` / `package.json` / design-system scripts updated for the above

## Frontend dead-code deleted

255. **Confirmed** — Deleted `components/inbox/ChatMarkdown.tsx`
256. **Confirmed** — Deleted `components/inbox/HandledExternallyForm.tsx`
257. **Confirmed** — Deleted `components/inbox/InboxHeaderSearch.tsx`
258. **Confirmed** — Deleted `context/KeyboardNavigationContext.tsx`
259. **Confirmed** — Deleted `hooks/useKeyboardNavigation.ts`
260. **Confirmed** — Deleted `components/ui/file-upload.tsx`
261. **Confirmed** — Deleted `components/ui/progress.tsx`
262. **Confirmed** — Deleted `components/ui/TagIcon.tsx`
263. **Confirmed** — Deleted `components/mcp/McpServerSetupTab.tsx`
264. **Confirmed** — Deleted `components/projects/ProjectAgentsSection.tsx`
265. **Confirmed** — Deleted `components/projects/ProjectBudgetBar.tsx`
266. **Confirmed** — Deleted `components/projects/ProjectBudgetEditor.tsx`
267. **Confirmed** — Deleted `components/projects/ProjectFolderFlows.tsx`
268. **Confirmed** — Deleted `components/projects/ProjectOrchestratorSection.tsx`
269. **Confirmed** — Deleted `components/projects/ProjectRepoSection.tsx`
270. **Confirmed** — Deleted `components/agenda/CalendarConnectBar.tsx`
271. **Confirmed** — Deleted `components/folders/FolderTitleTags.tsx`
272. **Confirmed** — Deleted `components/shell/RouteTabs.tsx`
273. **Confirmed** — Deleted `lib/block-editor-caret.ts`
274. **Confirmed** — Deleted `lib/budget-copy.ts`
275. **Confirmed** — Deleted `lib/github-oauth.ts`
276. **Confirmed** — Deleted `lib/orchestration-tasks-api.ts`
277. **Confirmed** — Deleted `lib/project-hub-last-opened.ts`
278. **Confirmed** — Deleted `lib/run-status-label.ts`
279. **Confirmed** — Deleted `lib/slug.ts`
280. **Confirmed** — Deleted `lib/user-facing.ts`
281. **Confirmed** — Deleted `types/inbox.ts`
282. **Confirmed** — Deleted `types/mcp.ts`

## New / updated API tests

283. **Confirmed** — New `tests/test_agency_pilot.py`
284. **Confirmed** — New `tests/test_auth_hardening.py`
285. **Confirmed** — New `tests/test_auth_libs.py`
286. **Confirmed** — New `tests/test_awareness.py`
287. **Confirmed** — New `tests/test_canvas_in_chat.py`
288. **Confirmed** — New `tests/test_canvas_kinds.py`
289. **Confirmed** — New `tests/test_chat_stack.py`
290. **Confirmed** — New `tests/test_connection_presets.py`
291. **Confirmed** — New `tests/test_default_landing.py`
292. **Confirmed** — New `tests/test_department_access.py`
293. **Confirmed** — New `tests/test_department_awareness.py`
294. **Confirmed** — New `tests/test_effort_policy.py`
295. **Confirmed** — New `tests/test_flow_proposals.py`
296. **Confirmed** — New `tests/test_flow_recipe.py`
297. **Confirmed** — New `tests/test_folder_counts.py`
298. **Confirmed** — New `tests/test_leaked_tools.py`
299. **Confirmed** — New `tests/test_llm_efficiency.py`
300. **Confirmed** — New `tests/test_mcp_remote_client.py`
301. **Confirmed** — New `tests/test_platform_icons.py`
302. **Confirmed** — New `tests/test_production_approval.py`
303. **Confirmed** — New `tests/test_recurring_tickets.py`
304. **Confirmed** — New `tests/test_ticket_work.py`
305. **Confirmed** — New `tests/test_trends.py`
306. **Confirmed** — Existing suite files updated for new imports/paths (agent_calls, gateway, vocabulary, communication, tickets, workstreams, …)

## Product help + knowledge

307. **Confirmed** — Product-help EN articles updated: agenda, agents, categories, flows, folders, assistant, cockpit, features, quickstart, setup-guide, team, tour, autonomy, govern, communication, contacts, inbox-ai, integrations
308. **Confirmed** — Product-help NL articles updated: matching set (agenda through integrations)
309. **Confirmed** — `docs/product-help/glossary.yaml` + shipped `apps/api/app/data/product_help/glossary.json` updated
310. **Confirmed** — `docs/product-help/surface-map.yaml` updated
311. **Confirmed** — Deleted stale asset `flows/always-review.png` (docs + shipped product_help)
312. **Confirmed** — `BOKITO_KNOWLEDGE.md` updated with platform facts from this WIP
313. **Confirmed** — `docs/CORE_INTENT.md` / `docs/architecture.md` touched for alignment

## Repo hygiene + extras

314. **Confirmed** — `restructuring plan/` removed from repo root; archived under `docs/archive/restructuring-plan/`
315. **Confirmed** — New scripts: `generate_platform_icons.py`, `mcp_smoke.py`, `measure_turns.py`, `setup_agency_pilot.py`
316. **Confirmed** — Mobile: new `apps/mobile/app/call/[id].tsx` + mobile api/copy/push updates
317. **Confirmed** — Gateway package updates (`publish.py`, `bus.py`, `router.py`, `__init__.py`) for live thread path
318. **Confirmed** — Working-tree inventory scope: **~612** short-status paths vs `origin/master` (modified + untracked + deleted)

_End of list (318 items). Do not commit from this document alone._
