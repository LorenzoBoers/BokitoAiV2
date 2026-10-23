from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError


class AppError(Exception):
    def __init__(
        self,
        message: str,
        code: str = "app_error",
        status_code: int = 400,
        *,
        details: dict[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        detail: Any = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = dict(details or {})
        self.headers = dict(headers) if headers else None
        # ``detail`` matches the old HTTPException payload so callers that
        # read ``exc.detail`` (tools, tests) keep working.
        if detail is None:
            detail = (
                {"message": message, "code": code, **self.details}
                if self.details
                else message
            )
        self.detail = detail
        super().__init__(message)


def status_error(
    status_code: int,
    detail: Any = None,
    headers: Mapping[str, str] | None = None,
) -> AppError:
    """Domain error with the same body as ``HTTPException``.

    Services raise this instead of FastAPI's exception. The API handler
    renders the same JSON. ``detail`` stays on the instance for tools that
    used to catch ``HTTPException``.
    """
    if detail is None:
        try:
            detail = HTTPStatus(status_code).phrase
        except ValueError:
            detail = ""
    if isinstance(detail, dict):
        raw_message = detail.get("message", detail)
        message = raw_message if isinstance(raw_message, str) else str(raw_message)
        raw_code = detail.get("code", "http_error")
        code = raw_code if isinstance(raw_code, str) and raw_code else "http_error"
        extras = {key: value for key, value in detail.items() if key not in ("message", "code")}
        return AppError(
            message,
            code=code,
            status_code=status_code,
            details=extras,
            headers=headers,
            detail=detail,
        )
    message = str(detail)
    return AppError(
        message,
        code="http_error",
        status_code=status_code,
        headers=headers,
        detail=detail,
    )


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, code="not_found", status_code=404)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Forbidden"):
        super().__init__(message, code="forbidden", status_code=403)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Unauthorized"):
        super().__init__(message, code="unauthorized", status_code=401)


class TenantMismatchError(AppError):
    def __init__(self, message: str = "Tenant mismatch"):
        super().__init__(message, code="tenant_mismatch", status_code=403)


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, **exc.details}},
        headers=dict(exc.headers) if exc.headers else None,
    )


async def operational_error_handler(_request: Request, exc: OperationalError) -> JSONResponse:
    import logging

    logging.getLogger("app").exception("OperationalError mapped to schema_out_of_date: %s", exc)
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": "schema_out_of_date",
                "message": (
                    "Database schema is out of date. "
                    "Run: cd apps/api && alembic upgrade head && python scripts/seed.py "
                    "(or delete dev.db and restart the API)."
                ),
            }
        },
    )


async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    extras: dict = {}
    if isinstance(detail, dict):
        message = detail.get("message", str(detail))
        code = detail.get("code", "http_error")
        # Structured errors keep their payload (for example a suggested
        # alternative address) so the UI can act on it, not just print it.
        extras = {k: v for k, v in detail.items() if k not in ("message", "code")}
    else:
        message = str(detail)
        code = "http_error"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message, **extras}},
        headers=dict(exc.headers) if exc.headers else None,
    )
