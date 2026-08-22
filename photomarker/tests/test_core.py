from pathlib import Path
from PIL import Image
from core import Arrow, apply_blur_stroke, render_final, save_over_original


def test_arrow_changes_pixels():
    img = Image.new("RGB", (200, 100), "white")
    out = render_final(img, [Arrow(10, 50, 180, 50, 8, "#ff0000")])
    assert out.getpixel((100, 50))[:3] == (255, 0, 0)


def test_blur_keeps_size():
    img = Image.new("RGB", (120, 80), "white")
    for x in range(40, 80):
        for y in range(20, 60):
            img.putpixel((x, y), (0, 0, 0))
    out = apply_blur_stroke(img, [(50, 40), (70, 40)], 30, 8)
    assert out.size == img.size
    assert out.mode == "RGBA"


def test_save_overwrites_same_file(tmp_path: Path):
    p = tmp_path / "same-name.jpg"
    Image.new("RGB", (100, 60), "white").save(p, quality=90)
    before = sorted(x.name for x in tmp_path.iterdir())
    save_over_original(Image.new("RGB", (100, 60), "white"), [Arrow(5, 30, 90, 30, 5, "#ff0000")], p)
    after = sorted(x.name for x in tmp_path.iterdir())
    assert before == after == ["same-name.jpg"]
    with Image.open(p) as im:
        assert im.size == (100, 60)
