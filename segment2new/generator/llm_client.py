"""Minimal client for OpenAI-compatible /chat/completions endpoints."""
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class APIError(Exception):
    pass


def parse_config(text):
    fenced = re.fullmatch(r"\s*```(?:json)?\s*(.*?)\s*```\s*", text, re.I | re.S)
    return json.loads(fenced.group(1) if fenced else text, parse_constant=reject_constant)


def reject_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


class LLMClient:
    def __init__(self):
        self.base = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
        self.model = os.getenv("LLM_MODEL", "qwen2.5:7b")
        self.key = os.getenv("LLM_API_KEY")

    def complete(self, messages):
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        payload = {"model": self.model, "messages": messages, "stream": False}
        request = Request(self.base + "/chat/completions", json.dumps(payload).encode(), headers)
        try:
            with urlopen(request, timeout=180) as response:
                result = json.load(response)["choices"][0]["message"]["content"]
            if not isinstance(result, str):
                raise ValueError("Expected a string in message.content")
            return result
        except HTTPError as error:
            raise APIError(f"Chat endpoint returned HTTP {error.code}: {error.reason}") from error
        except (URLError, OSError, ValueError, KeyError, IndexError, TypeError) as error:
            raise APIError(str(error)) from error
