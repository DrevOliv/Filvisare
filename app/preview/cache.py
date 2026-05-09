import asyncio
import hashlib
import shutil
from pathlib import Path

from ..config import settings


def cache_path(source: Path, max_size: int, mime: str) -> Path:
    stat = source.stat()
    key = f"{source.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{max_size}|{mime}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    extension = "webp" if "webp" in mime else "jpg"
    return settings.cache_root / digest[:2] / f"{digest}.{extension}"


def read_or_generate(source: Path, max_size: int, mime: str, generator) -> bytes:
    """Return cached preview bytes, generating and storing if missing."""
    path = cache_path(source, max_size, mime)
    if path.exists():
        return path.read_bytes()

    data = generator()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return data


async def run_sweeper() -> None:
    """Periodically wipe the cache. Cancel the task to stop it."""
    interval = settings.cache_clear_interval
    if interval <= 0:
        return
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_clear_cache)


def _clear_cache() -> None:
    root = settings.cache_root
    if not root.exists():
        return
    for entry in root.iterdir():
        try:
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
        except OSError:
            pass
