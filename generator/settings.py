"""Load repository settings without overriding shell variables."""
import os
import re
import shlex


def load_env(path):
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
            os.environ[key] = value
