from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..auth.dependencies import require_auth
from ..config import settings
from ..fs import resolve_safe
from . import cache as preview_cache
from .registry import get_handler


router = APIRouter(prefix="/api/preview", tags=["preview"], dependencies=[Depends(require_auth)])


@router.get("")
def preview(
    path: str = Query(...),
    size: str = Query("thumbnail", pattern="^(thumbnail|full)$"),
) -> Response:
    target = resolve_safe(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    handler = get_handler(target.suffix)
    if handler is None:
        raise HTTPException(status_code=415, detail="No preview available for this file type")

    max_size = settings.thumbnail_size if size == "thumbnail" else settings.full_size

    try:
        data = preview_cache.read_or_generate(
            target,
            max_size,
            handler.output_mime,
            lambda: handler.render(target, max_size),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview failed: {exc}")

    return Response(
        content=data,
        media_type=handler.output_mime,
        headers={"Cache-Control": "private, max-age=86400"},
    )
