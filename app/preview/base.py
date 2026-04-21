from abc import ABC, abstractmethod
from pathlib import Path


class PreviewHandler(ABC):
    """Base class for preview handlers.

    To add support for a new file type:
    1. Subclass this class and set `extensions` to the ones you support.
    2. Implement `render`, returning encoded image bytes (JPEG/WebP).
    3. Register the handler in `app.preview.__init__.install_default_handlers`.
    """

    extensions: tuple[str, ...] = ()
    output_mime: str = "image/webp"
    # How the frontend should render the full-size view.
    # "image" → <img src="/api/preview?...&size=full">
    # "video" → <video src="/api/video?...">
    kind: str = "image"

    @abstractmethod
    def render(self, source: Path, max_size: int) -> bytes:
        """Produce an encoded thumbnail whose longest edge is <= max_size."""
        raise NotImplementedError
