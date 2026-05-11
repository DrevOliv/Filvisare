import logging
import os
import zipfile
from io import BytesIO
from pathlib import Path

import rawpy
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image, ImageOps

from ..auth.dependencies import require_auth
from ..fs import resolve_safe


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/download", tags=["download"], dependencies=[Depends(require_auth)])

RAW_EXTS = {"nef", "dng", "cr2", "cr3", "arw", "raf", "rw2", "orf", "pef", "srw", "nrw"}
IMAGE_EXTS = {
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif",
} | RAW_EXTS


def _is_image(path: Path) -> bool:
    return path.suffix.lstrip(".").lower() in IMAGE_EXTS


def _load_full_image(path: Path) -> Image.Image:
    ext = path.suffix.lstrip(".").lower()
    if ext in RAW_EXTS:
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(
                use_camera_wb=True,
                no_auto_bright=False,
                output_bps=8,
                output_color=rawpy.ColorSpace.sRGB,
            )
        return Image.fromarray(rgb)
    return Image.open(path)


def _convert_image(path: Path, target: str) -> tuple[bytes, str]:
    """Re-encode an image at the highest practical quality. Returns (bytes, new_ext)."""
    img = _load_full_image(path)
    try:
        img = ImageOps.exif_transpose(img)
        buf = BytesIO()
        if target == "jpeg":
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=95, subsampling=0, optimize=True)
            return buf.getvalue(), "jpg"
        if target == "png":
            if img.mode not in ("RGB", "RGBA", "L", "LA"):
                img = img.convert("RGBA")
            img.save(buf, format="PNG", optimize=True, compress_level=6)
            return buf.getvalue(), "png"
        raise ValueError(f"Unsupported target format: {target}")
    finally:
        img.close()


def _retarget_arcname(arcname: str, new_ext: str) -> str:
    p = Path(arcname)
    return str(p.with_suffix("." + new_ext)).replace("\\", "/")


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


def _stream_zip(targets: list[Path], target_format: str):
    buf = _StreamBuffer()
    convert = target_format in ("jpeg", "png")
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        seen: set[str] = set()
        for target in targets:
            for real, arcname in _iter_files(target):
                converted: bytes | None = None
                use_arcname = arcname
                if convert and _is_image(real):
                    try:
                        converted, new_ext = _convert_image(real, target_format)
                        use_arcname = _retarget_arcname(arcname, new_ext)
                    except Exception:
                        log.exception("Failed to convert %s to %s; including original", real, target_format)
                        converted = None
                        use_arcname = arcname
                if use_arcname in seen:
                    continue
                seen.add(use_arcname)
                try:
                    if converted is not None:
                        zf.writestr(use_arcname, converted)
                    else:
                        zf.write(real, use_arcname)
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
def download(paths: list[str] = Form(...), format: str = Form("original")):
    if not paths:
        raise HTTPException(status_code=400, detail="No paths selected")

    fmt = (format or "original").lower()
    if fmt not in ("original", "jpeg", "png"):
        raise HTTPException(status_code=400, detail="Invalid format")

    resolved = _resolve_all(paths)

    if len(resolved) == 1 and resolved[0].is_file():
        f = resolved[0]
        if fmt in ("jpeg", "png") and _is_image(f):
            try:
                data, new_ext = _convert_image(f, fmt)
                new_name = f"{f.stem}.{new_ext}"
                mime = "image/jpeg" if fmt == "jpeg" else "image/png"
                return StreamingResponse(
                    iter([data]),
                    media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="{new_name}"'},
                )
            except Exception:
                pass
        return FileResponse(f, filename=f.name, media_type="application/octet-stream")

    filename = f"{resolved[0].name}.zip" if len(resolved) == 1 else "download.zip"
    return StreamingResponse(
        _stream_zip(resolved, fmt),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
