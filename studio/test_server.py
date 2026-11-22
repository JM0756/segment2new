import json
from unittest.mock import Mock

import pytest

from studio import server


def test_catalog_includes_complete_arena_levels():
    items = server.catalog()
    for game in server.ARCHETYPES:
        entry = next(item for item in items if item['game'] == game)
        assert set(entry['levels']) == {1, 2, 3}
        for level, url in entry['levels'].items():
            cfg = json.loads((server.ROOT / url[1:]).read_text())
            assert server.validate(server.GAMES / game / 'source', game, cfg, level) is None


def test_remix_creates_valid_new_revision(tmp_path, monkeypatch):
    game = 'Claim-Inspector'
    url = '/arcade/Claim-Inspector/source/default.json'
    original = (server.ROOT / url[1:]).read_text()
    local = tmp_path / url[1:]
    local.parent.mkdir(parents=True)
    local.write_text(original)
    cfg = json.loads(original)
    cfg['theme']['title'] = 'Studio revision'
    client = Mock(model="test")
    client.complete.side_effect = [json.dumps(cfg), *[(server.GAMES/game/f"source/level{n}.json").read_text() for n in (2,3)]]
    monkeypatch.setattr(server, 'ROOT', tmp_path)
    monkeypatch.setattr(server, 'catalog', lambda: [dict(game=game,levels={1:url})])
    monkeypatch.setattr(server, 'LLMClient', lambda: client)
    result = server.operation('/api/chat-refine', dict(game=game,path=url,message='Change the title'))
    assert json.loads((tmp_path / result['config_path'][1:]).read_text()) == cfg
    assert result['config_path'].startswith('/generated/.tmp/') and set(result['levels'])=={1,2,3}
    assert not (tmp_path/'generated'/game).exists()
    assert local.read_text() == original
    assert cfg['theme']['setting'] in result['summary']
    assert cfg['theme']['options'][0] in result['summary']
    assert 'evidence' in result['summary']


def test_catalog_deduplicates_latest_saved_topic_theme_level(tmp_path, monkeypatch):
    game = 'Claim-Inspector'
    source = tmp_path/'arcade'/game/'source'
    source.mkdir(parents=True)
    cfg = json.loads((server.GAMES/game/'source/default.json').read_text())
    (source/'default.json').write_text(json.dumps(cfg))
    cfg['theme']['backgroundSprite'] = 'assets/arena.png'
    (source/'index.html').touch()
    directory = tmp_path/'generated'/game
    directory.mkdir(parents=True)
    import os
    for run, level, stamp in [('old',1,1),('new',1,3),('old',2,2)]:
        path = directory/f'{run}_L{level}.json'
        path.write_text(json.dumps(cfg))
        os.utime(path,(stamp,stamp))
        path.with_suffix('.meta.json').write_text(json.dumps({'topic':'Evidence','theme':'Space Station'}))
    monkeypatch.setattr(server,'ROOT',tmp_path)
    monkeypatch.setattr(server,'GAMES',tmp_path/'arcade')
    baseline,saved = server.catalog()
    assert baseline['levels'][1].endswith('/default.json')
    assert saved['backgroundSprite'] == '/generated/Claim-Inspector/assets/arena.png'
    assert saved['environment'] == cfg['theme']['environment']
    assert saved['levels'] == {1:'/generated/Claim-Inspector/new_L1.json',2:'/generated/Claim-Inspector/old_L2.json'}

def test_pixel_settings_session_and_dotenv(monkeypatch,tmp_path):
    monkeypatch.delenv("PIXELLAB_API_KEY",raising=False)
    monkeypatch.setenv("LLM_BASE_URL","http://localhost:3001/v1")
    monkeypatch.setattr(server,"urlopen",Mock(side_effect=OSError("offline")))
    assert server.gateway_status()["pixellab_configured"] is False
    env=tmp_path/".env"
    env.write_text("PIXELLAB_API_KEY=from-file\n")
    server.load_env(env)
    status=server.gateway_status()
    assert status["pixellab_configured"] and "from-file" not in json.dumps(status)
    status=server.configure_gateway(dict(base_url="http://localhost:3001",pixellab_api_key="new-secret"))
    assert server.os.environ["PIXELLAB_API_KEY"] == "new-secret"
    assert "new-secret" not in json.dumps(status)


def test_startup_cleanup_migrates_opaque_characters_once_and_preserves_scenes(tmp_path):
    from PIL import Image
    folder = tmp_path/"generated"
    assets = folder/"Orbit-Patrol/assets"
    assets.mkdir(parents=True)
    image = Image.new("RGB", (20, 20), "#080808")
    image.paste("#488060", (5, 5, 15, 15))
    hero, scene = assets/"run_class0.png", assets/"street.png"
    image.save(hero)
    image.save(scene)
    (assets.parent/"level.json").write_text(json.dumps({"theme":{"backgroundSprite":"assets/street.png"}}))
    sheet=assets/'hero_anim.png'
    Image.new('RGBA',(512,128),'white').save(sheet)
    original_sheet=sheet.read_bytes()
    original = scene.read_bytes()
    assert server.clean_cached_sprites(folder) == 1
    with Image.open(hero) as saved:
        assert saved.mode == "RGBA" and saved.size == (128, 128)
        assert saved.getpixel((0, 0))[3] == 0 and saved.getpixel((64, 64))[3] == 255
    assert sheet.read_bytes()==original_sheet
    stamp = hero.stat().st_mtime_ns
    assert server.clean_cached_sprites(folder) == 0
    assert hero.stat().st_mtime_ns == stamp and scene.read_bytes() == original


