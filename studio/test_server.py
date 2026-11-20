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
    client = Mock()
    client.complete.return_value = json.dumps(dict(config=cfg, regenerate_sprites=False))
    monkeypatch.setattr(server, 'ROOT', tmp_path)
    monkeypatch.setattr(server, 'catalog', lambda: [dict(game=game,levels={1:url})])
    monkeypatch.setattr(server, 'LLMClient', lambda: client)
    result = server.operation('/api/chat-refine', dict(game=game,path=url,message='Change the title'))
    assert json.loads((tmp_path / result['path'][1:]).read_text()) == cfg
    assert local.read_text() == original
