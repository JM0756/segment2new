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


class UnusableCompletion(APIError):
    pass


def parse_config(text):
    if not isinstance(text, str):
        raise ValueError("Chat completion contained no text")
    text = re.sub(r"^\s*<think>.*?</think>", "", text, count=1, flags=re.S).strip()
    if not text:
        raise ValueError("Chat completion was empty")
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.I | re.S)
    if fenced and "{" in fenced[1]:
        text = fenced[1].strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("Chat completion contained no JSON object")
    # Match strings first so commas and braces inside labels remain literal.
    text = re.sub(r'("(?:[^"\\]|\\.)*")|,(?=\s*[}\]])',
                  lambda m: m[1] or "", text[start:])
    try:
        config, _ = json.JSONDecoder(parse_constant=reject_constant).raw_decode(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Chat completion contained malformed JSON: {exc.msg}") from exc
    return config


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
                if response.status_code in (429, 502, 503) and attempt == 0:
                    sleep(1.5)
                    continue
                if response.status_code >= 400:
                    detail = response.content.decode("utf-8", errors="replace").strip()
                    message = f"Chat endpoint returned HTTP {response.status_code}: {response.reason} - {detail}"
                    if response.status_code == 504 or (response.status_code in (502, 503) and
                                                       re.search(r"timed?\s*out|timeout", detail, re.I)):
                        raise GatewayTimeout(message)
                    if response.status_code == 429:
                        raise UnusableCompletion(message)
                    raise APIError(message)
                try:
                    choice = response.json()["choices"][0]
                    result = choice["message"]["content"]
                    truncated = choice.get("finish_reason") == "length"
                except (ValueError, KeyError, IndexError, TypeError):
                    result = None
                    truncated = False
                if isinstance(result, str) and result.strip() and (not truncated or attempt > 0):
                    return result
                if attempt == 0:
                    sleep(1.5)
                    payload = {**payload, "max_tokens": 2000}
                    continue
                raise UnusableCompletion("Chat endpoint returned no usable completion text")
            except requests.RequestException as exc:
                # Requests wraps a timeout while reading the response body in ConnectionError.
                if isinstance(exc, requests.Timeout) or isinstance(exc.args[0] if exc.args else None, ReadTimeoutError):
                    if attempt == 0:
                        sleep(1.5)
                        continue
                    raise GatewayTimeout(str(exc)) from exc
                raise APIError(str(exc)) from exc
