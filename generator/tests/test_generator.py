import base64
import copy
from functools import partial
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import Mock
from urllib.error import HTTPError

import pytest
from PIL import Image

from generator import generate as cli
from generator.image_client import ImageClient, ImageGenerationError
from generator.generate import ARCHETYPES, generate
from generator.llm_client import APIError, LLMClient
from generator.metrics import summarize


@pytest.fixture(autouse=True)
def isolated_image_provider(monkeypatch):
    monkeypatch.setenv("PIXELLAB_API_KEY", "")


ARCADE = Path(__file__).resolve().parents[2] / "arcade"


def default(game):
    return json.loads((ARCADE / game / "source/default.json").read_text())


def run(tmp_path, responses, game="Feature-Classifier", level=1, previous=None):
    client = Mock(model="mock-model")
    client.complete.side_effect = responses
    log = tmp_path / "runs.jsonl"
    output = generate(client, game, "Overfitting", "Fallout", level, previous=previous, root=tmp_path, log=log)
    return output, json.loads(log.read_text().splitlines()[-1]), client


@pytest.mark.parametrize("game", ARCHETYPES)
def test_first_pass(tmp_path, game):
    cfg = default(game)
    path, record, client = run(tmp_path, ["```json\n" + json.dumps(cfg) + "\n```"], game)
    prompt = json.loads(client.complete.call_args.args[0][1]["content"])
    for name in ("config_schema", "default", "levels"):
        fixture = ARCADE / game / "source" / f"{name}.json"
        assert prompt[name] == json.loads(fixture.read_text())
    assert json.loads(path.read_text()) == cfg
    assert record["passed"] and record["first_pass_success"]
    assert record["attempts"] == 1
    assert json.loads(path.with_suffix(".meta.json").read_text())["model"] == "mock-model"


def test_validator_error_is_returned_verbatim(tmp_path):
    cfg = default("Feature-Classifier")
    bad = copy.deepcopy(cfg)
    del bad["theme"]["title"]
    path, row, client = run(tmp_path, [json.dumps(bad), json.dumps(cfg)])
    repair = client.complete.call_args.args[0][-2]["content"]
    assert "schema_validation_error:\nFAIL" not in repair  # validator prints raw error lines
    assert "schema_validation_error:\n'title' is a required property\n" in repair
    assert path and row["attempts"] == 2 and not row["first_pass_success"]
    assert row["failure_categories"] == ["schema_validation_error"]


def test_retry_cap(tmp_path):
    path, row, client = run(tmp_path, ["{", APIError("offline"), "{}"])
    assert path is None and not row["passed"] and not row["first_pass_success"]
    assert row["attempts"] == client.complete.call_count == 3
    assert row["failure_categories"] == ["json_parse_error","api_error","schema_validation_error"]
    assert row["api_errors"] == [{"attempt": 2, "message": "offline"}]
    assert not (tmp_path / "generated").exists()


def test_pair(tmp_path):
    cfg = default("Search-Desk")
    first, _, _ = run(tmp_path, [json.dumps(cfg)], "Search-Desk")
    cfg["mechanics"]["order"].append(1)
    second, row, client = run(tmp_path, [json.dumps(cfg)], "Search-Desk", 2, first)
    assert row["is_regeneration"]
    assert json.loads(client.complete.call_args.args[0][1]["content"])["accepted_level_1"] == json.loads(first.read_text())
    assert json.loads(second.with_suffix(".meta.json").read_text())["source_level1_file"] == str(first.relative_to(tmp_path))


