from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import __version__
from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import connect_mongodb
from app.services.master_forms import envelope


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    client = connect_mongodb()
    try:
        await client.admin.command("ping")
        collection = client[settings.mongodb_database][settings.mongodb_collection]
        await collection.create_index(
            [("organizationId", 1), ("formCode", 1)],
            unique=True,
            name="uq_organization_formCode",
        )
        await collection.create_index(
            [("organizationId", 1), ("status", 1), ("isDeleted", 1)],
            name="ix_organization_status_isDeleted",
        )
        await collection.create_index(
            [("organizationId", 1), ("formType", 1)],
            name="ix_organization_formType",
        )
        yield
    finally:
        await client.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.project_name,
        version=__version__,
        debug=settings.debug,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {
            "code": "HTTP_ERROR",
            "message": str(exc.detail),
        }
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, "error": detail, "meta": None},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The request contains invalid values.",
                    "details": jsonable_encoder(exc.errors()),
                },
                "meta": None,
            },
        )

    @app.get("/", tags=["root"])
    async def root() -> dict:
        return envelope(
            {"docs": "/docs", "openapi": "/openapi.json"},
            message=f"{settings.project_name} is running.",
        )

    return app


app = create_app()
