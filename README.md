# ImageViewer

A lean, Finder-style file browser built for **previewing images** — including
camera RAW files like `.NEF`, `.DNG`, `.CR2`, `.ARW` that tools like Filebrowser
can't display.

Point it at one or more folders, open your browser, and flip through your
photos with arrow keys. Heart the ones you want to come back to later.

---

## Highlights

- **Finder-like grid**: big folder icons, lazy-loaded image thumbnails, hover
  states, breadcrumb path at the top.
- **RAW support**: `.nef`, `.dng`, `.cr2`, `.cr3`, `.arw`, `.raf`, `.rw2`,
  `.orf`, `.pef`, `.srw`, `.nrw` — decoded via embedded JPEG previews for
  speed, falling back to libraw when needed.
- **Video support**: `.mp4`, `.mov`, `.mkv`, `.webm`, `.m4v`, `.avi` —
  ffmpeg-extracted frame for the thumbnail, HTML5 `<video>` with Range
  streaming for playback in the lightbox.
- **Full-screen lightbox**: single click to open, arrow keys to flip, `L` to
  like, `Esc` to close. Next/prev images are preloaded for instant transitions.
- **Likes**: one-click heart on any image. Jump to all liked images from the
  toolbar — useful when you want to come back and process them.
- **Fast previews**: WebP output, on-disk cache keyed by file mtime so a second
  visit is instant.
- **Docker-native**: mount any folder under `/data/<name>` and it shows up in
  the root.
- **Password auth**: single-user, set via env var. No database, no users table.
  The code is structured so you can add one later without ripping things out.

---

## Quick start

```bash
git clone <this repo>
cd ImageViewer

# edit docker-compose.yml to set APP_PASSWORD and SECRET_KEY,
# and to mount the folder(s) you want to browse

docker compose up -d
```

