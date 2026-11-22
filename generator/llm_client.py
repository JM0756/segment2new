"""Minimal client for OpenAI-compatible /chat/completions endpoints."""
import json
import os
import re
from time import sleep

import requests
from urllib3.exceptions import ReadTimeoutError


class APIError(Exception):
    pass


class GatewayTimeout(APIError):
    pass


def parse_config(text):
    text = re.sub(r"^\s*<think>.*?</think>", "", text, count=1, flags=re.S).strip()
    if not text.startswith("{"):
        fenced = re.findall(r"```(?:json)?\s*(.*?)\s*```", text, re.I | re.S)
        if len(fenced) == 1:
            text = fenced[0]
    return json.loads(text, parse_constant=reject_constant)


def reject_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


def normalize_base(value):
    base = (value or "http://localhost:3001/v1").strip().rstrip("/")
    return base if base.endswith("/v1") else base + "/v1"


class LLMClient:
    def __init__(self):
        self.base = normalize_base(os.getenv("LLM_BASE_URL"))
        self.model = os.getenv("LLM_MODEL", "auto")
        self.key = os.getenv("LLM_API_KEY")

    def complete(self, messages):
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ur2phd-generator/1.0",
        }
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        payload = {"model": self.model, "messages": messages, "stream": False, "max_tokens": 1400}
        for attempt in range(2):
            try:
                response = requests.post(self.base + "/chat/completions", json=payload,
                                         headers=headers, timeout=(10.0, 90.0))
                if response.status_code in (502, 503) and attempt == 0:
                    sleep(1.5)
                    continue
                if response.status_code >= 400:
                    detail = response.content.decode("utf-8", errors="replace").strip()
                    message = f"Chat endpoint returned HTTP {response.status_code}: {response.reason} - {detail}"
                    if response.status_code == 504 or (response.status_code in (502, 503) and
                                                       re.search(r"timed?\s*out|timeout", detail, re.I)):
                        raise GatewayTimeout(message)
                    raise APIError(message)
                result = response.json()["choices"][0]["message"]["content"]
                if not isinstance(result, str):
                    raise ValueError("Expected a string in message.content")
                return result
            except requests.RequestException as exc:
                # Requests wraps a timeout while reading the response body in ConnectionError.
                if isinstance(exc, requests.Timeout) or isinstance(exc.args[0] if exc.args else None, ReadTimeoutError):
                    if attempt == 0:
                        sleep(1.5)
                        continue
                    raise GatewayTimeout(str(exc)) from exc
                raise APIError(str(exc)) from exc
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise APIError(str(exc)) from exc
