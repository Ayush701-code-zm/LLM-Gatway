"""Route registration."""

from fastapi import APIRouter

from smartroute.routes.admin import router as admin_router
from smartroute.routes.analytics import router as analytics_router
from smartroute.routes.api_keys import router as api_keys_router
from smartroute.routes.auth import router as auth_router
from smartroute.routes.billing import router as billing_router
from smartroute.routes.chat import router as chat_router
from smartroute.routes.embeddings import router as embeddings_router
from smartroute.routes.member import router as member_router
from smartroute.routes.models import router as models_router
from smartroute.routes.notifications import router as notifications_router
from smartroute.routes.oauth import router as oauth_router
from smartroute.routes.scim import scim_router, workspace_router as scim_workspace_router
from smartroute.routes.sso import saml_router, workspace_router as sso_workspace_router
from smartroute.routes.system import router as system_router
from smartroute.routes.webhooks import router as webhooks_router
from smartroute.routes.workspace import router as workspace_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(saml_router)
api_router.include_router(oauth_router)
api_router.include_router(api_keys_router)
api_router.include_router(workspace_router)
api_router.include_router(member_router)
api_router.include_router(sso_workspace_router)
api_router.include_router(scim_workspace_router)
api_router.include_router(analytics_router)
api_router.include_router(webhooks_router)
api_router.include_router(notifications_router)
api_router.include_router(billing_router)
api_router.include_router(admin_router)
api_router.include_router(system_router)
api_router.include_router(chat_router)
api_router.include_router(embeddings_router)
api_router.include_router(models_router)
