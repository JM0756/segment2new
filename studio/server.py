"""Local Arcade Studio. Run with the generator environment's Python."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generator.generate import ARCHETYPES, GAMES, attach_sprites, generate, validate
from generator.llm_client import LLMClient, parse_config
from generator.prompts import build_messages


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
        for path in configs:
            if not path.exists() or path.name.endswith('.meta.json'):
                continue
            try:
                cfg = json.loads(path.read_text())
                theme = cfg['theme']
                level = re.search(r'_L([123])$', path.stem)
                tier = int(level[1]) if level else (2 if path.name == 'level2.json' else 1)
                group = path.stem[:level.start()] if level else path.stem
                key = 'baseline' if path.parent == source else group
                item = groups.setdefault(key, dict(title=theme['title'], levels={}, game=game,
                                                    thumbnail=theme.get('sprites', {}).get('class0_asset')))
                item['levels'][tier] = public(path)
            except (ValueError, KeyError, TypeError, OSError):
                continue
        games.extend(groups.values())
    return games


def operation(endpoint, data):
    game = data['game']
    if game not in ARCHETYPES:
        raise ValueError('Unknown archetype')
    source = GAMES / game / 'source'
    client = LLMClient()
    if endpoint == '/api/generate':
        args = client, game, data['topic'], data['theme']
        first = generate(*args, 1, generate_sprites=bool(data.get('sprites')))
        if not first:
            raise ValueError('Level 1 generation failed validation or the gateway request failed. See generator logs.')
        if data.get('pair') and not generate(*args, 2, previous=first, generate_sprites=bool(data.get('sprites'))):
            return dict(path=public(first), message='Level 1 saved. Level 2 generation failed.')
        return dict(path=public(first))
    choices = {url:level for item in catalog() if item['game']==game for level,url in item['levels'].items()}
    selected = data['path']
    level = choices[selected]
    original = json.loads((ROOT / selected[1:]).read_text())
    if original.get('archetype') == 'orbit' and game == 'Feature-Classifier':
        original['archetype'] = 'classifier'
    messages = build_messages(source, game, 'Revise current activity', original['theme']['title'], level, None, True)
    messages.append(dict(role='user', content=json.dumps(dict(current=original, request=data['message']))))
    messages.append(dict(role='system', content='Return JSON with config (the complete revised activity) and regenerate_sprites (boolean, true when new art is requested). Preserve unrelated mechanics and terminology.'))
    reply = parse_config(client.complete(messages))
    cfg = reply['config']
    error = validate(source, game, cfg, level)
    if error:
        raise ValueError(error)
    stem = 'remix-' + uuid4().hex
    directory = ROOT / 'generated' / game
    directory.mkdir(parents=True, exist_ok=True)
    if reply.get('regenerate_sprites') is True:
        attach_sprites(cfg, None, source, game, level, directory, stem)
    else:
        cfg['theme'].pop('sprites', None)
        if 'sprites' in original['theme']:
            sprites = original['theme']['sprites'].copy()
            for key in ('class0_asset','class1_asset'):
                if sprites.get(key,'').startswith('assets/') and (ROOT / selected[1:]).parent != directory:
                    sprites[key] = public((ROOT / selected[1:]).parent / sprites[key])
            cfg['theme']['sprites'] = sprites
    path = directory / f'{stem}_L{level}.json'
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)+'\n')
    return dict(path=public(path))


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
        if route=='/api/catalog':
            return self.respond(200,catalog())
        path=(ROOT / (route.lstrip('/') or 'studio/index.html')).resolve()
        if not any(parent in path.parents for parent in [GAMES,ROOT/'studio',ROOT/'generated']):
            return self.respond(404,{})
        if path.suffix not in ('.html','.js','.css','.json','.png') or not path.is_file():
            return self.respond(404,{})
        self.respond(200,path.read_bytes(),mimetypes.guess_type(path.name)[0] if path.suffix!='.json' else 'application/json; charset=utf-8')

    def do_POST(self):
        if not self.local() or self.headers.get('Origin') not in (None,'http://'+self.headers['Host']):
            return self.respond(403,{})
        if self.path not in ('/api/generate','/api/chat-refine'):
            return self.respond(404,{})
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<=65536 or self.headers.get_content_type()!='application/json':
                raise ValueError('Expected a JSON request under 64 KiB')
            result=operation(self.path,json.loads(self.rfile.read(size)))
        except Exception as error:
            return self.respond(400,dict(error=str(error)))
        self.respond(200,result)


if __name__=='__main__':
    print('Arcade Studio at http://localhost:8000/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8000),Handler).serve_forever()
