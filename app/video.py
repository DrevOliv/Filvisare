from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .auth.dependencies import require_auth
from .fs import resolve_safe


VIDEO_EXTENSIONS: frozenset[str] = frozenset({
    "mp4", "webm", "m4v", "mov", "ogv", "ogg",
})


def is_video(extension: str) -> bool:
    return extension.lower().lstrip(".") in VIDEO_EXTENSIONS


router = APIRouter(prefix="/api/video", tags=["video"], dependencies=[Depends(require_auth)])


@router.get("")
def video(path: str) -> FileResponse:
    target = resolve_safe(path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if not is_video(target.suffix):
        raise HTTPException(status_code=415, detail="Not a supported video")
    return FileResponse(target)
