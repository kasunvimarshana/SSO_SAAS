import logging
from typing import Optional

import httpx
from fastapi import HTTPException, Request, status

from app.config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def validate_token(token: str) -> dict:
    """Call the Auth Service to validate a JWT and return the decoded payload."""
    url = f"{settings.AUTH_SERVICE_URL}/api/auth/validate"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url, headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.RequestError as exc:
        logger.error("Auth service unreachable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is unavailable.",
        )

    if response.status_code == status.HTTP_200_OK:
        return response.json()

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _extract_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[len("Bearer "):]
    return None
