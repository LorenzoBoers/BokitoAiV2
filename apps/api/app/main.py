import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings, production_config_warnings, validate_production_settings
from app.db.session import init_db
from sqlalchemy.exc import OperationalError

from app.exceptions import (
    AppError,
    app_error_handler,
    http_exception_handler,
    operational_error_handler,
)
from app.middleware.tenant import TenantHostMiddleware
from app.routers import (
    auth,
    calendars,
    channels,
    cockpit,
    app_workspaces,
    email,
    github_integrations,
    govern,
    health,
    help_center,
    product_help,
    inbound,
    kb,
    livechat,
    integrations,
    mcp,
    oauth_as,
    partner_mcp,
    me,
    models,
    staff_integration_catalog,
    staff_ops,
    notifications,
    privacy,
    projects,
    public_api,
    push,
    inbox_settings,
    ai_handling,
    communication_nav,
    signal_tags,
    signals,
    teams,
    workbench,
    learning,
    triggers,
    webhooks,
    workforce,
    workspace,
    workstreams,
    customer_verify,
    categories,
    canvases,
    orchestration,
    uploads,
    trash,
)
from app.gateway.bus import event_bus
from app.gateway.router import router as gateway_router
from app.observability import init_observability
from app.services.trigger_scheduler import trigger_scheduler_enabled, trigger_scheduler_loop

settings = get_settings()
init_observability("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config_errors = validate_production_settings(settings)
    if config_errors:
        raise RuntimeError(
            "Refusing to start in production with unsafe configuration:\n  - "
            + "\n  - ".join(config_errors)
        )
    for warning in production_config_warnings(settings):
        logging.getLogger("app.config").warning("PRODUCTION CONFIG: %s", warning)
    await init_db()
    await event_bus.start()
    scheduler_task: asyncio.Task | None = None
    if trigger_scheduler_enabled():
        scheduler_task = asyncio.create_task(trigger_scheduler_loop())
    try:
        yield
    finally:
        if scheduler_task:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
        try:
            from app.workers.tasks import close_arq_pool

            await close_arq_pool()
        except Exception:
            pass
        await event_bus.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(OperationalError, operational_error_handler)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantHostMiddleware)


class LivechatCorsMiddleware:
    """Open CORS for the embeddable widget API only.

    The chat widget is embedded on arbitrary customer domains, so
    `/api/livechat/*` must be callable cross-origin. It authenticates with
    Bearer session tokens (never cookies), so a wildcard origin without
    credentials is safe. All other API routes keep the strict allowlist above.
    """

    def __init__(self, app):  # noqa: ANN001 - ASGI app
        self.app = app
        self.prefix = f"{settings.api_prefix}/livechat"

    async def __call__(self, scope, receive, send):  # noqa: ANN001 - ASGI signature
        if scope["type"] != "http" or not scope["path"].startswith(self.prefix):
            await self.app(scope, receive, send)
            return

        cors_headers = [
            (b"access-control-allow-origin", b"*"),
            (b"access-control-allow-methods", b"GET, POST, PATCH, OPTIONS"),
            (b"access-control-allow-headers", b"Authorization, Content-Type, X-Idempotency-Key"),
            (b"access-control-max-age", b"600"),
        ]

        if scope["method"] == "OPTIONS":
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": cors_headers,
                }
            )
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message):  # noqa: ANN001
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not k.lower().startswith(b"access-control-")
                ]
                headers.extend(cors_headers)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)


app.add_middleware(LivechatCorsMiddleware)


class McpOAuthCorsMiddleware:
    """Open CORS for remote MCP clients and the OAuth AS.

    Cursor Agents, Claude.ai, and browser MCP hosts call these endpoints
    cross-origin with Bearer tokens (never cookies), so wildcard Origin is
    safe. Dashboard cookie auth stays on the strict allowlist above.
    """

    def __init__(self, app):  # noqa: ANN001
        self.app = app
        prefix = settings.api_prefix
        self.prefixes = (
            f"{prefix}/mcp",
            f"{prefix}/oauth",
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration",
        )

    def _match(self, path: str) -> bool:
        return any(path == p or path.startswith(p + "/") or path.startswith(p) for p in self.prefixes)

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope["type"] != "http" or not self._match(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        cors_headers = [
            (b"access-control-allow-origin", b"*"),
            (b"access-control-allow-methods", b"GET, POST, OPTIONS"),
            (
                b"access-control-allow-headers",
                b"Authorization, Content-Type, Accept, Mcp-Session-Id",
            ),
            (b"access-control-expose-headers", b"Mcp-Session-Id, WWW-Authenticate"),
            (b"access-control-max-age", b"600"),
        ]

        if scope["method"] == "OPTIONS":
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": cors_headers,
                }
            )
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message):  # noqa: ANN001
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not k.lower().startswith(b"access-control-")
                ]
                headers.extend(cors_headers)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)


