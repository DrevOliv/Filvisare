from fastapi import APIRouter, Depends, HTTPException

from ..auth.dependencies import require_auth
from ..fs import is_hidden, resolve_safe, to_relative
from ..preview.registry import get_handler, is_previewable


router = APIRouter(prefix="/api/browse", tags=["browser"], dependencies=[Depends(require_auth)])


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
        item["size"] = size
        item["mtime"] = mtime
        item["previewable"] = is_previewable(path.suffix)
        item["extension"] = path.suffix.lstrip(".").lower()
        handler = get_handler(path.suffix)
        item["media_kind"] = handler.kind if handler else None
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
