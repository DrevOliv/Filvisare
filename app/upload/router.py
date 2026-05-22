import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth.dependencies import require_auth
from ..fs import resolve_safe, to_relative


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload", tags=["upload"], dependencies=[Depends(require_auth)])

CHUNK = 1024 * 1024
# Per-file ceiling. Generous for photos and video; bounds a runaway upload.
MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024


def _safe_name(filename: str | None) -> str:
    """Strip any directory components from a client-supplied filename."""
    name = Path(filename or "").name.strip()
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


def _unique_path(directory: Path, name: str) -> Path:
    """Return a non-colliding path in `directory`, suffixing ' (n)' if needed."""
    candidate = directory / name
    if not candidate.exists():
        return candidate
    stem, suffix = Path(name).stem, Path(name).suffix
    for n in range(1, 1000):
        candidate = directory / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=409, detail="Too many name collisions")


@router.post("")
def upload(path: str = Form(""), files: list[UploadFile] = File(...)):
    target_dir = resolve_safe(path)
    if not target_dir.is_dir():
        raise HTTPException(status_code=400, detail="Destination is not a folder")

    saved: list[str] = []
    for upload_file in files:
        name = _safe_name(upload_file.filename)
        dest = _unique_path(target_dir, name)
        written = 0
        try:
            with dest.open("wb") as out:
                while chunk := upload_file.file.read(CHUNK):
                    written += len(chunk)
                    if written > MAX_FILE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"{name} exceeds the {MAX_FILE_BYTES // (1024 ** 3)} GB limit",
                        )
                    out.write(chunk)
        except HTTPException:
            dest.unlink(missing_ok=True)
            raise
        except OSError as exc:
            dest.unlink(missing_ok=True)
            log.exception("Failed to write upload %s", dest)
            raise HTTPException(status_code=500, detail=f"Could not save {name}") from exc
        finally:
            upload_file.file.close()
        saved.append(to_relative(dest))

    return {"ok": True, "saved": saved}


@router.post("/folder")
def create_folder(path: str = Form(""), name: str = Form(...)):
    raw = (name or "").strip()
    if not raw or raw in (".", "..") or "/" in raw or "\\" in raw:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    parent = resolve_safe(path)
    if not parent.is_dir():
        raise HTTPException(status_code=400, detail="Destination is not a folder")

    new_dir = parent / raw
    if new_dir.exists():
        raise HTTPException(status_code=409, detail="A file or folder with that name already exists")

    try:
        new_dir.mkdir()
    except OSError as exc:
        log.exception("Failed to create folder %s", new_dir)
        raise HTTPException(status_code=500, detail="Could not create folder") from exc

    return {"ok": True, "path": to_relative(new_dir)}
