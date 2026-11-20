import json
from unittest.mock import Mock

from studio import server


def test_catalog_includes_complete_arena_levels():
    items = server.catalog()
    for game in ('Feature-Classifier','Alert-Dial','Claim-Inspector'):
        entry = next(item for item in items if item['game'] == game)
        assert set(entry['levels']) == {1, 2}
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
    client.complete.return_value = json.dumps(cfg)
    monkeypatch.setattr(server, 'ROOT', tmp_path)
    monkeypatch.setattr(server, 'catalog', lambda: [dict(game=game,levels={1:url})])
    monkeypatch.setattr(server, 'LLMClient', lambda: client)
    result = server.operation('/api/chat-refine', dict(game=game,path=url,message='Change the title'))
    assert json.loads((tmp_path / result['config_path'][1:]).read_text()) == cfg
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
    assert saved['levels'] == {1:'/generated/Claim-Inspector/new_L1.json',2:'/generated/Claim-Inspector/old_L2.json'}
