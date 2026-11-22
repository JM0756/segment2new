"""Generate pixel art with per-asset provider fallback."""
import base64
from collections import Counter, deque
from http.client import HTTPException
import io
import json
import logging
import os
from pathlib import Path
from time import sleep
from PIL import Image, ImageFilter, ImageOps
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


if __package__:
    from .settings import load_env
else:
    from settings import load_env

load_env(Path(__file__).resolve().parents[1] / ".env")
logger = logging.getLogger(__name__)


class ImageGenerationError(Exception):
    pass


def clean_sprite_background(image):
    image = image.convert("RGBA")
    w, h = image.size
    pixels = image.load()
    border = [pixels[x,y] for x in range(w) for y in (0,h-1)]
    border.extend(pixels[x,y] for y in range(1,h-1) for x in (0,w-1))
    opaque = [p[:3] for p in border if p[3] >= 128]
    if not opaque:
        return frame_character(image)
    def bucket(rgb):
        return tuple(v//16 for v in rgb)
    dominant = Counter(map(bucket,opaque)).most_common(1)[0][0]
    samples = [rgb for rgb in opaque if bucket(rgb)==dominant]
    background = tuple(sum(rgb[i] for rgb in samples)/len(samples) for i in range(3))
    brightness = sum(background)/3
    alpha = bytearray(image.getchannel("A").tobytes())
    seen = bytearray(w*h)
    queue = deque()

    def visit(x, y):
        i = y*w+x
        if seen[i]:
            return
        seen[i] = 1
        r,g,b,_ = pixels[x,y]
        if not alpha[i] or ((r-background[0])**2 + (g-background[1])**2 + (b-background[2])**2 < 70**2):
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
            if (max(background)-min(background)<24 and max(r,g,b)-min(r,g,b)<18
                    and abs((r+g+b)/3-brightness)<25):
                alpha[y*w+x] = 0
    mask = Image.frombytes("L",(w,h),bytes(alpha))
    image.putalpha(Image.composite(mask.filter(ImageFilter.GaussianBlur(.5)), mask, mask))
    return frame_character(image)


cutout = clean_sprite_background


def frame_character(image):
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
        self.pixel_key = os.getenv("PIXELLAB_API_KEY", "").strip()
        self.pixel_base = (os.getenv("PIXELLAB_BASE_URL") or "https://api.pixellab.ai/v1").strip().rstrip("/")
        self.model = os.getenv("IMAGE_MODEL") or "@cf/black-forest-labs/flux-1-schnell"
        self.retro_key = os.getenv("RETRODIFFUSION_API_KEY", "").strip()
        self.provider = (os.getenv("IMAGE_PROVIDER") or "auto").strip().lower()
        self.providers = {}

    def animate(self, directory, asset, description):
        """Build a four-frame horizontal sheet from PixelLab's 64px text animation."""
        source = directory / asset
        relative = Path(asset).with_stem(source.stem + "_anim")
        try:
            with Image.open(source) as image:
                reference = image.convert("RGBA").resize((64, 64), Image.Resampling.NEAREST)
            buffer = io.BytesIO()
            reference.save(buffer, format="PNG")
            payload = {
                "image_size": {"width": 64, "height": 64}, "description": description,
                "action": "Four-frame in-place walk cycle with a resting pose. Keep the character centered.",
                "n_frames": 4, "direction": "south", "view": "low top-down",
                "reference_image": {"type": "base64", "base64": base64.b64encode(buffer.getvalue()).decode("ascii")},
            }
            request = Request(self.pixel_base + "/animate-with-text", json.dumps(payload).encode(), {
                "Authorization": f"Bearer {self.pixel_key}", "Content-Type": "application/json",
                "User-Agent": "ur2phd-generator/1.0",
            })
            with urlopen(request, timeout=20) as response:
                frames = json.load(response)["images"]
            if not isinstance(frames, list) or len(frames) != 4:
                raise ValueError("PixelLab animation needs four frames")
            sheet = Image.new("RGBA", (512, 128))
            for index, frame in enumerate(frames):
                encoded = frame["base64"].split(",")[-1]
                with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as image:
                    if image.width != image.height:
                        raise ValueError("Expected square animation frames")
                    cell = image.convert("RGBA").resize((128, 128), Image.Resampling.NEAREST)
                    if not cell.getchannel("A").getbbox():
                        raise ValueError("Empty animation frame")
                    sheet.paste(cell, (index * 128, 0))
            sheet.save(directory / relative, format="PNG")
        except (OSError, HTTPException, ValueError, KeyError, AttributeError, TypeError,
                SyntaxError, Image.DecompressionBombError) as exc:
            raise ImageGenerationError(str(exc)) from exc
        return relative.as_posix()

    def generate(self, prompt, directory, run_slug, slot):
        order = ["retrodiffusion", "pixellab", "cloudflare"]
        if self.provider != "auto":
            if self.provider not in order:
                raise ImageGenerationError(f"Unknown IMAGE_PROVIDER: {self.provider}")
            order = order[order.index(self.provider):]
        failures = []
        for provider in order:
            if ((provider == "retrodiffusion" and not self.retro_key) or
                    (provider == "pixellab" and not self.pixel_key)):
                logger.info("%s: skipping %s (no API key)", slot, provider)
                continue
            try:
                path = self._generate_with(provider, prompt, directory, run_slug, slot)
            except ImageGenerationError as exc:
                reason = f"{provider}: {exc}"
                logger.warning("%s image fallback: %s", slot, reason)
                failures.append(reason)
                continue
            self.providers[slot] = provider
            return path
        self.providers[slot] = "procedural"
        raise ImageGenerationError("; ".join(failures))

    def _generate_with(self, provider, prompt, directory, run_slug, slot):
        headers = {"Content-Type": "application/json", "User-Agent": "ur2phd-generator/1.0"}
        scene = slot == "backgroundSprite"
        if provider == "retrodiffusion":
            endpoint = "https://api.retrodiffusion.ai/v1/inferences"
            headers["X-RD-Token"] = self.retro_key
            width, height = (384, 216) if scene else (128, 128)
            if not scene:
                prompt = prompt.replace("pure solid #FFFFFF background", "transparent background")
                prompt += ". Centered full-body pixel-art character sprite, clear silhouette, transparent background."
            payload = dict(width=width, height=height, prompt=prompt, remove_bg=not scene, num_images=1,
                           prompt_style="rd_fast__environment" if scene else "rd_fast__game_asset")
        elif provider == "pixellab":
            endpoint = self.pixel_base + "/generate-image-pixflux"
            headers["Authorization"] = f"Bearer {self.pixel_key}"
            size = {"width": 320, "height": 180} if scene else {"width": 128, "height": 128}
            if not scene:
                prompt = ("Standardized blocky 2.5D chibi pixel avatar, square head, compact torso, "
                          "2px dark outline, full body, transparent background. " +
                          prompt.replace("pure solid #FFFFFF background", "transparent background"))
            payload = dict(description=prompt, image_size=size, no_background=not scene)
        else:
            endpoint = self.base + "/images/generations"
            if self.key:
                headers["Authorization"] = f"Bearer {self.key}"
            prompt = "16-bit top-down RPG pixel art, crisp pixel grid, flat shading, no anti-aliasing. " + prompt
            payload = dict(model=self.model, prompt=prompt, size="512x512", n=1, response_format="b64_json")
        suffix = "background" if scene else slot
        relative = Path("assets") / f"{run_slug}_{suffix}.png"
        target = directory / relative
        try:
            request = Request(endpoint, json.dumps(payload).encode(), headers)
            for attempt in range(2):
                try:
                    with urlopen(request, timeout=30) as response:
                        result = json.load(response)
                    break
                except HTTPError as error:
                    if provider != "cloudflare" or attempt or error.code not in (429, 502, 503):
                        raise
                    error.close()
                    sleep(10)
            item = result.get("image") or (result.get("base64_images") or result.get("images") or result.get("data") or [result])[0]
            if isinstance(item,str):
                item = {"url":item} if item.startswith(("https://","http://")) else {"base64":item}
            encoded = item.get("base64") or item.get("b64_json")
            if encoded:
                if encoded.startswith("data:"):
                    encoded = encoded.split(",", 1)[1]
                raw_bytes = base64.b64decode(encoded, validate=True)
            else:
                url = item["url"]
                if urlsplit(url).scheme not in ("http", "https"):
                    raise ValueError("Expected an HTTP(S) image URL")
                with urlopen(url, timeout=30) as response:
                    raw_bytes = response.read()
            try:
                with Image.open(io.BytesIO(raw_bytes)) as source:
                    image = source.convert("RGBA")
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
                snippet = raw_bytes[:200].decode("utf-8", errors="replace")
                raise ImageGenerationError(f"Invalid image response: {snippet!r}") from error
            target.parent.mkdir(parents=True, exist_ok=True)
            if scene:
                output = ImageOps.fit(image.convert("RGB"), (384, 216) if provider == "retrodiffusion" else (320, 180), method=Image.Resampling.NEAREST)
            elif provider != "cloudflare" and image.getpixel((0,0))[3] == 0:
                output = frame_character(image)
            else:
                output = clean_sprite_background(image)
            output.save(target, format="PNG")
        except HTTPError as error:
            try:
                detail = error.read().decode("utf-8", errors="replace").strip()
            except (OSError, HTTPException) as read_error:
                detail = str(read_error)
            raise ImageGenerationError(f"HTTP {error.code}: {error.reason} {detail}".strip()) from error
        except (OSError, HTTPException, ValueError, TypeError, AttributeError, KeyError, IndexError) as error:
            raise ImageGenerationError(str(error)) from error
        return relative.as_posix()
