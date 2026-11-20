"""Generate one PNG sprite using an OpenAI-compatible image endpoint."""
import base64
from http.client import HTTPException
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ImageGenerationError(Exception):
    pass


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
            with urlopen(request, timeout=180) as response:
                item = json.load(response)["data"][0]
            if item.get("b64_json"):
                png = base64.b64decode(item["b64_json"], validate=True)
            else:
                url = item["url"]
                if urlsplit(url).scheme not in ("http", "https"):
                    raise ValueError("Expected an HTTP(S) image URL")
                with urlopen(url, timeout=180) as response:
                    png = response.read()
            if not png.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Image response is not a PNG")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(png)
        except HTTPError as error:
            try:
                detail = error.read().decode("utf-8", errors="replace").strip()
            except (OSError, HTTPException) as read_error:
                detail = str(read_error)
            raise ImageGenerationError(f"HTTP {error.code}: {error.reason} {detail}".strip()) from error
        except (OSError, HTTPException, ValueError, TypeError, AttributeError, KeyError, IndexError) as error:
            raise ImageGenerationError(str(error)) from error
        return relative.as_posix()
