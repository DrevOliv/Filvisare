import subprocess
from io import BytesIO
from pathlib import Path

from PIL import Image

from ..base import PreviewHandler


class VideoThumbnailHandler(PreviewHandler):
    """Extract a single frame from a video and encode it as a WebP thumbnail.

    Uses ffmpeg (must be on PATH — installed in the Docker image).
    Tries to seek 1 second in to avoid black/fade-in first frames, falls
    back to frame 0 for very short clips.
    """

    extensions = ("mp4", "mov", "mkv", "webm", "m4v", "avi")
    output_mime = "image/webp"
    kind = "video"

    def render(self, source: Path, max_size: int) -> bytes:
        frame = self._extract_frame(source, offset="00:00:01")
        if frame is None:
            frame = self._extract_frame(source, offset="00:00:00")
        if frame is None:
            raise RuntimeError("ffmpeg could not extract a frame from the video")

        with Image.open(BytesIO(frame)) as img:
            img = img.convert("RGB")
            img.thumbnail((max_size, max_size), Image.LANCZOS)
            buffer = BytesIO()
            img.save(buffer, format="WEBP", quality=88, method=4)
            return buffer.getvalue()

    @staticmethod
    def _extract_frame(source: Path, offset: str) -> bytes | None:
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-ss", offset,
            "-i", str(source),
            "-vframes", "1",
            "-f", "image2",
            "-c:v", "mjpeg",
            "-q:v", "2",
            "-y",
            "-loglevel", "error",
            "pipe:1",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=30)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None
        if result.returncode != 0 or not result.stdout:
            return None
        return result.stdout
