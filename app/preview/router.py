import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth.dependencies import require_auth
from ..config import settings
from ..fs import resolve_safe
from . import cache as preview_cache
from .registry import get_handler


router = APIRouter(prefix="/api/preview", tags=["preview"], dependencies=[Depends(require_auth)])


class PathsBody(BaseModel):
    paths: list[str]


def _resolve_previewable(paths: list[str]) -> list[tuple[Path, object]]:
    """Resolve paths and keep only files with a registered preview handler."""
    out: list[tuple[Path, object]] = []
    for p in paths:
        try:
            target = resolve_safe(p)
        except HTTPException:
            continue
        if not target.exists() or not target.is_file():
            continue
        handler = get_handler(target.suffix)
        if handler is None:
            continue
        out.append((target, handler))
    return out


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


@router.post("/status")
def cache_status(body: PathsBody) -> dict:
    """Return how many of the supplied previewable files are fully cached.

    "Fully cached" means both the thumbnail and full-size previews exist on disk.
    """
    items = _resolve_previewable(body.paths)
    cached = 0
    for target, handler in items:
        thumb_ok = preview_cache.is_cached(target, settings.thumbnail_size, handler.output_mime)
        full_ok = preview_cache.is_cached(target, settings.full_size, handler.output_mime)
        if thumb_ok and full_ok:
            cached += 1
    return {"total": len(items), "cached": cached}


@router.post("/warm")
def warm(body: PathsBody) -> StreamingResponse:
    """Pre-render thumbnail + full previews for each path, streaming progress.

    Emits Server-Sent Events. Each event is a JSON object with `done`, `total`,
    and (on the final event) `finished: true`. `total` counts fully-cached
    files (matching /status), so the frontend can drop the response straight
    into its indicator.
    """
    items = _resolve_previewable(body.paths)
    total = len(items)

    def event_stream():
        pending: list[tuple[Path, object]] = []
        done = 0
        for target, handler in items:
            mime = handler.output_mime
            thumb_ok = preview_cache.is_cached(target, settings.thumbnail_size, mime)
            full_ok = preview_cache.is_cached(target, settings.full_size, mime)
            if thumb_ok and full_ok:
                done += 1
            else:
                pending.append((target, handler))

        yield f"data: {json.dumps({'done': done, 'total': total})}\n\n"

        for target, handler in pending:
            mime = handler.output_mime
            try:
                preview_cache.ensure_cached(
                    target, settings.thumbnail_size, mime,
                    lambda t=target, h=handler: h.render(t, settings.thumbnail_size),
                )
                preview_cache.ensure_cached(
                    target, settings.full_size, mime,
                    lambda t=target, h=handler: h.render(t, settings.full_size),
                )
                done += 1
            except Exception:
                pass
            yield f"data: {json.dumps({'done': done, 'total': total})}\n\n"

        yield f"data: {json.dumps({'done': done, 'total': total, 'finished': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
