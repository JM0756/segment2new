"""Generate one PNG sprite using an OpenAI-compatible image endpoint."""
import base64
from collections import deque
from http.client import HTTPException
import io
import json
import os
from pathlib import Path
from time import sleep
from PIL import Image, ImageFilter
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ImageGenerationError(Exception):
    pass


def cutout(image):
    w, h = image.size
    pixels = image.load()
    corners = [pixels[x, y] for x, y in ((0,0),(w-1,0),(0,h-1),(w-1,h-1))]
    opaque = [pixel for pixel in corners if pixel[3]]
    background = tuple(sum(p[c] for p in opaque)/len(opaque) for c in range(3)) if opaque else (255,255,255)
    alpha = bytearray(image.getchannel("A").tobytes())
    seen = bytearray(w*h)
    queue = deque()

    def visit(x, y):
        i = y*w+x
        if seen[i]:
            return
        seen[i] = 1
        r,g,b,_ = pixels[x,y]
        if not alpha[i] or ((r-background[0])**2 + (g-background[1])**2 + (b-background[2])**2 < 65**2):
            alpha[i] = 0
            queue.append((x,y))

    for x in range(w):
        visit(x,0)
        visit(x,h-1)
    for y in range(h):
        visit(0,y)
        visit(w-1,y)
    while queue:
        x,y = queue.popleft()
        if x: visit(x-1,y)
        if y: visit(x,y-1)
        if x+1<w: visit(x+1,y)
        if y+1<h: visit(x,y+1)
    for y in range(h):
        for x in range(w):
            r,g,b,_ = pixels[x,y]
            if min(r,g,b)>232 and max(r,g,b)-min(r,g,b)<20:
                alpha[y*w+x] = 0
    mask = Image.frombytes("L",(w,h),bytes(alpha))
    image.putalpha(Image.composite(mask.filter(ImageFilter.GaussianBlur(.5)), mask, mask))
    bounds = image.getchannel("A").getbbox()
    canvas = Image.new("RGBA",(128,128))
    if bounds:
        body = image.crop(bounds)
        scale = min(92/body.height, 120/body.width)
        body = body.resize(tuple(max(1,round(n*scale)) for n in body.size), Image.Resampling.NEAREST)
        canvas.paste(body,((128-body.width)//2,116-body.height))
    return canvas



class ImageClient:
    def __init__(self):
        base = os.getenv("IMAGE_BASE_URL") or os.getenv("LLM_BASE_URL", "http://localhost:3001/v1")
        self.base = base.rstrip("/")
        if not self.base.endswith("/v1"):
            self.base += "/v1"
        self.key = os.getenv("IMAGE_API_KEY") or os.getenv("LLM_API_KEY")
        self.model = os.getenv("IMAGE_MODEL", "auto")

    def generate(self, prompt, directory, run_slug, slot):
        headers = {"Content-Type": "application/json", "User-Agent": "ur2phd-generator/1.0"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        payload = dict(model=self.model, prompt=prompt, size="512x512", n=1, response_format="b64_json")
        relative = Path("assets") / f"{run_slug}_{slot}.png"
        target = directory / relative
        try:
            request = Request(self.base + "/images/generations", json.dumps(payload).encode(), headers)
            for attempt in range(2):
                try:
                    with urlopen(request, timeout=180) as response:
                        item = json.load(response)["data"][0]
                    break
                except HTTPError as error:
                    if attempt or error.code not in (429, 502, 503):
                        raise
                    error.close()
                    sleep(10)
            if item.get("b64_json"):
                raw_bytes = base64.b64decode(item["b64_json"], validate=True)
            else:
                url = item["url"]
                if urlsplit(url).scheme not in ("http", "https"):
                    raise ValueError("Expected an HTTP(S) image URL")
                with urlopen(url, timeout=180) as response:
                    raw_bytes = response.read()
            try:
                with Image.open(io.BytesIO(raw_bytes)) as source:
                    image = source.convert("RGBA")
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
                snippet = raw_bytes[:200].decode("utf-8", errors="replace")
                raise ImageGenerationError(f"Invalid image response: {snippet!r}") from error
            target.parent.mkdir(parents=True, exist_ok=True)
            cutout(image).save(target, format="PNG")
        except HTTPError as error:
            try:
                detail = error.read().decode("utf-8", errors="replace").strip()
            except (OSError, HTTPException) as read_error:
                detail = str(read_error)
            raise ImageGenerationError(f"HTTP {error.code}: {error.reason} {detail}".strip()) from error
        except (OSError, HTTPException, ValueError, TypeError, AttributeError, KeyError, IndexError) as error:
            raise ImageGenerationError(str(error)) from error
        return relative.as_posix()
