import hashlib
import shutil
import threading
import time
from pathlib import Path

from ..config import settings


_sweeper_started = False
_sweeper_lock = threading.Lock()


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


def is_cached(source: Path, max_size: int, mime: str) -> bool:
    return cache_path(source, max_size, mime).exists()


def ensure_cached(source: Path, max_size: int, mime: str, generator) -> bool:
    """Generate the preview only if it isn't cached yet. Returns True on hit."""
    path = cache_path(source, max_size, mime)
    if path.exists():
        return True
    data = generator()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return False


def start_sweeper() -> None:
    """Start a background thread that wipes the cache on an interval.

    Safe to call multiple times; only the first call starts the thread.
    If CACHE_CLEAR_INTERVAL is 0, no thread is started.
    """
    global _sweeper_started
    with _sweeper_lock:
        if _sweeper_started:
            return
        _sweeper_started = True

    if settings.cache_clear_interval <= 0:
        return

    thread = threading.Thread(target=_sweep_loop, name="cache-sweeper", daemon=True)
    thread.start()


def _sweep_loop() -> None:
    interval = settings.cache_clear_interval
    while True:
        time.sleep(interval)
        _clear_cache()


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
