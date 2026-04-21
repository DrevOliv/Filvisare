from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ..auth.dependencies import require_auth
from ..fs import resolve_safe


router = APIRouter(prefix="/api/video", tags=["video"], dependencies=[Depends(require_auth)])


VIDEO_MIME: dict[str, str] = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "mov": "video/quicktime",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "avi": "video/x-msvideo",
}

CHUNK_SIZE = 1024 * 1024  # 1 MiB


def _iter_range(path: Path, start: int, end: int):
    with path.open("rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            data = f.read(min(CHUNK_SIZE, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def _parse_range(header: str, file_size: int) -> tuple[int, int] | None:
    try:
        units, _, rng = header.partition("=")
        if units.strip().lower() != "bytes":
            return None
        start_str, _, end_str = rng.partition("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
    except ValueError:
        return None
    if start < 0 or end >= file_size or start > end:
        return None
    return start, end


@router.get("")
def stream(request: Request, path: str = Query(...)) -> Response:
    target = resolve_safe(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    extension = target.suffix.lstrip(".").lower()
    mime = VIDEO_MIME.get(extension)
    if mime is None:
        raise HTTPException(status_code=415, detail="Unsupported video type")

    file_size = target.stat().st_size
    range_header = request.headers.get("range") or request.headers.get("Range")

    if not range_header:
        return StreamingResponse(
            _iter_range(target, 0, file_size - 1),
            media_type=mime,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )

    parsed = _parse_range(range_header, file_size)
    if parsed is None:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start, end = parsed
    length = end - start + 1
    return StreamingResponse(
        _iter_range(target, start, end),
        status_code=206,
        media_type=mime,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
        },
    )
