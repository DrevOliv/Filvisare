import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from .auth.dependencies import require_auth
from .fs import resolve_safe


VIDEO_EXTENSIONS: frozenset[str] = frozenset({
    "mp4", "webm", "m4v", "mov", "ogv", "ogg",
})

# Explicit content types so every browser gets a type it will actually play,
# rather than relying on the host's mimetypes database.
_CONTENT_TYPES: dict[str, str] = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
    "ogv": "video/ogg",
    "ogg": "video/ogg",
}

# Read size while streaming a range back to the browser.
_STREAM_CHUNK = 1024 * 1024

_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def is_video(extension: str) -> bool:
    return extension.lower().lstrip(".") in VIDEO_EXTENSIONS


router = APIRouter(prefix="/api/video", tags=["video"], dependencies=[Depends(require_auth)])


def _stream_range(path, start: int, end: int):
    """Yield bytes [start, end] of `path` in modest chunks."""
    with path.open("rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(_STREAM_CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.get("")
def video(path: str, request: Request):
    target = resolve_safe(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    ext = target.suffix.lower().lstrip(".")
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Not a supported video")

    media_type = _CONTENT_TYPES.get(ext, "application/octet-stream")
    file_size = target.stat().st_size
    range_header = request.headers.get("range")

    # No Range header: return the whole file, but advertise range support so
    # the browser knows it can seek and buffer ahead on follow-up requests.
    if not range_header:
        return FileResponse(
            target,
            media_type=media_type,
            headers={"Accept-Ranges": "bytes"},
        )

    match = _RANGE_RE.fullmatch(range_header.strip())
    if not match:
        raise HTTPException(
            status_code=416,
            detail="Malformed Range header",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    start_text, end_text = match.group(1), match.group(2)
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    else:
        # Suffix range "bytes=-N": the final N bytes of the file.
        suffix = int(end_text or 0)
        start = max(file_size - suffix, 0)
        end = file_size - 1

    end = min(end, file_size - 1)
    if start > end or start >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Requested range not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
    }
    return StreamingResponse(
        _stream_range(target, start, end),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )
