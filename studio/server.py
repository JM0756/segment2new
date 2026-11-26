"""Local Arcade Studio. Run with the generator environment's Python."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import base64
from io import BytesIO
import mimetypes
import shutil
from uuid import uuid4
from tempfile import NamedTemporaryFile, TemporaryDirectory
from PIL import Image
import os
from urllib.error import HTTPError
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit, urljoin
from urllib.request import Request, urlopen
from threading import Lock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generator.settings import load_env

from dotenv import load_dotenv

load_dotenv(dotenv_path=ROOT / '.env', override=True)
load_env(ROOT / '.env')

from generator.image_client import clean_sprite_background, scenery_items
from generator.generate import ARCHETYPES, GAMES, generate, validate
from generator.llm_client import LLMClient, APIError, normalize_base

progress_messages = {}
progress_lock = Lock()



def public(path):
    return '/' + path.relative_to(ROOT).as_posix()


def clean_cached_sprites(folder):
    """Migrate class artwork only. Scene PNGs must retain their opaque floor."""
    backgrounds = set()
    for config in folder.rglob("*.json"):
        if config.name.endswith(".meta.json"):
            continue
        try:
            theme = json.loads(config.read_text())["theme"]
            asset = theme.get("backgroundImage") or theme.get("backgroundSprite")
            if asset:
                backgrounds.add((config.parent / asset).resolve() if not asset.startswith("/")
                                else (folder.parent / asset.lstrip("/")).resolve())
        except (KeyError, ValueError, TypeError, OSError, AttributeError):
            continue
    cleaned = 0
    for path in folder.glob("**/assets/*.png"):
        if path.resolve() in backgrounds or re.search(r"(?:^|[_-])(background(?:sprite)?|scene|arena)$", path.stem, re.I):
            continue
        if path.is_symlink() or folder.resolve() not in path.resolve().parents:
            continue
        try:
            with Image.open(path) as source:
                if source.width >= 2 * source.height:
                    continue  # Horizontal animation sheets already have per-frame alignment.
                image = source.convert("RGBA")
                if not image.getpixel((0,0))[3]:
                    continue
                result = clean_sprite_background(image)
            with NamedTemporaryFile(dir=path.parent, delete=False) as temp:
                temporary = Path(temp.name)
            try:
                result.save(temporary, format="PNG")
                temporary.chmod(path.stat().st_mode)
                temporary.replace(path)
                cleaned += 1
            finally:
                temporary.unlink(missing_ok=True)
        except (OSError, ValueError, Image.DecompressionBombError) as error:
            print(f"Could not clean sprite {path.name}: {error}", file=sys.stderr)
    return cleaned


library_lock = Lock()
_sessions = {}

def draft_root():
    with library_lock:
        if ROOT not in _sessions:
            base = ROOT/'generated/.tmp'
            base.mkdir(parents=True, exist_ok=True)
            _sessions[ROOT] = TemporaryDirectory(dir=base, prefix='session-')
        return Path(_sessions[ROOT].name)

def catalog():
    with library_lock:
        return _catalog()

def _catalog(include_versions=False):
    games = []
    for game in ARCHETYPES:
        source = GAMES / game / 'source'
        if not (source / 'index.html').is_file():
            continue
        folder = ROOT / 'generated' / game
        legacy = ROOT / "generated" / "Orbit-Patrol"
        configs = [source/'default.json', source/'level2.json', source/'level3.json', *folder.glob('*.json')]
        configs.extend(path for path in folder.glob('*/*_L[123].json') if re.fullmatch('[0-9a-f]{32}',path.parent.name))
        if game == "Feature-Classifier":
            configs.extend(sorted(legacy.glob("*.json")))
        groups = {}
        configs.sort(key=lambda p: p.stat().st_mtime_ns if p.exists() else 0)
        for path in configs:
            if path.is_symlink() or not path.exists() or path.name.endswith('.meta.json'):
                continue
            try:
                cfg = json.loads(path.read_text())
                theme = cfg['theme']
                level = re.search(r'_L([123])$', path.stem)
                tier = int(level[1]) if level else ({'level2.json':2,'level3.json':3}.get(path.name,1))
                group = path.stem[:level.start()] if level else path.stem
                meta = path.with_suffix('.meta.json')
                info = json.loads(meta.read_text()) if meta.exists() else {}
                topic = info.get('topic', game)
                setting = info.get('theme', theme['title'])
                if path.parent == source:
                    key = 'baseline'
                else:
                    key = (path.parent,group)
                item = groups.setdefault(key, dict(title=theme['title'], levels={}, game=game,
                                                    topic=topic, theme=setting, accent=theme.get('accent'), thumbnail=None))
                if include_versions:
                    item.setdefault('versions', []).append(public(path))
                item['levels'][tier] = public(path)
                cover = info.get('studio_cover',False)
                if cover or not item.get('cover_selected') and (tier == 1 or 1 not in item['levels']):
                    item['cover_selected'] = cover
                    item['preview_path'] = public(path)
                    for index in (0,1):
                        field = f'class{index}Sprite'
                        asset = theme.get(field) or theme.get('sprites', {}).get(f'class{index}_asset')
                        item[field] = urljoin(public(path), asset) if asset else None
                    background = theme.get('backgroundImage') or theme.get('backgroundSprite')
                    item.update(title=theme['title'], subtitle=theme.get('subtitle'), setting=theme.get('setting'), name=theme.get('name'), accent=theme.get('accent'),
                                thumbnail=item['class0Sprite'],
                                environment=theme.get('environment'), palette=theme.get('palette'),
                                backgroundSprite=urljoin(public(path), background) if background else None)
            except (ValueError, KeyError, TypeError, OSError):
                continue
        if 'baseline' in groups:
            games.append(groups.pop('baseline'))
        games.extend(groups.values())
    return games


def artwork(config):
    theme = config['theme']
    for slot in ('class0','class1','background'):
        url = theme.get(slot+'Sprite') or theme.get('sprites', {}).get(slot+'_asset')
        if slot=='background':
            url=theme.get('backgroundImage') or url
        if url:
            yield slot, url

def image_path(config_path, url):
    location = urlsplit(urljoin(public(config_path),url))
    if location.scheme or location.netloc:
        raise ValueError('Artwork must be a local PNG.')
    path = (ROOT/unquote(location.path).lstrip('/')).resolve()
    if path.suffix.lower() != '.png' or not any(base in path.parents for base in [ROOT/'generated',GAMES]):
        raise ValueError('Invalid artwork path.')
    return path

def copy_art(config, original_path, directory, prefix=''):
    theme = config['theme']
    for slot,url in list(artwork(config)):
        relative = f'assets/{prefix}{slot}.png'
        target = directory/relative
        target.parent.mkdir(exist_ok=True)
        if url.startswith('data:image/'):
            header,encoded = url.split(',',1)
            if not header.endswith(';base64'):
                raise ValueError('Expected base64 image data.')
            with Image.open(BytesIO(base64.b64decode(encoded,validate=True))) as image:
                image.convert('RGBA').save(target,format='PNG')
        else:
            shutil.copyfile(image_path(original_path,url),target)
        theme[slot+'Sprite'] = relative
        if slot == 'background':
            theme.pop('backgroundImage',None)
        else:
            theme.setdefault('sprites', {})[slot+'_asset'] = relative

    for item in scenery_items(config):
        if item.get('sprite'):
            source = image_path(original_path,item['sprite'])
            relative = 'assets/'+prefix+source.name
            target = directory/relative
            target.parent.mkdir(exist_ok=True)
            if source!=target:
                shutil.copyfile(source,target)
            item['sprite'] = relative

def bundle_levels(folder):
    return {int(path.stem[-1]):public(path) for path in sorted(folder.glob('*_L[123].json'))}

def local_artwork(config_path):
    config = json.loads(config_path.read_text())
    assets = [url for _,url in artwork(config)]
    assets.extend(item['sprite'] for item in scenery_items(config) if item.get('sprite'))
    for asset in assets:
        try:
            yield image_path(config_path,asset)
        except ValueError:
            continue  # Inline and remote images own no local file.


def delete_saved_game(game, path, url):
    destination = ROOT/'generated'/game
    item = next((i for i in _catalog(include_versions=True) if i['game']==game and url in i['levels'].values()),None)
    if not item or public(path)!=url or ROOT/'generated' not in path.parents:
        raise ValueError('Select a saved game.')
    if path.parent.parent==destination and re.fullmatch('[0-9a-f]{32}',path.parent.name):
        shutil.rmtree(path.parent)
    else:
        # Older flat saves can share PNGs across several games.
        owned = {(ROOT/level.lstrip('/')).resolve() for level in item['versions']}
        if any(cfg.parent not in (destination,ROOT/'generated/Orbit-Patrol') for cfg in owned):
            raise ValueError('Invalid saved level path.')
        assets = {asset for cfg in owned for asset in local_artwork(cfg)}
        for cfg in (ROOT/'generated').rglob('*.json'):
            if cfg in owned or cfg.name.endswith('.meta.json'):
                continue
            try:
                assets.difference_update(local_artwork(cfg))
            except (ValueError,KeyError,TypeError,OSError):
                continue
        for cfg in owned:
            cfg.unlink()
            cfg.with_suffix('.meta.json').unlink(missing_ok=True)
        for image in assets:
            if image.parent == path.parent/'assets':
                image.unlink(missing_ok=True)
    return dict(ok=True)


def save_game(game, path, url, drafts):
    destination = ROOT/'generated'/game
    if (public(path)!=url or path.parent.parent!=drafts or not path.is_file()
            or not re.fullmatch('[0-9a-f]{32}',path.parent.name) or url not in bundle_levels(path.parent).values()):
        raise ValueError('Select a generated draft.')
    saved = destination/path.parent.name
    destination.mkdir(parents=True,exist_ok=True)
    if not saved.exists():
        with TemporaryDirectory(dir=destination,prefix='.saving-') as tmp:
            staged = Path(tmp)/'game'
            shutil.copytree(path.parent,staged)
            for url in bundle_levels(path.parent).values():
                source = ROOT/url.lstrip('/')
                config = json.loads(source.read_text())
                assets = [url for _,url in artwork(config)]
                assets.extend(item['sprite'] for item in scenery_items(config) if item.get('sprite'))
                for asset in assets:
                    image = image_path(source,asset)
                    if not image.is_relative_to(path.parent) or not image.is_file() or asset.startswith('/'):
                        raise ValueError('The draft contains unavailable artwork.')
            for metadata in staged.glob('*.meta.json'):
                info = json.loads(metadata.read_text())
                if metadata.name == path.with_suffix('.meta.json').name:
                    info['studio_cover'] = True
                for key,value in list(info.items()):
                    if re.fullmatch(r'source_level[123]_file',key):
                        info[key] = str((saved/Path(value).name).relative_to(ROOT))
                metadata.write_text(json.dumps(info,indent=2)+'\n')
            staged.rename(saved)
    return dict(ok=True,config_path=public(saved/path.name),levels=bundle_levels(saved))



def library_change(data, delete=False):
    game, url = data['game'],data['path']
    if game not in ARCHETYPES:
        raise ValueError('Unknown game')
    path = (ROOT/url.lstrip('/')).resolve()
    drafts = draft_root()/game
    with library_lock:
        if delete:
            return delete_saved_game(game,path,url)
        return save_game(game,path,url,drafts)


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
    animated = data.get('animated_sprites')
    if animated is not None and not isinstance(animated, bool):
        raise ValueError('animated_sprites must be a boolean')
    # One request-local bundle carries the model response through each tier.
    # generate normalizes each candidate before its standalone schema validator runs.
    bundle = {}
    options = dict(bundle=bundle, animated_sprites=animated, root=ROOT, log=ROOT/'generator/logs/generation_logs.jsonl',
                   generate_sprites=bool(animated or data.get('sprites')), progress=progress, raise_on_failure=True)
    directory = draft_root()/game/uuid4().hex
    directory.mkdir(parents=True)
    options['output_dir'] = directory
    level = 1
    try:
        if endpoint == '/api/generate':
            topic,setting = data['topic'],data['theme']
            path = generate(client,game,topic,setting,level,**options)
        else:
            selected = data['path']
            candidate = (ROOT/selected.lstrip('/')).resolve()
            known = [item['levels'] for item in catalog() if item['game']==game]
            levels = {url:tier for group in known for tier,url in group.items()}
            if candidate.parent.parent == draft_root()/game:
                known.append(bundle_levels(candidate.parent))
                levels.update({url:tier for tier,url in known[-1].items()})
            if public(candidate)!=selected or selected not in levels:
                raise ValueError('Unknown activity revision')
            level = levels[selected]
            group = next(group for group in known if selected in group.values())
            options['revision_levels'] = {int(n):json.loads((ROOT/url.lstrip('/')).read_text()) for n,url in group.items()}
            original = json.loads(candidate.read_text())
            if original['archetype']=='orbit' and game=='Feature-Classifier':
                original['archetype']='classifier'
            topic,setting = 'Revise activity',original['theme']['title']
            options['generate_sprites'] = bool(animated or data.get('sprites',bool(list(artwork(original)))))
            if not options['generate_sprites']:
                copy_art(original,candidate,directory)
                metadata = candidate.with_suffix('.meta.json')
                if metadata.is_file():
                    options['inherited_providers'] = json.loads(metadata.read_text()).get('asset_providers')
            path = generate(client,game,topic,setting,level,revision=original,instruction=data['message'],**options)
        # Keep character identities while generating a new arena per tier.
        warnings = []
        for tier in (1,2,3):
            if tier != level:
                sibling_options = options
                if (bundle.get('_physics_revision') and not options['generate_sprites']
                        and tier in options['revision_levels']):
                    source_path = ROOT/group[tier].lstrip('/')
                    copy_art(options['revision_levels'][tier],source_path,directory,prefix=f'L{tier}_')
                    metadata = source_path.with_suffix('.meta.json')
                    provenance = json.loads(metadata.read_text()).get('asset_providers',{}) if metadata.is_file() else {}
                    sibling_options = dict(options,inherited_providers=provenance)
                sibling = generate(client,game,topic,setting,tier,previous=path,**sibling_options)
                metadata = json.loads(sibling.with_suffix(".meta.json").read_text())
                for key in ("sprite_error", "fallback_reason"):
                    if metadata.get(key):
                        warnings.append(f"Level {tier}: {metadata[key]}")
    except Exception:
        shutil.rmtree(directory)
        raise
    cfg = json.loads(path.read_text())
    meta = json.loads(path.with_suffix('.meta.json').read_text())
    lessons = {
        'Feature-Classifier':'Learn to distinguish a reliable feature from a misleading correlation.',
        'Signal-Sorter':'Improve training data by filtering out noisy samples.',
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
                levels=bundle_levels(directory),message=' '.join(filter(None,[meta.get('fallback_reason'),meta.get('sprite_error'),*warnings])))


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
                http_status=status, auth_required=status in (401,403),
                retrodiffusion_configured=bool(os.getenv("RETRODIFFUSION_API_KEY")),
                pixellab_configured=bool(os.getenv("PIXELLAB_API_KEY", "").strip()))


def configure_gateway(data):
    base = normalize_base(data['base_url'])
    url = urlsplit(base)
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Enter an HTTP(S) base URL without credentials, query or fragment.')
    key = data.get('api_key', '').strip()
    if any(c in key for c in '\r\n'):
        raise ValueError('Invalid key')
    pixel_key = data.get('pixellab_api_key', '').strip()
    if any(c in pixel_key for c in '\r\n'):
        raise ValueError('Invalid PixelLab key')
    if pixel_key:
        os.environ['PIXELLAB_API_KEY'] = pixel_key
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
        try:
            self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):
            pass  # The browser navigated away while the previous frame was loading.

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

    def do_DELETE(self):
        if self.path != '/api/saved-game':
            return self.respond(404,dict(ok=False,error='Unknown route'))
        self.change_library_or_generate(delete=True)

    def do_POST(self):
        self.path = "/"+urlsplit(self.path).path.strip("/")
        self.change_library_or_generate()

    def change_library_or_generate(self, delete=False):
        if not self.local() or self.headers.get('Origin') not in (None,'http://'+self.headers['Host']):
            return self.respond(403,dict(ok=False,error="Local requests only"))
        if self.path not in ('/api/generate','/api/chat-refine','/api/settings','/api/save-game') and not delete:
            return self.respond(404,dict(ok=False,error="Unknown route"))
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<=65536 or self.headers.get_content_type()!='application/json':
                raise ValueError('Expected a JSON request under 64 KiB')
            data=json.loads(self.rfile.read(size))
            try:
                if delete or self.path=='/api/save-game':
                    result=library_change(data,delete)
                else:
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
    with ThreadingHTTPServer(('127.0.0.1',8000),Handler) as server:
        # The port is exclusive. Drafts from a previous Studio process can be reclaimed.
        for stale in (ROOT/'generated/.tmp').glob('session-*'):
            if stale.is_dir() and not stale.is_symlink():
                shutil.rmtree(stale)
        clean_cached_sprites(ROOT/'generated')
        print('Arcade Studio at http://localhost:8000/',flush=True)
        server.serve_forever()
