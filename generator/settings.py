"""Load repository settings, preferring values supplied by the shell."""
import os
import re
import shlex


def load_env(path):
    for key in ("LLM_BASE_URL","LLM_API_KEY","LLM_MODEL","IMAGE_MODEL","PIXELLAB_API_KEY"):
        if key in os.environ:
            value = os.environ[key].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1].strip()
            os.environ[key] = value
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if match:
            key, raw = match.groups()
            if key in os.environ:
                continue
            # An inline comment starts after whitespace; keys may contain literal '#'.
            raw = raw.strip()
            if raw.startswith(('"', "'")):
                try:
                    value = ' '.join(shlex.split(raw, comments=True))
                except ValueError:
                    continue
            else:
                value = re.split(r"\s+#",raw,maxsplit=1)[0]
            os.environ[key] = value.strip()
