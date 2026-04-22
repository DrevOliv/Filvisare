import os

from fastapi import APIRouter, Depends, HTTPException

from ..auth.dependencies import require_auth
from ..fs import is_hidden, resolve_safe, to_relative
from ..preview.registry import is_previewable
from ..video import is_video


router = APIRouter(prefix="/api/browse", tags=["browser"], dependencies=[Depends(require_auth)])


def _has_subfolders(path) -> bool:
    try:
        with os.scandir(path) as it:
            for entry in it:
                if entry.name.startswith("."):
                    continue
                try:
                    if entry.is_dir(follow_symlinks=False):
                        return True
                except OSError:
                    continue
    except OSError:
        pass
    return False


def _entry(path, kind: str) -> dict:
    try:
        stat = path.stat()
        size = stat.st_size if kind == "file" else None
        mtime = stat.st_mtime
    except OSError:
        size, mtime = None, None

    item = {
        "name": path.name,
        "path": to_relative(path),
        "type": kind,
    }
    if kind == "file":
        video = is_video(path.suffix)
        item["size"] = size
        item["mtime"] = mtime
        item["previewable"] = video or is_previewable(path.suffix)
        item["is_video"] = video
        item["extension"] = path.suffix.lstrip(".").lower()
    else:
        item["has_subfolders"] = _has_subfolders(path)
    return item


@router.get("")
def browse(path: str = "") -> dict:
    target = resolve_safe(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    folders, files = [], []
    try:
        entries = list(target.iterdir())
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    for entry in entries:
        if is_hidden(entry):
            continue
        if entry.is_dir():
            folders.append(_entry(entry, "folder"))
        elif entry.is_file():
            files.append(_entry(entry, "file"))

    folders.sort(key=lambda e: e["name"].lower())
    files.sort(key=lambda e: e["name"].lower())

    return {
        "path": to_relative(target),
        "folders": folders,
        "files": files,
    }
