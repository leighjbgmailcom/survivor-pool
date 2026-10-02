"""Read each castaway's points breakdown ("Won Group Reward +5", "Found an Idol +10", …) out of Global TV's
weekly results picture.

Global publishes only the totals as text; the breakdown is drawn in the image, one row per castaway, in the
same order as the totals. Each row is read separately and kept ONLY when its items add up to the total Global
published for that castaway, so a misread never reaches the site.

Needs: tesseract (apt install tesseract-ocr) and `pip install pillow pytesseract`.
"""
import difflib, io, re

# Global's usual wording → points. Used to tidy small misreads ("Cned on Camera" → "Cried on Camera").
PHRASES = {
    "Survived the Week": None, "Won Group Reward": 5, "Won Group Immunity": 5, "Chosen to Go on Reward": 5,
    "Found a Game Advantage": 5, "Got a Game Advantage": 5, "Played an Idol on Themselves": 5, "Used a Game Advantage": 5,
    "Cried on Camera": 5, "Said a Curse Word": 5, 'Said "I Miss"': 5, "Kissed Another Player": 5,
    "Heated Argument": 5, "Wardrobe Malfunction": 5, "Risked Their Vote": 5, "Found a Fake Idol": 5, "Hugged Jeff": 5,
    "Won Individual Reward": 10, "Found an Idol": 10, "Voted Out With an Idol": 10, "Voted Out With an Advantage": 10,
    "Played Shot in the Dark": 10, "Torch Snuffed Due to Blindside": 10, "Treated for a Medical Emergency": 10,
    "Chose to Forfeit": 10, "Caught Seafood": 10, "Caught Wildlife": 10, "Stole Food": 10, "Played a Fake Idol": 10,
    "Searched Through Someone's Bag": 10, "Voted Out Unanimously": 10, "Had an Idol Played on Them": 10,
    "Chosen to Go on a Journey": 10, "Won Individual Immunity": 15, "Safe After Shot in the Dark": 15,
    "Won Fire-Making Challenge": 15, "Gave Away an Idol": 15, "Played an Idol for Another Player": 15,
    "Created a Fake Idol": 15, "Forced to Leave the Game": 15, "Returned to the Game": 15,
    "Third Place": 10, "Second Place": 20, "Sole Survivor": 30,
}


def available():
    try:
        import pytesseract
        from PIL import Image  # noqa: F401
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def tidy(label, extra=()):
    label = re.sub(r"\s+", " ", label).strip(" .,:;-|")
    vocab = list(PHRASES) + list(extra)
    best = difflib.get_close_matches(label.lower(), [v.lower() for v in vocab], n=1, cutoff=0.82)
    if best:
        return next(v for v in vocab if v.lower() == best[0])
    return label[:1].upper() + label[1:]


def row_bands(img, n):
    """Find the n castaway rows: bright bands in the photo column on the left, else n equal slices."""
    g = img.convert("L")
    w, h = g.size
    col = g.crop((0, 0, max(8, int(w * 0.10)), h)).resize((1, h))
    lum = list(col.getdata())
    cut = max(28, sum(lum) / len(lum) * 0.6)
    bands, start = [], None
    for y, v in enumerate(lum + [0]):
        if v > cut and start is None:
            start = y
        elif v <= cut and start is not None:
            if y - start > h / (n * 3):
                bands.append((start, y))
            start = None
    if len(bands) == n and n > 1:
        # rows are evenly spaced: fit centre = c0 + i * pitch through the band centres
        xs = list(range(n)); cs = [(a + b) / 2 for a, b in bands]
        mx, mc = sum(xs) / n, sum(cs) / n
        pitch = sum((x - mx) * (c - mc) for x, c in zip(xs, cs)) / sum((x - mx) ** 2 for x in xs)
        c0 = mc - pitch * mx
        return [(max(0, int(c0 + i * pitch - pitch / 2)), min(h, int(c0 + i * pitch + pitch / 2))) for i in range(n)]
    return [(int(i * h / n), int((i + 1) * h / n)) for i in range(n)]


def read_row(strip, extra=()):
    """OCR one row's breakdown area; return candidate item lists [(label, points), …], best guess first."""
    import pytesseract
    from PIL import Image, ImageOps
    g = strip.convert("L")
    scale = max(2, min(4, round(2400 / max(1, g.width))))
    g = ImageOps.autocontrast(ImageOps.invert(g.resize((g.width * scale, g.height * scale), Image.LANCZOS)))
    out = []
    for psm in (6, 4, 11):
        text = pytesseract.image_to_string(g, config=f"--psm {psm}")
        text = re.sub(r"POINTS\s+BREAKDOWN\s*:?", "\n", text, flags=re.I)
        found = re.findall(r"([A-Za-z\"“][A-Za-z ,.'’\"“”…\-]{3,}?)\s*[+¢*]\s*(\d{1,2})\b", text)
        items = [(tidy(a, extra), int(b)) for a, b in found]
        if items and items not in out:
            out.append(items)
    return out


def read_image(data, totals, extra=()):
    """data: image bytes. totals: [(castaway, total), …] in the picture's order.
    Returns {castaway: [(label, points), …]} for the rows that add up, and the list of castaways that didn't."""
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    good, bad = {}, []
    for (name, total), (y0, y1) in zip(totals, row_bands(img, len(totals))):
        if total == 0:
            good[name] = []
            continue
        ok = None
        for x0 in (0.57, 0.52, 0.62):
            cands = read_row(img.crop((int(w * x0), y0, w, y1)), extra)
            for items in cands:
                if sum(p for _, p in items) == total:
                    ok = items
                    break
                # a misread digit: try the usual points for the phrases we recognise
                fixed = [(l, PHRASES.get(l) or p) for l, p in items]
                if sum(p for _, p in fixed) == total:
                    ok = fixed
                    break
            if ok:
                break
        if ok:
            good[name] = ok
        else:
            bad.append(name)
    return good, bad