def test_metrics(tmp_path):
    rows = [dict(passed=p, first_pass_success=p and a==1, attempts=a, is_regeneration=r,
                 level=2 if r else 1, failure_categories=f)
            for p,a,r,f in [(True,1,False,[]),(True,2,True,["schema_validation_error"]),
                             (False,3,True,["json_parse_error","api_error","api_error"])]]
    expected = ["33.3%", "1.50", 2, "66.7%", "50.0%", 1, 1, 2]
    assert list(summarize(rows).values()) == expected
    path = tmp_path / "runs.jsonl"
    path.write_text("\n".join(map(json.dumps, rows)))
    table = subprocess.check_output([sys.executable, "-m", "generator.metrics", "--log", str(path)], text=True)
    for name, value in summarize(rows).items():
        assert f"| {name} | {value} |" in table


@pytest.mark.parametrize("level,size,bias,count", [(2, 8, .8, 3), (3, 12, .6, 4)])
def test_classifier_advanced_tiers(tmp_path, level, size, bias, count):
    cfg = default("Feature-Classifier")
    m = cfg["mechanics"]
    m["features"].append({"name":"size", "values":["small","large"], "role":"noise"})
    cfg["theme"]["featureLabels"].update(size="Badge", small="Brass", large="Silver")
    m["training_pool"].update(size=size, bias_strength=bias)
    template = m["curveballs"][0]
    m["curveballs"] = [dict(template,id=str(i),item=dict(template["item"],size="small")) for i in range(count)]
    path, row, _ = run(tmp_path, [json.dumps(cfg)], level=level)
    assert path and row["passed"]

@pytest.mark.parametrize("base", [None, "http://localhost:3001", "http://localhost:3001/",
                                  "http://localhost:3001/v1", "http://localhost:3001/v1///"])
