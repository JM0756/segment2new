"""Local Arcade Studio. Run with the generator environment's Python."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
import shlex
from urllib.error import HTTPError
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit, urljoin
from urllib.request import Request, urlopen
from threading import Lock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generator.generate import ARCHETYPES, GAMES, generate, validate
from generator.llm_client import LLMClient, APIError, normalize_base

progress_messages = {}
progress_lock = Lock()


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


load_env(ROOT/'.env')


def public(path):
    return '/' + path.relative_to(ROOT).as_posix()


def catalog():
    games = []
    for game in ARCHETYPES:
        source = GAMES / game / 'source'
        if not (source / 'index.html').is_file():
            continue
        folder = ROOT / 'generated' / game
        legacy = ROOT / "generated" / "Orbit-Patrol"
        configs = [source / 'default.json', source / 'level2.json', *sorted(folder.glob('*.json'))]
        if game == "Feature-Classifier":
            configs.extend(sorted(legacy.glob("*.json")))
        groups = {}
        configs.sort(key=lambda p: p.stat().st_mtime_ns if p.exists() else 0)
        for path in configs:
            if not path.exists() or path.name.endswith('.meta.json'):
                continue
            try:
                cfg = json.loads(path.read_text())
                theme = cfg['theme']
                level = re.search(r'_L([123])$', path.stem)
                tier = int(level[1]) if level else (2 if path.name == 'level2.json' else 1)
                group = path.stem[:level.start()] if level else path.stem
                meta = path.with_suffix('.meta.json')
                info = json.loads(meta.read_text()) if meta.exists() else {}
                topic = info.get('topic', game)
                setting = info.get('theme', theme['title'])
                key = 'baseline' if path.parent == source else (topic.strip().casefold(),setting.strip().casefold())
                item = groups.setdefault(key, dict(title=theme['title'], levels={}, game=game,
                                                    topic=topic, theme=setting, accent=theme.get('accent'), thumbnail=None))
                item['levels'][tier] = public(path)
                if tier == 1 or 1 not in item['levels']:
                    item.update(title=theme['title'], accent=theme.get('accent'),
                                thumbnail=theme.get('sprites', {}).get('class0_asset'))
            except (ValueError, KeyError, TypeError, OSError):
                continue
        if 'baseline' in groups:
            games.append(groups.pop('baseline'))
        games.extend(groups.values())
    return games


def operation(endpoint, data):
    game = data['game']
    if game not in ARCHETYPES:
        raise ValueError('Unknown archetype')
    for field in (('topic','theme') if endpoint=='/api/generate' else ('path','message')):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f"Missing {field}")
    client = LLMClient()
    job = data.get('job')
    def progress(message):
        if job:
            with progress_lock:
                progress_messages[job] = message
    options = dict(root=ROOT, log=ROOT/'generator/logs/generation_logs.jsonl',
                   generate_sprites=bool(data.get('sprites')), progress=progress, raise_on_failure=True)
    warning = None
    if endpoint == '/api/generate':
        args = client, game, data['topic'], data['theme']
        path = generate(*args, 1, **options)
        if data.get('pair'):
            try:
                generate(*args, 2, previous=path, **options)
            except APIError as error:
                warning = str(error)
    else:
        choices = {url:level for item in catalog() if item['game']==game for level,url in item['levels'].items()}
        selected = data['path']
        if selected in choices:
            level = choices[selected]
        else:
            # Previous turns can reference a revision superseded in the deduplicated drawer.
            candidate = (ROOT / selected.lstrip('/')).resolve()
            match = re.search(r'_L([123])\.json$', candidate.name)
            allowed = [ROOT/'generated'/game]
            if game == 'Feature-Classifier':
                allowed.append(ROOT/'generated'/'Orbit-Patrol')
            if not match or candidate.parent not in allowed or public(candidate) != selected or not candidate.is_file():
                raise ValueError('Unknown activity revision')
            level = int(match[1])
        original = json.loads((ROOT / selected[1:]).read_text())
        if original.get('archetype') == 'orbit' and game == 'Feature-Classifier':
            original['archetype'] = 'classifier'
        options['generate_sprites'] = data.get('sprites', bool(original['theme'].get('sprites')))
        if not options['generate_sprites']:
            sprites = original['theme'].get('sprites', {})
            for slot in ('class0_asset', 'class1_asset'):
                if sprites.get(slot):
                    sprites[slot] = urljoin(selected, sprites[slot])
        path = generate(client, game, "Revise activity", original["theme"]["title"], level,
                        revision=original, instruction=data['message'], **options)
    cfg = json.loads(path.read_text())
    meta = json.loads(path.with_suffix('.meta.json').read_text())
    lessons = {
        'Feature-Classifier':'Learn to distinguish a reliable feature from a misleading correlation.',
        'Alert-Dial':'Adjust the threshold to balance false alarms and missed incidents.',
        'Claim-Inspector':'Check each claim against the evidence before choosing a verdict.',
        'Neighborhood-Vote':'Predict a label from the nearest neighbors.',
        'Reward-Workshop':'Explore how reward weights change a decision.',
        'Search-Desk':'Rank results by their relevance to the query.'
    }
    theme = cfg['theme']
    labels = theme.get('options') or list(theme.get('classLabels', {}).values())
    summary = theme.get('setting', theme['title'])
    if labels:
        summary += ' You’ll work with ' + ', '.join(labels[:3]) + '.'
    summary += ' ' + lessons[game]
    return dict(ok=True, config_path=public(path), config=cfg, summary=summary,
                message=warning or meta.get('sprite_error'))


def gateway_status():
    client = LLMClient()
    headers = {'User-Agent': 'ur2phd-generator/1.0'}
    if client.key:
        headers['Authorization'] = 'Bearer ' + client.key
    try:
        with urlopen(Request(client.base+'/models', headers=headers), timeout=2) as response:
            status = response.status
    except HTTPError as error:
        status = error.code
        error.close()
    except (OSError, ValueError):
        status = None
    return dict(model=client.model, base_url=client.base, online=status is not None,
                http_status=status, auth_required=status in (401,403))


def configure_gateway(data):
    base = normalize_base(data['base_url'])
    url = urlsplit(base)
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Enter an HTTP(S) base URL without credentials, query or fragment.')
    key = data.get('api_key', '').strip()
    if any(c in key for c in '\r\n'):
        raise ValueError('Invalid key')
    old = urlsplit(LLMClient().base)
    if (url.scheme,url.netloc) != (old.scheme,old.netloc) and not key:
        os.environ.pop('LLM_API_KEY',None)
    if key:
        os.environ['LLM_API_KEY'] = key
    os.environ['LLM_BASE_URL'] = base
    return dict(ok=True, **gateway_status())


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, mime='application/json'):
        if mime=='application/json':
            body=json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(body)

    def local(self):
        return self.headers.get('Host') in ('localhost:8000','127.0.0.1:8000')

    def do_GET(self):
        if not self.local():
            return self.respond(403, {})
        route=unquote(urlsplit(self.path).path)
        if route in ('/api/status','/api/health'):
            return self.respond(200,gateway_status())
        if route.startswith('/api/progress/'):
            with progress_lock:
                message = progress_messages.get(route.split('/')[-1], 'Preparing request…')
            return self.respond(200,dict(message=message))
        if route=='/api/catalog':
            return self.respond(200,dict(items=catalog(), health=gateway_status()))
        path=(ROOT / (route.lstrip('/') or 'studio/index.html')).resolve()
        if not any(parent in path.parents for parent in [GAMES,ROOT/'studio',ROOT/'generated']):
            return self.respond(404,dict(ok=False,error="Unknown route"))
        if path.suffix not in ('.html','.js','.css','.json','.png') or not path.is_file():
            return self.respond(404,dict(ok=False,error="Unknown route"))
        self.respond(200,path.read_bytes(),mimetypes.guess_type(path.name)[0] if path.suffix!='.json' else 'application/json; charset=utf-8')

    def do_POST(self):
        if not self.local() or self.headers.get('Origin') not in (None,'http://'+self.headers['Host']):
            return self.respond(403,dict(ok=False,error="Local requests only"))
        if self.path not in ('/api/generate','/api/chat-refine','/api/settings'):
            return self.respond(404,dict(ok=False,error="Unknown route"))
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<=65536 or self.headers.get_content_type()!='application/json':
                raise ValueError('Expected a JSON request under 64 KiB')
            data=json.loads(self.rfile.read(size))
            try:
                result=configure_gateway(data) if self.path=='/api/settings' else operation(self.path,data)
            finally:
                if isinstance(data, dict) and isinstance(data.get('job'), str):
                    with progress_lock:
                        progress_messages.pop(data['job'], None)
        except APIError as error:
            return self.respond(502,dict(ok=False,error=str(error)))
        except Exception as error:
            return self.respond(400,dict(ok=False,error=str(error)))
        self.respond(200,result)


if __name__=='__main__':
    print('Arcade Studio at http://localhost:8000/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8000),Handler).serve_forever()
