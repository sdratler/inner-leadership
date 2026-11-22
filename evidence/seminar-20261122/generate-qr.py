"""Authoring only: qrcode 8.2, zxing-cpp 3.1.1, Pillow. No app runtime dependency."""
import hashlib
import json
from pathlib import Path
import qrcode
import qrcode.image.svg
import zxingcpp
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "apps/life-skills/public/seminar"
URL = "https://bneineviimacademy.org/fish"
qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=16, border=4)
qr.add_data(URL)
qr.make(fit=True)
qr.make_image(fill_color="black", back_color="white").save(OUTPUT / "seminar-page-qr.png")
qr.make_image(image_factory=qrcode.image.svg.SvgPathFillImage).save(OUTPUT / "seminar-page-qr.svg")
decoded = zxingcpp.read_barcodes(Image.open(OUTPUT / "seminar-page-qr.png"))
assert len(decoded) == 1 and decoded[0].text == URL
flyer = zxingcpp.read_barcodes(Image.open(OUTPUT / "bass-fishing-seminar-20261122.jpg"))
assert len(flyer) == 1 and flyer[0].text == "https://www.google.com/maps/dir/?api=1&destination=26.3539417,-80.162461"
print(json.dumps({"qr_payload": decoded[0].text, "flyer_payload": flyer[0].text,
                  "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUTPUT.iterdir())}}, indent=2))