@pytest.mark.parametrize("animated", [False, True])
def test_save_and_delete_draft_with_all_three_art_assets(tmp_path,monkeypatch,animated):
    from email.message import Message
    from io import BytesIO
    from PIL import Image
    from generator import generate as generator
    game = 'Signal-Sorter'
    monkeypatch.setattr(server,'ROOT',tmp_path)
    client = Mock(model='test')
    client.complete.side_effect = [(server.GAMES/game/'source'/name).read_text()
                                  for name in ('default.json','level2.json','level3.json')]
    monkeypatch.setattr(server,'LLMClient',lambda:client)
    def draw(prompt,directory,stem,slot):
        relative = f'assets/{slot}.png'
        (directory/'assets').mkdir(exist_ok=True)
        Image.new('RGBA',(128,128),'green').save(directory/relative)
        return relative
    def animate(directory,asset,description):
        path=(directory/asset).with_stem((directory/asset).stem+'_anim')
        Image.new('RGBA',(512,128),'green').save(path)
        return path.relative_to(directory).as_posix()
    image_client=Mock(pixel_key='test',providers={},generate=draw,animate=Mock(side_effect=animate))
    monkeypatch.setattr(generator,'ImageClient',lambda:image_client)
    def request(endpoint,data,method='POST'):
        handler = object.__new__(server.Handler)
        handler.path = endpoint
        body = json.dumps(data).encode()
        handler.rfile = BytesIO(body)
        handler.headers = Message()
        for key,value in {'Content-Type':'application/json','Content-Length':str(len(body)),'Host':'localhost:8000'}.items():
            handler.headers[key] = value
        handler.respond = Mock()
        getattr(handler,'do_'+method)()
        return handler.respond.call_args.args

    status,draft = request('api/generate',dict(game=game,topic='Samples',theme='Space lab',sprites=not animated,animated_sprites=animated))
    assert image_client.animate.call_count==(2 if animated else 0)
    assert status==200 and set(draft['levels'])=={1,2,3}
    assert all(url.startswith('/generated/.tmp/') for url in draft['levels'].values())
    assert not (tmp_path/'generated'/game).exists()
    # Each saved game owns its assets and saving the same draft twice is idempotent.
    data = dict(game=game,path=draft['config_path'])
    status,saved = request('/api/save-game',data)
    assert status==200 and request('/api/save-game',data)[1]==saved
    directory=(tmp_path/saved['config_path'][1:]).parent
    for path in saved['levels'].values():
        cfg=json.loads((tmp_path/path[1:]).read_text())
        for _,art in server.artwork(cfg):
            assert (directory/art).read_bytes()==((tmp_path/data['path'][1:]).parent/art).read_bytes()
    item=next(i for i in server.catalog() if saved['config_path'] in i['levels'].values())
    expected_asset='/assets/class1_anim.png' if animated else '/assets/class1.png'
    assert item['class1Sprite'].endswith(expected_asset) and '/.tmp/' not in item['backgroundSprite']
    assert request('/api/saved-game',data,'DELETE')[0]==400
    status,_=request('/api/saved-game',dict(game=game,path=saved['config_path']),'DELETE')
    assert status==200 and not directory.exists()
    assert (tmp_path/data['path'][1:]).is_file()


def test_import_loads_repository_env_before_client_configuration(tmp_path, monkeypatch):
    import os
    import shutil
    import subprocess
    import sys

    studio = tmp_path/'project/studio'
    studio.mkdir(parents=True)
    shutil.copy(server.__file__, studio/'server.py')
    (studio.parent/'.env').write_text(
        ' export LLM_BASE_URL = "http://localhost:4321/v1"\n'
        "LLM_API_KEY='  test key #1  '\nLLM_MODEL = auto\n"
        'IMAGE_MODEL = test-image\nPIXELLAB_API_KEY=pixel-test\n'
    )
    for key in ('LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','IMAGE_MODEL','PIXELLAB_API_KEY'):
        monkeypatch.delenv(key, raising=False)
    script = """
import runpy, sys
module = runpy.run_path(sys.argv[1])
from generator.image_client import ImageClient
llm = module['LLMClient']()
assert (llm.base,llm.key,llm.model)==('http://localhost:4321/v1','test key #1','auto')
assert (ImageClient().model,ImageClient().pixel_key)==('test-image','pixel-test')
"""
    subprocess.run([sys.executable,'-c',script,str(studio/'server.py')], cwd=tmp_path,
                   env=dict(os.environ, PYTHONPATH=str(server.ROOT)), check=True)
