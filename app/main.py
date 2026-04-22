from pathlib import Path

# When run as a script (e.g. `python app/main.py` or the PyCharm green button),
# Python sets sys.path[0] to `app/`, which breaks `from app.*` imports.
# Prepend the project root so both script-mode and package-mode work.
if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
import tempfile
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.auth.dependencies import verify_token
from app.auth.router import router as auth_router
from app.browser.router import router as browser_router
from app.config import settings
from app.likes.router import router as likes_router
from app.preview import install_default_handlers
from app.preview.cache import start_sweeper
from app.preview.router import router as preview_router
from app.video import router as video_router


STATIC_DIR = Path(__file__).parent / "static"
# uvicorn.error is always configured and visible in the terminal.
log = logging.getLogger("uvicorn.error")

install_default_handlers()


def _check_writable(path: Path, label: str) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path, prefix=".write-check-", delete=True):
            pass
    except OSError as exc:
        log.error(
            "Cannot write to %s directory at %s (%s). "
            "Fix permissions or change the env var, or the app will fail on first use.",
            label, path, exc,
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _check_writable(settings.cache_root, "CACHE_ROOT")
    _check_writable(settings.state_root, "STATE_ROOT")
    start_sweeper()
    yield


app = FastAPI(title="Filvisare", docs_url=None, redoc_url=None, lifespan=lifespan)

app.include_router(auth_router)
app.include_router(browser_router)
app.include_router(preview_router)
app.include_router(video_router)
app.include_router(likes_router)


def _is_authed(request: Request) -> bool:
    return verify_token(request.cookies.get(settings.session_cookie))


@app.get("/", include_in_schema=False)
def index(request: Request):
    if not _is_authed(request):
        return RedirectResponse("/login")
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login", include_in_schema=False)
def login_page(request: Request):
    if _is_authed(request):
        return RedirectResponse("/")
    return FileResponse(STATIC_DIR / "login.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