Open [http://localhost:8000](http://localhost:8000), enter your password, and
start browsing.

### Mounting folders

In `docker-compose.yml`, add a line under `volumes:` for each folder you want
to browse. The path on the right (under `/data/…`) is what appears in the app:

```yaml
volumes:
  - ./images:/data/images          # shows up as "images"
  - ~/Pictures:/data/pictures      # shows up as "pictures"
  - /mnt/nas/photos:/data/nas      # shows up as "nas"
```

### Configuration

You can configure the app three ways, in this order of precedence:

1. **Real environment variables** (e.g. `docker-compose.yml` `environment:`).
2. **A `.env` file**, auto-loaded from the project root — copy `.env.example`
   to `.env` and fill it in.
3. **A custom env file path** via `ENV_FILE=/path/to/whatever.env`.

Variables that real env vars set always win over `.env` file values.

| Variable            | Required | Default              | Description                                              |
|---------------------|----------|----------------------|----------------------------------------------------------|
| `APP_PASSWORD`      | yes      | —                    | The single login password.                               |
| `SECRET_KEY`        | yes      | random per-restart   | Used to sign session cookies. Set it, or logins die on restart. |
| `DATA_ROOT`         | no       | `/data`              | Folder whose contents show up in the browser.            |
| `CACHE_ROOT`        | no       | `/cache`             | Where generated preview WebPs are stored.                |
| `STATE_ROOT`        | no       | `/state`             | Where app state (e.g. `likes.json`) lives.               |
| `ENV_FILE`          | no       | `./.env`             | Path to the env file to load.                            |
| `THUMBNAIL_SIZE`    | no       | `400`                | Max edge (px) for grid thumbnails.                       |
| `FULL_PREVIEW_SIZE` | no       | `2500`               | Max edge (px) for the lightbox image.                    |
| `SESSION_MAX_AGE`   | no       | `2592000` (30 days)  | Cookie lifetime in seconds.                              |
| `CACHE_MAX_MB`      | no       | `2048`               | Cap on the preview cache. Oldest-used files are evicted when exceeded. `0` disables. |

Generate a secret key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## Using it

| Action                    | How                                              |
|---------------------------|--------------------------------------------------|
| Enter a folder            | Double-click (or single-tap on touch)            |
| Go up a level             | Back arrow in toolbar, or click a breadcrumb     |
| Open image fullscreen     | Click the thumbnail                              |
| Next / previous image     | `→` / `←`, or on-screen arrows                   |
| Like / unlike current     | Heart button, or press `L`                       |
| See all liked images      | "Liked" button in the top right                  |
| Close fullscreen          | `Esc`, or the `×` button, or click the backdrop  |

---

## Project layout

Each concern is its own package — add a feature by adding a package, not by
threading wires through existing code.

```
app/
├── main.py              FastAPI app wiring
├── config.py            Env-driven settings
├── fs.py                Safe path resolution (anti-traversal)
├── auth/                Password login + signed session cookies
├── browser/             Directory listing API
├── preview/             Thumbnail generation
│   ├── base.py          Abstract PreviewHandler
│   ├── registry.py      Maps file extensions → handlers
│   ├── cache.py         On-disk cache keyed by path+mtime+size, LRU-evicted
│   └── handlers/
│       ├── standard_image.py   JPG, PNG, WebP, HEIC, TIFF, …
│       ├── raw_image.py        NEF, DNG, CR2, ARW, …
│       └── video.py            MP4, MOV, MKV, WebM, … (ffmpeg)
├── video/               Range-aware video streaming for playback
├── likes/               Favorites, JSON-backed (swap for a DB later)
└── static/              HTML / CSS / JS
```

### Adding a new preview type

1. Create a handler in `app/preview/handlers/`:

   ```python
   from pathlib import Path
   from ..base import PreviewHandler

   class VideoThumbHandler(PreviewHandler):
       extensions = ("mp4", "mov")
       output_mime = "image/webp"

       def render(self, source: Path, max_size: int) -> bytes:
           ...  # extract a frame, resize, return WebP bytes
   ```

2. Register it in `app/preview/__init__.py` inside
   `install_default_handlers()`.

That's it — the browser API, cache, and frontend all pick it up automatically.

---

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set APP_PASSWORD, SECRET_KEY, and point DATA_ROOT/CACHE_ROOT/STATE_ROOT
# at folders you have permission to write (e.g. ./images, ./cache, ./state).

mkdir -p images cache state
uvicorn app.main:app --reload
```

Or just run it from your IDE — `python app/main.py` also works and picks up
the same `.env` file automatically.

Then visit [http://localhost:8000](http://localhost:8000).

---

## Roadmap

Things deliberately left out of v1 but easy to add:

- Multi-user auth (the `auth/` package is a drop-in replacement point).
- Persistent likes in SQLite (swap `likes/store.py`, keep the interface).
- EXIF panel in the lightbox.
- Keyboard shortcut for deleting / moving files.

---

## Publishing the Docker image

Replace `YOUR_DOCKERHUB_USER` with your Docker Hub username. Pick a version
tag you can increment (`v0.1.0`, `v0.2.0`, …) — `latest` alone makes it hard
to roll back.

### One-time: log in

```bash
docker login
```

### Multi-arch build (recommended)

If you build on an M-series Mac but deploy on an x86 Linux server (or vice
versa), use `buildx` to publish both architectures in one image:

```bash
# First time only — create and use a buildx builder
docker buildx create --name iv-builder --use
docker buildx inspect --bootstrap

# Build and push in one step
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t YOUR_DOCKERHUB_USER/imageviewer:v0.1.0 \
  -t YOUR_DOCKERHUB_USER/imageviewer:latest \
  --push .
```

### Pulling it on a server

On whatever host will run the app, change `docker-compose.yml` to use the
image instead of building:

```yaml
services:
  imageviewer:
    image: YOUR_DOCKERHUB_USER/imageviewer:latest
    # (drop the `build: .` line)
    ...
```

Then:

```bash
docker compose pull
docker compose up -d
```