app.add_middleware(McpOAuthCorsMiddleware)

api_prefix = settings.api_prefix
app.include_router(gateway_router, prefix=api_prefix)
app.include_router(health.router, prefix=api_prefix)
app.include_router(auth.router, prefix=api_prefix)
app.include_router(me.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(integrations.router, prefix=api_prefix)
app.include_router(calendars.router, prefix=api_prefix)
app.include_router(privacy.router, prefix=api_prefix)
app.include_router(trash.router, prefix=api_prefix)
app.include_router(github_integrations.router, prefix=api_prefix)
app.include_router(email.router, prefix=api_prefix)
app.include_router(inbound.router, prefix=api_prefix)
app.include_router(kb.router, prefix=api_prefix)
app.include_router(help_center.router, prefix=api_prefix)
app.include_router(product_help.router, prefix=api_prefix)
app.include_router(channels.router, prefix=api_prefix)
app.include_router(push.router, prefix=api_prefix)
app.include_router(cockpit.router, prefix=api_prefix)
app.include_router(inbox_settings.router, prefix=api_prefix)
app.include_router(ai_handling.router, prefix=api_prefix)
app.include_router(triggers.router, prefix=api_prefix)
app.include_router(livechat.router, prefix=api_prefix)
app.include_router(workspace.router, prefix=api_prefix)
app.include_router(projects.router, prefix=api_prefix)
app.include_router(canvases.router, prefix=api_prefix)
app.include_router(workforce.router, prefix=api_prefix)
app.include_router(govern.router, prefix=api_prefix)
app.include_router(mcp.router, prefix=api_prefix)
app.include_router(oauth_as.router, prefix=api_prefix)
app.include_router(oauth_as.mcp_well_known, prefix=api_prefix)
app.include_router(oauth_as.well_known)
app.include_router(partner_mcp.router, prefix=api_prefix)
app.include_router(signal_tags.router, prefix=api_prefix)
app.include_router(communication_nav.router, prefix=api_prefix)
app.include_router(signals.router, prefix=api_prefix)
app.include_router(teams.router, prefix=api_prefix)
app.include_router(workbench.router, prefix=api_prefix)
app.include_router(uploads.router, prefix=api_prefix)
app.include_router(learning.router, prefix=api_prefix)
app.include_router(models.router, prefix=api_prefix)
app.include_router(models.staff_router, prefix=api_prefix)
app.include_router(staff_integration_catalog.router, prefix=api_prefix)
app.include_router(staff_ops.router, prefix=api_prefix)
app.include_router(webhooks.router, prefix=api_prefix)
app.include_router(public_api.router, prefix=api_prefix)
app.include_router(orchestration.router, prefix=api_prefix)
app.include_router(workstreams.router, prefix=api_prefix)
app.include_router(customer_verify.router, prefix=api_prefix)
app.include_router(categories.router, prefix=api_prefix)
app.include_router(categories.ticket_router, prefix=api_prefix)
app.include_router(categories.board_router, prefix=api_prefix)
# Custom DB builder retired from core — Contact + Project + typed signal fields
# replace it. The router module and its tables still exist so nothing migrates
# out from under an existing tenant, but nothing is mounted: /api/app/custom-*
# returns 404.
app.include_router(app_workspaces.router, prefix=f"{api_prefix}/app")


# llms.txt convention: served from the app root (outside /api) so external AI
# agents can discover the docs at a well-known path.
@app.get("/llms.txt", include_in_schema=False)
async def llms_txt():
    from fastapi.responses import PlainTextResponse

    from app.services.product_help import build_llms_txt

    return PlainTextResponse(build_llms_txt(), media_type="text/plain; charset=utf-8")


@app.get("/llms-full.txt", include_in_schema=False)
async def llms_full_txt():
    from fastapi.responses import PlainTextResponse

    from app.services.product_help import build_llms_full_txt

    return PlainTextResponse(build_llms_full_txt(), media_type="text/plain; charset=utf-8")
