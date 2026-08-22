from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import os
import tempfile
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter


@dataclass(frozen=True)
class Arrow:
    x1: float
    y1: float
    x2: float
    y2: float
    width: int = 8
    color: str = "#ff2b2b"


def apply_blur_stroke(image: Image.Image, points: Iterable[tuple[float, float]], brush_size: int, radius: float) -> Image.Image:
    pts = list(points)
    if not pts:
        return image.copy()
    src = image.convert("RGBA")
    blurred = src.filter(ImageFilter.GaussianBlur(radius=max(0.1, float(radius))))
    mask = Image.new("L", src.size, 0)
    draw = ImageDraw.Draw(mask)
    width = max(1, int(brush_size))
    if len(pts) == 1:
        x, y = pts[0]
        r = width / 2
        draw.ellipse((x-r, y-r, x+r, y+r), fill=255)
    else:
        draw.line(pts, fill=255, width=width, joint="curve")
        r = width / 2
        for x, y in (pts[0], pts[-1]):
            draw.ellipse((x-r, y-r, x+r, y+r), fill=255)
    return Image.composite(blurred, src, mask)


def _hex_to_rgba(value: str) -> tuple[int, int, int, int]:
    s = value.strip().lstrip("#")
    if len(s) == 6:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255
    if len(s) == 8:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16)
    return 255, 43, 43, 255


def draw_arrow(draw: ImageDraw.ImageDraw, arrow: Arrow) -> None:
    x1, y1, x2, y2 = arrow.x1, arrow.y1, arrow.x2, arrow.y2
    width = max(1, int(arrow.width))
    color = _hex_to_rgba(arrow.color)
    draw.line((x1, y1, x2, y2), fill=color, width=width)
    angle = math.atan2(y2 - y1, x2 - x1)
    head_len = max(width * 3.0, 18.0)
    head_half = max(width * 1.6, 10.0)
    back_x = x2 - head_len * math.cos(angle)
    back_y = y2 - head_len * math.sin(angle)
    px = -math.sin(angle)
    py = math.cos(angle)
    draw.polygon(((x2, y2), (back_x + head_half * px, back_y + head_half * py), (back_x - head_half * px, back_y - head_half * py)), fill=color)


def render_final(image: Image.Image, arrows: Iterable[Arrow]) -> Image.Image:
    out = image.convert("RGBA").copy()
    draw = ImageDraw.Draw(out)
    for arrow in arrows:
        draw_arrow(draw, arrow)
    return out


def save_over_original(image: Image.Image, arrows: Iterable[Arrow], original_path: str | os.PathLike, exif: bytes | None = None) -> None:
    path = Path(original_path)
    if not path.exists():
        raise FileNotFoundError(path)
    ext = path.suffix.lower()
    fmt_by_ext = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".bmp": "BMP", ".webp": "WEBP"}
    fmt = fmt_by_ext.get(ext)
    if not fmt:
        raise ValueError(f"Unsupported format: {ext}")

    final = render_final(image, arrows)
    if fmt == "JPEG":
        final = final.convert("RGB")

    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.stem}.photomarker-", suffix=path.suffix, dir=path.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        kwargs: dict = {}
        if fmt == "JPEG":
            kwargs.update(quality=95, subsampling=0, optimize=True)
            if exif:
                kwargs["exif"] = exif
        elif fmt == "WEBP":
            kwargs.update(quality=95, method=6)
        elif fmt == "PNG":
            kwargs.update(optimize=True)
        final.save(tmp, format=fmt, **kwargs)
        with Image.open(tmp) as verify:
            verify.verify()
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
