from fastapi import APIRouter

from app.api.v1.endpoints import form_actions, health, master_forms

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(form_actions.router)
api_router.include_router(master_forms.router)
