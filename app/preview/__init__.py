from . import registry
from .handlers import raw_image, standard_image, video


def install_default_handlers() -> None:
    registry.register(standard_image.StandardImageHandler())
    registry.register(raw_image.RawImageHandler())
    registry.register(video.VideoThumbnailHandler())
