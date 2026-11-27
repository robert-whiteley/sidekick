"""Made-up pictures for the background bench's photo cases (background-cases.ts).

Usage: python3 bench/answers/photos.py <out-dir>   (needs Pillow)
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size: int):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def picture(name: str, bg: str, fg: str, lines: list[tuple[str, int]], out: Path) -> None:
    img = Image.new("RGB", (768, 768), bg)
    d = ImageDraw.Draw(img)
    y = 120
    for text, size in lines:
        d.text((60, y), text, fill=fg, font=font(size))
        y += int(size * 1.5)
    img.save(out / name)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    picture("sign.png", "#123a7a", "white", [("PLATFORM 4", 90), ("Trains to Brackley", 44), ("and Northfield", 44)], out)
    picture(
        "receipt.png",
        "white",
        "black",
        [("CORNER SHOP", 48), ("Bread        2.10", 36), ("Oat milk     1.95", 36), ("Coffee      13.80", 36), ("TOTAL       17.85", 44)],
        out,
    )
    picture(
        "label.png",
        "#f4f4ee",
        "#202020",
        [("PAINAWAY 500 mg", 50), ("Take 2 tablets", 40), ("every 6 hours.", 40), ("No more than 8 in 24 hours.", 32)],
        out,
    )
    picture("note.png", "#fff6a8", "#1a1a1a", [("WiFi: GuestNet", 50), ("Password:", 50), ("tulip-garden-58", 50)], out)


if __name__ == "__main__":
    main()