def test_gateway_request(monkeypatch, base):
    if base is None:
        monkeypatch.delenv("LLM_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("LLM_BASE_URL", base)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    response = BytesIO(b'{"choices":[{"message":{"content":"ok"}}]}')
    send = Mock(return_value=response)
    monkeypatch.setattr("generator.llm_client.urlopen", send)
    assert LLMClient().complete([]) == "ok"
    request = send.call_args.args[0]
    assert request.full_url == "http://localhost:3001/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer test-key"
    assert request.get_header("User-agent") == "ur2phd-generator/1.0"
    assert json.loads(request.data)["model"] == "auto"


def test_gateway_error_body(monkeypatch):
    error = HTTPError("http://localhost:3001/v1/chat/completions", 502, "Bad Gateway",
                      {}, BytesIO(b"  provider unavailable\xff  "))
    monkeypatch.setattr("generator.llm_client.urlopen", Mock(side_effect=error))
    with pytest.raises(APIError, match="HTTP 502.*provider unavailable�$"):
        LLMClient().complete([])

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZQAAAABJRU5ErkJggg==")


def image_response(item):
    return BytesIO(json.dumps({"data": [item]}).encode())


@pytest.mark.parametrize("via_url", [False, True])
def test_image_endpoint(tmp_path, monkeypatch, via_url):
    if via_url:
        monkeypatch.delenv("PIXELLAB_API_KEY", raising=False)
    for name in ("IMAGE_BASE_URL", "IMAGE_API_KEY", "IMAGE_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:3001/")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    url = "https://images.example/icon.png"
    responses = ([image_response({"url": url}), BytesIO(PNG)] if via_url else
                 [image_response({"b64_json": base64.b64encode(PNG).decode()})])
    send = Mock(side_effect=responses)
    monkeypatch.setattr("generator.image_client.urlopen", send)
    asset = ImageClient().generate("friendly alien", tmp_path, "test", "class0")
    assert asset == "assets/test_class0.png"
    assert Image.open(tmp_path / asset).format == "PNG"
    request = send.call_args_list[0].args[0]
    assert request.full_url == "http://localhost:3001/v1/images/generations"
    assert request.get_header("Authorization") == "Bearer test-key"
    assert request.get_header("User-agent") == "ur2phd-generator/1.0"
    assert json.loads(request.data) == dict(model="auto", prompt="friendly alien", size="512x512",
                                            n=1, response_format="b64_json")
    if via_url:
        assert send.call_args.args[0] == url


@pytest.mark.parametrize("failure", [False, True])
def test_sprite_cli_pair(tmp_path, monkeypatch, failure, capsys):
    cfg = default("Search-Desk")
    cfg["theme"]["sprites"] = {"class0_prompt": "calendar", "class1_prompt": "gallery"}
    first = json.dumps(cfg)
    cfg["mechanics"]["order"].append(1)
    text = Mock(model="test", complete=Mock(side_effect=[first, json.dumps(cfg)]))
    monkeypatch.setattr(cli, "LLMClient", lambda: text)
    ok = {"b64_json": base64.b64encode(PNG).decode()}
    error = HTTPError("http://localhost:3001", 500, "Unavailable", {}, BytesIO(b"provider busy"))
    responses = [image_response(ok), error] if failure else [image_response(ok) for _ in range(3)]
    send = Mock(side_effect=responses)
    monkeypatch.setattr("generator.image_client.urlopen", send)
    log = tmp_path / "runs.jsonl"
    monkeypatch.setattr(cli, "generate", partial(generate, root=tmp_path, log=log))
    args = ["generate", "--archetype", "Search-Desk", "--theme", "library", "--topic", "search",
            "--generate-sprites"]
    monkeypatch.setattr(sys, "argv", args if failure else args + ["--regenerate-level", "2"])
    assert cli.main() == 0
    directory = tmp_path / "generated/Search-Desk"
    first_path, = directory.glob("*_L1.json")
    theme = json.loads(first_path.read_text())["theme"]
    assert send.call_count == (2 if failure else 3)
    assert "class0_prompt" in str(json.loads(text.complete.call_args.args[0][1]["content"])["constraints"])
    if failure:
        assert "sprites" not in theme
        assert not list(directory.glob("assets/*.png"))
        assert "provider busy" in capsys.readouterr().err
        for path in [first_path.with_suffix(".meta.json"), log]:
            assert "provider busy" in json.loads(path.read_text())["sprite_error"]
    else:
        second_path, = directory.glob("*_L2.json")
        second_theme = json.loads(second_path.read_text())["theme"]
        assert theme["sprites"] == second_theme["sprites"]
        assert theme["backgroundSprite"] == second_theme["backgroundSprite"]
        assert Image.open(directory/theme["backgroundSprite"]).size == (320, 180)
        assert theme["environment"]["setting_name"] in json.loads(send.call_args.args[0].data)["prompt"]
        for slot in ("class0_asset", "class1_asset"):
            assert Image.open(directory / theme["sprites"][slot]).mode == "RGBA"


def test_malformed_image_response(tmp_path, monkeypatch):
    monkeypatch.setattr("generator.image_client.urlopen", Mock(return_value=image_response({"b64_json": "%"})))
    with pytest.raises(ImageGenerationError):
        ImageClient().generate("entity", tmp_path, "test", "class0")

@pytest.mark.parametrize("image_format", ["JPEG", "WEBP"])
def test_image_conversion_after_retry(tmp_path, monkeypatch, image_format):
    buffer = BytesIO()
    Image.new("RGB", (4, 3), "red").save(buffer, format=image_format)
    busy = HTTPError("http://localhost", 503, "Unavailable", {}, BytesIO(b"busy"))
    response = image_response({"b64_json": base64.b64encode(buffer.getvalue()).decode()})
    send = Mock(side_effect=[busy, response])
    pause = Mock()
    monkeypatch.setattr("generator.image_client.urlopen", send)
    monkeypatch.setattr("generator.image_client.sleep", pause)
    asset = ImageClient().generate("entity", tmp_path, "retry", "class0")
    pause.assert_called_once_with(10)
    assert send.call_count == 2
    with Image.open(tmp_path / asset) as image:
        assert (image.format, image.mode, image.size) == ("PNG", "RGBA", (128, 128))

def test_cutout_keys_enclosed_gradient_and_keeps_character_colors():
    from generator.image_client import cutout
    image = Image.new("RGBA", (20, 20), "#ececec")
    image.paste("white", (0, 0, 10, 20))
    image.paste("#cc2277", (5, 5, 15, 15))
    image.paste("#f5f5f5", (8, 8, 12, 12))
    result = cutout(image)
    assert result.size == (128, 128)
    assert result.getpixel((0, 0))[3] == 0
    assert result.getchannel("A").getbbox() == (18, 24, 110, 116)
    assert result.getpixel((64, 70))[3] == 0
    assert result.getpixel((30, 35))[:3] == (204, 34, 119)
    assert any(0 < alpha < 255 for _, alpha in result.getchannel("A").getcolors())


def test_character_prompt_perspective():
    from generator.prompts import build_messages
    messages = build_messages(ARCADE/"Alert-Dial/source", "Alert-Dial", "Risk", "Market", 1, None, True)
    rules = json.loads(messages[1]["content"])["constraints"]
    assert any("standardized blocky base template" in rule and
               "square pixel head with two dark pixel eyes" in rule and
               "no floor, no shadow, no frame, no text" in rule for rule in rules)


@pytest.mark.parametrize("recover", [True, False])
def test_chat_refine_post_repairs_setting(tmp_path, monkeypatch, recover):
    from email.message import Message
    from studio import server
    game = "Claim-Inspector"
    path = "/arcade/Claim-Inspector/source/default.json"
    cfg = default(game)
    local = tmp_path/path[1:]
    local.parent.mkdir(parents=True)
    local.write_text(json.dumps(cfg))
    cfg["theme"]["setting"] = "Compare the speakeasy ledger with the witness account."
    client = Mock(model="test")
    client.complete.side_effect = ["{}", "```json\n"+json.dumps(cfg)+"\n```"] if recover else ["{}"]*3
    if recover:
        client.complete.side_effect = ["{}", json.dumps(cfg), *[(ARCADE/game/f"source/level{tier}.json").read_text() for tier in (2,3)]]
    monkeypatch.setattr(server, "ROOT", tmp_path)
    monkeypatch.setattr(server, "catalog", lambda: [dict(game=game, levels={1:path})])
    monkeypatch.setattr(server, "LLMClient", lambda: client)
    body = json.dumps(dict(game=game,path=path,message="Use a 1920s speakeasy")).encode()
    handler = object.__new__(server.Handler)
    handler.path = "/api/chat-refine"
    handler.headers = Message()
    for k,v in {"Content-Type":"application/json","Content-Length":str(len(body)),"Host":"localhost:8000"}.items():
        handler.headers[k] = v
    handler.rfile = BytesIO(body)
    handler.respond = Mock()
    handler.do_POST()
    status, result = handler.respond.call_args.args
    assert result["ok"] is recover
    messages = client.complete.call_args_list[0].args[0]
    assert any("'mechanics' is a required property" in m["content"] for m in messages)
    if recover:
        assert status == 200 and result["config"] == cfg
        assert json.loads((tmp_path/result["config_path"][1:]).read_text()) == cfg
    else:
        assert status == 502 and "3 attempts" in result["error"]
        assert client.complete.call_count == 3


def test_dynamic_feature_names(tmp_path):
    text = json.dumps(default("Feature-Classifier")).replace('"core"', '"wavelength"')
    cfg = json.loads(text)
    path, _, _ = run(tmp_path, [text])
    assert path
    del cfg["theme"]["featureLabels"]["wavelength"]
    assert "Missing display label" in cli.validate(ARCADE / "Feature-Classifier/source",
                                                   "Feature-Classifier", cfg, 1)

def test_station_tutorial_validates():
    game = "Feature-Classifier"
    cfg = default(game)
    assert cfg["theme"]["title"] == "Orbital Station: Core Hull Signal vs. Surface Static"
    assert cli.validate(ARCADE/game/"source", game, cfg, 1) is None


def test_dotenv_and_gateway_auth(tmp_path, monkeypatch):
    from studio import server
    from urllib.error import URLError
    monkeypatch.setenv("LLM_MODEL", "from-shell")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    env = tmp_path/".env"
    env.write_text('LLM_MODEL=auto\nLLM_BASE_URL=http://localhost:3001/\nexport LLM_API_KEY="test key"\n')
    server.load_env(env)
    probe = Mock(side_effect=HTTPError("test",401,"Unauthorized",{},BytesIO()))
    monkeypatch.setattr(server,"urlopen",probe)
    health = server.gateway_status()
    assert health["online"] and health["auth_required"] and health["model"] == "from-shell"
    req = probe.call_args.args[0]
    assert req.full_url == "http://localhost:3001/v1/models"
    assert req.get_header("Authorization") == "Bearer test key"
    monkeypatch.delenv("LLM_API_KEY")
    probe.side_effect = None
    from contextlib import nullcontext
    probe.return_value = nullcontext(Mock(status=200))
    assert server.gateway_status()["online"]
    assert not probe.call_args.args[0].has_header("Authorization")
    probe.side_effect = URLError("offline")
    assert not server.gateway_status()["online"]


def test_cutout_starts_at_every_border():
    from generator.image_client import cutout
    # A foreground rail splits the near-background field into disconnected regions.
    image = Image.new("RGBA", (16,16), (185,185,185,255))
    image.paste("#335577",(4,0,6,16))
    image.paste("#335577",(10,0,12,16))
    image.paste((210,200,205,255),(6,0,10,16))
    result = cutout(image)
    assert result.getpixel((64,70))[3] == 0
    assert result.getchannel("A").getbbox() == (41,24,87,116)

@pytest.mark.parametrize("slot", ["class0", "class1", "backgroundSprite"])
def test_pixflux_routes_native_art(tmp_path, monkeypatch, slot):
    monkeypatch.setenv("PIXELLAB_API_KEY", "pixel-test")
    monkeypatch.setenv("PIXELLAB_BASE_URL", "https://pixflux.example/v1/")
    monkeypatch.setenv("IMAGE_API_KEY", "separate-gateway-key")
    scene = slot == "backgroundSprite"
    expected = (320,180) if scene else (128,128)
    art = Image.new("RGBA", expected, "white" if scene else (0,0,0,0))
    art.paste("white", (32,24,96,116))
    buffer = BytesIO()
    art.save(buffer,format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode()
    send = Mock(return_value=BytesIO(json.dumps({"image":{"type":"base64","base64":"data:image/png;base64,"+encoded}}).encode()))
    monkeypatch.setattr("generator.image_client.urlopen",send)
    asset = ImageClient().generate("crew",tmp_path,"orbital",slot)
    request = send.call_args.args[0]
    payload = json.loads(request.data)
    assert request.full_url == "https://pixflux.example/v1/generate-image-pixflux"
    assert request.get_header("Authorization") == "Bearer pixel-test"
    assert payload["no_background"] is (not scene)
    assert payload["image_size"] == dict(width=expected[0],height=expected[1])
    with Image.open(tmp_path/asset) as saved:
        assert saved.size == expected
        if not scene:
            assert "blocky 2.5D chibi" in payload["description"]
            assert saved.getpixel((64,64)) == (255,255,255,255)
            assert saved.getpixel((0,0))[3] == 0


def test_llm_cannot_supply_unowned_background_path(tmp_path):
    cfg = default("Feature-Classifier")
    cfg["theme"]["backgroundSprite"] = "assets/invented.png"
    del cfg["theme"]["environment"]
    corrected = default("Feature-Classifier")
    corrected["theme"]["backgroundSprite"] = "assets/invented.png"
    path,row,_ = run(tmp_path,[json.dumps(cfg),json.dumps(corrected)])
    assert row["attempts"] == 2
    theme = json.loads(path.read_text())["theme"]
    assert "backgroundSprite" not in theme and theme["environment"]["preset"] == "space-station"


def test_background_failure_retains_characters_and_procedural_scene(tmp_path, monkeypatch):
    config = default("Alert-Dial")
    config["theme"]["sprites"] = dict(class0_prompt="crew", class1_prompt="android")
    client = Mock()
    client.generate.side_effect = ["assets/a.png", "assets/b.png", ImageGenerationError("busy")]
    monkeypatch.setattr(cli, "ImageClient", lambda: client)
    warning = cli.attach_sprites(config, None, ARCADE/"Alert-Dial/source", "Alert-Dial", 1, tmp_path, "test")
    assert "busy" in warning
    assert config["theme"]["sprites"]["class1_asset"] == "assets/b.png"
    assert config["theme"]["environment"]["floor_style"] == "asphalt"
    assert "backgroundSprite" not in config["theme"]


@pytest.mark.parametrize("background", ["#080808", "#f4f4f4"])
def test_cleanup_keys_dominant_border_and_enclosed_neutral_pocket(background):
    from generator.image_client import clean_sprite_background
    image = Image.new("RGBA", (24, 24), background)
    image.putpixel((0, 0), (20, 110, 40, 255))  # The corner alone is a poor color key.
    image.paste("#da3249", (4, 4, 20, 20))
    image.paste(background, (8, 8, 16, 16))
    result = clean_sprite_background(image)
    assert result.size == (128, 128)
    assert result.getpixel((0, 0))[3] == result.getpixel((73, 80))[3] == 0
    r, g, b, alpha = result.getpixel((90, 102))
    assert (r, g, b) == (218, 50, 73) and alpha >= 250


@pytest.mark.parametrize("game", ["Alert-Dial", "Claim-Inspector"])
def test_generate_class_sprites_for_arena_games(tmp_path, monkeypatch, game):
    text = Mock(model="mock")
    text.complete.return_value = json.dumps(default(game))
    images = Mock()
    images.generate.side_effect = lambda _, directory, stem, slot: f"assets/{slot}.png"
    monkeypatch.setattr(cli, "ImageClient", lambda: images)
    path = generate(text, game, "Activity", "Archive", 1, root=tmp_path, log=tmp_path/"log",
                    generate_sprites=True)
    theme = json.loads(path.read_text())["theme"]
    assert [call.args[-1] for call in images.generate.call_args_list] == ["class0","class1","backgroundSprite"]
    for i in range(2):
        assert theme[f"class{i}Sprite"] == theme["sprites"][f"class{i}_asset"] == f"assets/class{i}.png"
        assert theme["options"][i] in images.generate.call_args_list[i].args[0]


def test_generator_repairs_missing_and_unknown_layouts(tmp_path):
    correct = default("Feature-Classifier")
    old = copy.deepcopy(correct)
    del old["theme"]["environment"]["layout"]
    assert cli.validate(ARCADE/"Feature-Classifier/source", "Feature-Classifier", old, 1) is None
    invalid = copy.deepcopy(correct)
    invalid["theme"]["environment"]["layout"] = "invalid"
    path, record, _ = run(tmp_path, map(json.dumps, [old, invalid, correct]))
    assert path and record["attempts"] == 3
    assert json.loads(path.read_text()) == correct


def test_signal_sorter_rejects_ambiguous_wave_and_wrong_tier_size():
    game = "Signal-Sorter"
    source = ARCADE/game/"source"
    for tier,name in enumerate(("default","level2","level3"),1):
        config = json.loads((source/(name+".json")).read_text())
        assert cli.validate(source,game,config,tier) is None
    config["mechanics"]["samples"] = [0]*9
    assert "clean and noisy" in cli.validate(source,game,config,3)
    config["mechanics"]["samples"] = [1,0,1]
    assert "9 entries" in cli.validate(source,game,config,3)
