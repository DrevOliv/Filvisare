import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from ..auth.dependencies import require_auth
from ..fs import resolve_safe


router = APIRouter(prefix="/api/download", tags=["download"], dependencies=[Depends(require_auth)])


def _iter_files(path: Path):
    """Yield (real_path, arcname) pairs for everything under `path`.

    For directories, arcnames are rooted at the directory itself so the
    archive preserves the folder structure the user selected.
    """
    if path.is_file():
        yield path, path.name
        return

    base = path.parent
    for root, dirs, files in os.walk(path):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if name.startswith("."):
                continue
            full = Path(root) / name
            rel = full.relative_to(base)
            yield full, str(rel).replace("\\", "/")


class _StreamBuffer:
    """Non-seekable sink so ZipFile writes entries in streaming (data-descriptor) mode.

    Writes accumulate in a chunk list that the enclosing generator drains and
    yields to the HTTP client. Raising on seek() is what flips ZipFile into
    streaming mode — then no entry ever needs to be rewritten.
    """

    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._pos = 0

    def write(self, data) -> int:
        chunk = bytes(data)
        self._chunks.append(chunk)
        self._pos += len(chunk)
        return len(chunk)

    def tell(self) -> int:
        return self._pos

    def flush(self) -> None:
        pass

    def seek(self, *_args, **_kwargs):
        raise OSError("unseekable")

    def drain(self) -> bytes:
        if not self._chunks:
            return b""
        data = b"".join(self._chunks)
        self._chunks.clear()
        return data


def _stream_zip(targets: list[Path]):
    buf = _StreamBuffer()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        seen: set[str] = set()
        for target in targets:
            for real, arcname in _iter_files(target):
                if arcname in seen:
                    continue
                seen.add(arcname)
                try:
                    zf.write(real, arcname)
                except OSError:
                    continue
                chunk = buf.drain()
                if chunk:
                    yield chunk
    chunk = buf.drain()
    if chunk:
        yield chunk


def _resolve_all(paths: list[str]) -> list[Path]:
    resolved: list[Path] = []
    for p in paths:
        target = resolve_safe(p)
        if not target.exists():
            raise HTTPException(status_code=404, detail=f"Not found: {p}")
        resolved.append(target)
    return resolved


@router.post("")
def download(paths: list[str] = Form(...)):
    if not paths:
        raise HTTPException(status_code=400, detail="No paths selected")

    resolved = _resolve_all(paths)

    if len(resolved) == 1 and resolved[0].is_file():
        f = resolved[0]
        return FileResponse(f, filename=f.name, media_type="application/octet-stream")

    filename = f"{resolved[0].name}.zip" if len(resolved) == 1 else "download.zip"
    return StreamingResponse(
        _stream_zip(resolved),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
