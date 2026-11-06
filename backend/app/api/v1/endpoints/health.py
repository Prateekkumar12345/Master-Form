from fastapi import APIRouter

from app.services.master_forms import envelope

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return envelope({"status": "ok"}, message="Service is healthy.")
