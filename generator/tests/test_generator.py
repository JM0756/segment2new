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
def isolated_image_provider(monkeypatch,tmp_path):
    monkeypatch.setattr("generator.image_client._exhausted_retro_keys", set())
    monkeypatch.setattr("generator.image_client.REPO_ROOT",tmp_path/"test-settings")
    monkeypatch.delenv("ENABLE_ANIMATED_SPRITES", raising=False)
    monkeypatch.setenv("RETRODIFFUSION_API_KEY", "")
    monkeypatch.setenv("IMAGE_PROVIDER", "auto")
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
    cfg["theme"]["environment"]["layout"]="forest-edge"
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
    response = Mock(status_code=200)
    response.json.return_value = {"choices":[{"message":{"content":"ok"}}]}
    send = Mock(return_value=response)
    monkeypatch.setattr("generator.llm_client.requests.post", send)
    assert LLMClient().complete([]) == "ok"
    assert send.call_args.args[0] == "http://localhost:3001/v1/chat/completions"
    args = send.call_args.kwargs
    assert args["timeout"] == (10.0, 90.0)
    assert args["headers"]["Authorization"] == "Bearer test-key"
    assert args["headers"]["User-Agent"] == "ur2phd-generator/1.0"
    assert args["json"]["model"] == "auto" and args["json"]["max_tokens"] == 1400


@pytest.mark.parametrize("status", [502, 503])
def test_gateway_error_body(monkeypatch, status):
    send = Mock(return_value=Mock(status_code=status,reason="busy",content=b" provider unavailable "))
    monkeypatch.setattr("generator.llm_client.requests.post", send)
    pause = Mock()
    monkeypatch.setattr("generator.llm_client.sleep", pause)
    with pytest.raises(APIError, match=f"HTTP {status}.*provider unavailable$"):
        LLMClient().complete([])
    assert send.call_count == 2
    pause.assert_called_once_with(1.5)


@pytest.mark.parametrize("game", ARCHETYPES)
def test_bundle_timeout_still_builds_three_valid_tiers(tmp_path, monkeypatch, game):
    from requests.exceptions import ReadTimeout
    send = Mock(side_effect=ReadTimeout("The read operation timed out"))
    monkeypatch.setattr("generator.llm_client.requests.post", send)
    monkeypatch.setattr("generator.llm_client.sleep", Mock())
    opts = dict(bundle={}, root=tmp_path, log=tmp_path/"log", raise_on_failure=True)
    client = LLMClient()
    first = generate(client,game,"Science","Forest",1,**opts)
    paths = [first] + [generate(client,game,"Science","Forest",n,previous=first,**opts) for n in (2,3)]
    assert send.call_count == 2
    assert len({json.loads(p.read_text())["theme"]["environment"]["layout"] for p in paths}) == 3


def test_partial_bundle_uses_one_completion(tmp_path):
    client = Mock(model="test")
    client.complete.return_value = '{"level1":{"theme":{"title":"Forest detective"}},"level2":{"theme":{"title":"Forest echoes","hint":"Read the echoes"}},"level3":'
    opts = dict(bundle={}, root=tmp_path, log=tmp_path/"log", raise_on_failure=True)
    args = client,"Feature-Classifier","Science","Forest"
    first = generate(*args,1,**opts)
    for n in (2,3):
        path = generate(*args,n,previous=first,**opts)
        if n == 2:
            theme = json.loads(path.read_text())["theme"]
            assert theme["title"] == "Forest detective" and theme["hint"] == "Read the echoes"
    assert json.loads(first.read_text())["theme"]["title"] == "Forest detective"
    client.complete.assert_called_once()


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
    assert json.loads(request.data) == dict(model="@cf/black-forest-labs/flux-1-schnell", prompt="16-bit top-down RPG pixel art, crisp pixel grid, flat shading, no anti-aliasing. friendly alien", size="512x512",
                                            n=1, response_format="b64_json")
    if via_url:
        assert send.call_args.args[0] == url


@pytest.mark.parametrize("failure", [False, True])
def test_sprite_cli_pair(tmp_path, monkeypatch, failure, capsys):
    cfg = default("Search-Desk")
    cfg["theme"]["sprites"] = {"class0_prompt": "calendar", "class1_prompt": "gallery"}
    first = json.dumps(cfg)
    cfg["theme"]["environment"]["layout"]="forest-edge"
    cfg["mechanics"]["order"].append(1)
    text = Mock(model="test", complete=Mock(side_effect=[first, json.dumps(cfg)]))
    monkeypatch.setattr(cli, "LLMClient", lambda: text)
    ok = {"b64_json": base64.b64encode(PNG).decode()}
    error = HTTPError("http://localhost:3001", 500, "Unavailable", {}, BytesIO(b"provider busy"))
    responses = [image_response(ok), error, image_response(ok)] if failure else [image_response(ok) for _ in range(4)]
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
    assert send.call_count == (3 if failure else 4)
    assert "class0_prompt" in str(json.loads(text.complete.call_args.args[0][1]["content"])["constraints"])
    if failure:
        assert "class0Sprite" in theme and "class1Sprite" not in theme
        assert (directory/theme["backgroundSprite"]).is_file()
        assert "provider busy" in capsys.readouterr().err
        for path in [first_path.with_suffix(".meta.json"), log]:
            assert "provider busy" in json.loads(path.read_text())["sprite_error"]
    else:
        second_path, = directory.glob("*_L2.json")
        second_theme = json.loads(second_path.read_text())["theme"]
        assert theme["sprites"] == second_theme["sprites"]
        assert theme["backgroundSprite"] != second_theme["backgroundSprite"]
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
    handler.path = "api/chat-refine" if recover else "/api/chat-refine"
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


@pytest.mark.parametrize("game", ARCHETYPES)
def test_world_defaults_and_shipped_maps(tmp_path, game):
    source = ARCADE / game / "source"
    for level in (1, 2, 3):
        cfg = cli.tier_default(source, level)
        assert cli.geometry_error(cfg["world_physics"]) is None
        assert cli.validate(source, game, cfg, level) is None
    cfg = default(game)
    del cfg["world_physics"]
    client = Mock(model="test")
    client.complete.return_value = json.dumps(cfg)
    path = generate(client, game, "Classification", "Snowy mountain", 1, root=tmp_path, log=tmp_path/"log")
    world = json.loads(path.read_text())["world_physics"]
    assert world == cli.default_world(cfg,1,"Snowy mountain")
    assert world["surface"]["type"] == "snow"
    assert world["surface"]["trailStyle"] == "footprints"


@pytest.mark.parametrize("patch,reason", [
    ({"x":.04, "w":.19}, "fit inside"),
    ({"x":.24, "y":.48}, "walking clearance"),
    ({"x":.5, "y":.36, "w":.035, "h":.035}, "lane clear"),
    ({"kind":"statue"}, "statue"),
])
def test_invalid_world_footprints(patch, reason):
    cfg = default("Feature-Classifier")
    cfg["world_physics"]["obstacles"][0].update(patch)
    assert reason in cli.validate(ARCADE/"Feature-Classifier/source","Feature-Classifier",cfg,1)


@pytest.mark.parametrize("echo_full_config", [True, False])
def test_chat_refine_applies_world_edits_to_existing_tiers(tmp_path, monkeypatch, echo_full_config):
    from studio import server
    game = "Claim-Inspector"
    group, originals = {}, {}
    for n in (1,2,3):
        original = cli.tier_default(ARCADE/game/"source",n)
        original["theme"]["title"] = f"Corral {n}"
        original["mechanics"]["answers"].reverse()
        group[n] = f"/generated/{game}/saved_L{n}.json"
        path = tmp_path/group[n][1:]
        path.parent.mkdir(parents=True,exist_ok=True)
        path.with_suffix(".png").write_bytes(PNG)
        original["theme"]["backgroundImage"] = path.with_suffix(".png").name
        path.write_text(json.dumps(original))
        originals[n] = original
    pillars = [dict(o,kind="pillar") for o in originals[2]["world_physics"]["obstacles"]]
    patch = {"surface":{"type":"snow"}, "obstacles":pillars,
             "structures":{k:{"style":"wooden corral"} for k in ("leftTarget","rightTarget")}}
    client = Mock(model="test")
    anchor = {"world_physics":patch}
    if echo_full_config:
        anchor = cli.merge(originals[2],anchor)
    client.complete.return_value = json.dumps({"level2":anchor,
                                               "level3":{"world_physics":{"surface":{"speedMultiplier":1.28}}}})
    monkeypatch.setattr(server,"ROOT",tmp_path)
    monkeypatch.setattr(server,"catalog",lambda:[dict(game=game,levels=group)])
    monkeypatch.setattr(server,"LLMClient",lambda:client)
    response = server.operation("/api/chat-refine", dict(game=game,path=group[2], sprites=False,
                                message="Give all tiers slippery ice, stone pillars and wooden corral gates"))
    for n, url in response["levels"].items():
        path = tmp_path/url.lstrip("/")
        cfg = json.loads(path.read_text())
        world = cfg["world_physics"]
        assert world["surface"]["type"] == "snow" and world["surface"]["drag"] == .98
        assert world["surface"]["speedMultiplier"] == (1.28 if n==3 else 1.16)
        assert world["obstacles"] == pillars
        assert all(world["structures"][side]["style"]=="wooden corral" for side in ("leftTarget","rightTarget"))
        assert cfg["mechanics"] == originals[n]["mechanics"]
        assert cfg["theme"]["title"] == originals[n]["theme"]["title"]
        assert (path.parent/cfg["theme"]["backgroundSprite"]).read_bytes() == PNG
    client.complete.assert_called_once()


def test_classifier_custom_names_values_and_narration_on_every_tier(tmp_path):
    client = Mock(model="test")
    identity = {"title":"Orchard inspection", "class0":{"name":"Apple"},
                "class1":{"name":"Pear"}, "trueFeature":{"name":"Stem","values":["Forked","Single"]},
                "spuriousFeatures":[{"name":"Crate paint","values":["Ochre","Indigo"]}]}
    client.complete.return_value = json.dumps({"level1":{"theme":identity},
                                               "level2":cli.tier_default(ARCADE/"Feature-Classifier/source",2)})
    opts = dict(bundle={},root=tmp_path,log=tmp_path/"log",raise_on_failure=True)
    args = client,"Feature-Classifier","Classification","Orchard"
    first = generate(*args,1,**opts)
    for n in (1,2,3):
        path = first if n==1 else generate(*args,n,previous=first,**opts)
        theme = json.loads(path.read_text())["theme"]
        assert all(theme[k]==v for k,v in identity.items())
        assert theme["options"] == ["Apple","Pear"]
        assert set(("Forked","Single","Stem","Ochre","Indigo","Crate paint")) <= set(theme["featureLabels"].values())
        text = json.dumps(theme).lower()
        assert all(stock not in text for stock in ("crew","android","circular seal","serrated seal","hull seal"))
        assert all(word in theme["hint"] for word in ("Forked","Single","Apple","Pear","Crate paint"))
    client.complete.assert_called_once()


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
    client = Mock(provider_errors=[],providers={})
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
    images = Mock(provider_errors=[],providers={})
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


@pytest.mark.parametrize("game", ARCHETYPES)
def test_three_architectural_layouts(game):
    source = ARCADE/game/"source"
    environments = [json.loads((source/name).read_text())["theme"]["environment"]
                    for name in ("default.json","level2.json","level3.json")]
    assert len({e["layout"] for e in environments}) == 3
    assert len({e["setting_name"] for e in environments}) == 3


def test_slow_images_leave_playable_config(tmp_path, monkeypatch):
    monkeypatch.setattr("generator.image_client.urlopen", Mock(side_effect=TimeoutError("provider timed out")))
    text = Mock(model="mock")
    text.complete.return_value=json.dumps(default("Feature-Classifier"))
    path=generate(text,"Feature-Classifier","Labels","Forest",1,root=tmp_path,log=tmp_path/"log",generate_sprites=True)
    theme=json.loads(path.read_text())["theme"]
    assert "sprites" not in theme and theme["environment"]["layout"]
    assert "provider timed out" in json.loads(path.with_suffix(".meta.json").read_text())["sprite_error"]


@pytest.mark.parametrize("format",["image","data","url"])
def test_pixflux_payload_formats_and_timeout(tmp_path,monkeypatch,format):
    encoded=base64.b64encode(PNG).decode()
    payload={"image":{"base64":encoded}} if format=="image" else {"data":[{"b64_json":encoded}]}
    if format=="url":
        payload={"url":"https://images.example/scene.png"}
    send=Mock(side_effect=[BytesIO(json.dumps(payload).encode()),BytesIO(PNG)])
    monkeypatch.setenv("PIXELLAB_API_KEY","test")
    monkeypatch.setattr("generator.image_client.urlopen",send)
    asset=ImageClient().generate("A forest",tmp_path,"tier3","backgroundSprite")
    assert Image.open(tmp_path/asset).size==(320,180)
    assert all(call.kwargs["timeout"]==30 for call in send.call_args_list)


def test_classifier_cue_names_follow_roles_across_tiers():
    original=default("Feature-Classifier")
    config=json.loads((ARCADE/"Feature-Classifier/source/level2.json").read_text())
    feature=next(f for f in config["mechanics"]["features"] if f["role"]=="spurious")
    feature["name"]="color"
    feature["values"]=["blue","yellow"]
    config["theme"]["featureLabels"]={}
    cli.inherit_classifier_labels(config,original)
    labels=config["theme"]["featureLabels"]
    assert [labels[k] for k in ("color","blue","yellow")]==["Surface static","Quiet radio","Loud static"]


def test_third_tier_inherits_noise_labels_introduced_in_second_tier(tmp_path):
    source = ARCADE / "Feature-Classifier/source"
    first, _, _ = run(tmp_path, [(source / "default.json").read_text()])
    second = json.loads((source / "level2.json").read_text())
    noise = next(f for f in second["mechanics"]["features"] if f["role"] == "noise")
    second["theme"]["featureLabels"][noise["name"]] = "Forest echo"
    run(tmp_path, [json.dumps(second)], level=2, previous=first)
    response = json.loads((source / "level3.json").read_text())
    del response["theme"]["featureLabels"]
    for case in response["mechanics"]["curveballs"]:
        case["expected_model_failure"] = not case["expected_model_failure"]
    third, record, _ = run(tmp_path, [json.dumps(response)], level=3, previous=first)
    assert record["first_pass_success"]
    config = json.loads(third.read_text())
    noise = next(f for f in config["mechanics"]["features"] if f["role"] == "noise")
    assert config["theme"]["featureLabels"][noise["name"]] == "Forest echo"


def animation_frame(color):
    buffer = BytesIO()
    Image.new("RGBA", (64, 64), color).save(buffer, format="PNG")
    return {"type": "base64", "base64": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()}


@pytest.mark.parametrize("enable_via_env", [True, False])
def test_animation_sheet_and_static_fallback(tmp_path, monkeypatch, enable_via_env):
    monkeypatch.setenv("PIXELLAB_API_KEY", "test-key")
    monkeypatch.setenv("ENABLE_ANIMATED_SPRITES", str(enable_via_env).lower())
    text = Mock(model="mock")
    text.complete.return_value = json.dumps(default("Feature-Classifier"))
    colors = [(n, 40, 70, 255) for n in (10, 20, 30, 40)]
    frames = [animation_frame(color) for color in colors]
    def static():
        return BytesIO(json.dumps({"image": {"base64": base64.b64encode(PNG).decode()}}).encode())
    send = Mock(side_effect=[static(), BytesIO(json.dumps({"images": frames}).encode()), static(),
                             TimeoutError("animation timed out"), static()])
    monkeypatch.setattr("generator.image_client.urlopen", send)
    output = generate(text, "Feature-Classifier", "Training", "Forest", 1, root=tmp_path, log=tmp_path/"log",
                      generate_sprites=enable_via_env, animated_sprites=None if enable_via_env else True)
    requests = [call for call in send.call_args_list if call.args[0].full_url.endswith("/animate-with-text")]
    assert len(requests) == 2
    for call in requests:
        request = call.args[0]
        assert call.kwargs["timeout"] == 20
        assert request.get_header("Authorization") == "Bearer test-key"
        payload = json.loads(request.data)
        assert payload["n_frames"] == 4 and payload["image_size"] == {"width": 64, "height": 64}
        with Image.open(BytesIO(base64.b64decode(payload["reference_image"]["base64"]))) as reference:
            assert reference.size == (64, 64)
    theme = json.loads(output.read_text())["theme"]
    assert theme["class0Sprite"] == theme["sprites"]["class0_asset"]
    assert theme["class0Sprite"].endswith("_class0_anim.png")
    with Image.open(output.parent/theme["class0Sprite"]) as sheet:
        assert sheet.size == (512, 128)
        assert [sheet.getpixel((i*128, 0)) for i in range(4)] == colors
    assert theme["class1Sprite"].endswith("_class1.png")
    with Image.open(output.parent/theme["class1Sprite"]) as static_image:
        assert static_image.size == (128, 128)
    assert "animation timed out" in json.loads(output.with_suffix(".meta.json").read_text())["sprite_error"]


def test_incomplete_animation_keeps_static_reference(tmp_path, monkeypatch):
    path = tmp_path/"class0.png"
    path.write_bytes(PNG)
    monkeypatch.setenv("PIXELLAB_API_KEY", "test")
    send = Mock(return_value=BytesIO(b'{"images":[]}'))
    monkeypatch.setattr("generator.image_client.urlopen", send)
    with pytest.raises(ImageGenerationError, match="four frames"):
        ImageClient().animate(tmp_path, path.name, "Character")
    assert path.read_bytes() == PNG and not (tmp_path/"class0_anim.png").exists()


@pytest.mark.parametrize("slot,size,style", [
    ("class0", (128,128), "rd_fast__game_asset"),
    ("backgroundSprite", (384,216), "rd_plus__environment"),
])
@pytest.mark.parametrize("field", ["base64_images", "images", "data"])
def test_retro_first_and_png_dimensions(tmp_path, monkeypatch, slot, size, style, field):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY", "retro-test")
    monkeypatch.setenv("PIXELLAB_API_KEY", "pixel-test")
    encoded = base64.b64encode(PNG).decode()
    item = {"b64_json":encoded} if field == "data" else encoded
    send = Mock(return_value=BytesIO(json.dumps({field:[item]}).encode()))
    monkeypatch.setattr("generator.image_client.urlopen", send)
    client = ImageClient()
    asset = client.generate("Forest scout",tmp_path,"forest",slot)
    send.assert_called_once()
    request = send.call_args.args[0]
    assert request.full_url == "https://api.retrodiffusion.ai/v1/inferences"
    assert request.get_header("X-rd-token") == "retro-test"
    assert request.get_header("Authorization") is None
    payload = json.loads(request.data)
    assert (payload["width"],payload["height"]) == size
    assert payload["prompt_style"] == style and payload["num_images"] == 1
    assert "remove_bg" not in payload
    with Image.open(tmp_path/asset) as image:
        assert image.format == "PNG" and image.size == size
    assert client.providers[slot] == "retrodiffusion"


@pytest.mark.parametrize("failure", [402,429,"timeout","malformed"])
def test_retro_failure_falls_through_to_pixellab(tmp_path, monkeypatch, failure, caplog):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY","retro-test")
    monkeypatch.setenv("PIXELLAB_API_KEY","pixel-test")
    if isinstance(failure,int):
        failed = HTTPError("retro",failure,"busy",{},BytesIO(b"unavailable"))
    else:
        failed = TimeoutError("timeout") if failure=="timeout" else BytesIO(b'{"images":[]}')
    encoded=base64.b64encode(PNG).decode()
    send=Mock(side_effect=[failed,BytesIO(json.dumps({"image":{"base64":encoded}}).encode())])
    monkeypatch.setattr("generator.image_client.urlopen",send)
    client=ImageClient()
    assert client.generate("scout",tmp_path,"run","class1").endswith("_class1.png")
    retry=send.call_args.args[0]
    assert retry.full_url.endswith("/generate-image-pixflux") and retry.get_header("X-rd-token") is None
    assert client.providers["class1"]=="pixellab" and "retrodiffusion" in caplog.text
    if isinstance(failure,int):
        assert f"[image_client] retrodiffusion failed (status={failure})" in caplog.text
        assert "unavailable -> falling back to pixellab" in caplog.text


@pytest.mark.parametrize("gateway_fails", [False,True])
def test_all_assets_follow_waterfall_and_log_sources(tmp_path,monkeypatch,gateway_fails):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY","retro-test")
    monkeypatch.setenv("PIXELLAB_API_KEY","pixel-test")
    monkeypatch.setenv("IMAGE_API_KEY","image-test")
    def respond(request,timeout):
        if request.full_url.endswith("/images/generations") and not gateway_fails:
            assert request.get_header("Authorization")=="Bearer image-test"
            assert request.get_header("X-rd-token") is None
            return image_response({"b64_json":base64.b64encode(PNG).decode()})
        raise HTTPError(request.full_url,402,"no credits",{},BytesIO(b""))
    send=Mock(side_effect=respond)
    monkeypatch.setattr("generator.image_client.urlopen",send)
    text=Mock(model="test")
    text.complete.return_value=json.dumps(default("Feature-Classifier"))
    path=generate(text,"Feature-Classifier","Features","Forest",1,root=tmp_path,log=tmp_path/"log",generate_sprites=True)
    assert send.call_count==7 and path.is_file()
    expected=dict.fromkeys(("class0","class1","backgroundSprite"),"procedural" if gateway_fails else "cloudflare")
    for file in (path.with_suffix(".meta.json"),tmp_path/"log"):
        assert json.loads(file.read_text())["asset_providers"]==expected
    theme=json.loads(path.read_text())["theme"]
    assert bool(theme.get("class0Sprite")) is not gateway_fails
    assert bool(theme.get("backgroundSprite")) is not gateway_fails


def test_theme_identity_survives_template_and_missing_final_tier(tmp_path):
    client=Mock(model="test")
    identity={"title":"Moon Garden","subtitle":"Read the lunar blooms"}
    client.complete.return_value=json.dumps({"level1":{"theme":identity},
        "level2":{"theme":{"title":"Orbital Station","subtitle":"Hull integrity"}}})
    opts=dict(root=tmp_path,log=tmp_path/"log",bundle={},raise_on_failure=True)
    args=client,"Feature-Classifier","Classification","Forest"
    first=generate(*args,1,**opts)
    for tier in (2,3):
        path=generate(*args,tier,previous=first,**opts)
        theme=json.loads(path.read_text())["theme"]
        assert all(theme[key]==value for key,value in identity.items())
    client.complete.assert_called_once()


def test_explicit_cloudflare_skips_paid_providers_and_reuses_character_provenance(tmp_path,monkeypatch):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY","retro")
    monkeypatch.setenv("PIXELLAB_API_KEY","pixel")
    monkeypatch.setenv("IMAGE_PROVIDER","cloudflare")
    send=Mock(side_effect=lambda *_args,**_kwargs:image_response({"b64_json":base64.b64encode(PNG).decode()}))
    monkeypatch.setattr("generator.image_client.urlopen",send)
    text=Mock(model="test")
    text.complete.return_value=json.dumps({"level1":{"theme":{"title":"Orchard"}}})
    args=text,"Feature-Classifier","Features","Orchard"
    opts=dict(bundle={},root=tmp_path,log=tmp_path/"log",generate_sprites=True,raise_on_failure=True)
    first=generate(*args,1,**opts)
    paths=[first]+[generate(*args,tier,previous=first,**opts) for tier in (2,3)]
    assert send.call_count==5
    assert all(call.args[0].full_url.endswith("/images/generations") for call in send.call_args_list)
    for path in paths:
        providers=json.loads(path.with_suffix(".meta.json").read_text())["asset_providers"]
        assert providers==dict.fromkeys(("class0","class1","backgroundSprite"),"cloudflare")
    themes=[json.loads(path.read_text())["theme"] for path in paths]
    assert len({theme["class0Sprite"] for theme in themes})==1
    assert len({theme["backgroundSprite"] for theme in themes})==3


@pytest.mark.parametrize("status", [402, 400])
def test_retro_balance_failure_skips_to_pixellab_across_clients(tmp_path, monkeypatch, caplog, status):
    from generator import image_client
    (tmp_path/".env").write_text("RETRODIFFUSION_API_KEY=file-key\nIMAGE_PROVIDER=retrodiffusion\n")
    monkeypatch.setattr(image_client, "REPO_ROOT", tmp_path)
    monkeypatch.setenv("PIXELLAB_API_KEY", "pixel-test")
    calls = []
    def respond(request, timeout):
        calls.append(request.full_url)
        if "retrodiffusion.ai" in request.full_url:
            assert request.get_header("X-rd-token") == "file-key"
            raise HTTPError(request.full_url, status, "No credits", {}, BytesIO(b'{"code":"insufficient_balance"}'))
        return BytesIO(json.dumps({"image": {"base64": base64.b64encode(PNG).decode()}}).encode())
    monkeypatch.setattr(image_client, "urlopen", respond)
    for slot in ("class0", "class1", "backgroundSprite"):
        client = ImageClient()
        client.generate("Lawn", tmp_path, "game", slot)
        assert client.providers[slot] == "pixellab"
    assert sum("retrodiffusion.ai" in url for url in calls) == 1
    assert len(calls) == 4
    assert f"retrodiffusion failed (status={status})" in caplog.text


def test_unreachable_model_map_replaced_with_connected_tier(tmp_path):
    from generator.tilemap import valid_tilemap
    game="Feature-Classifier"
    for level in (1,2,3):
        cfg=cli.tier_default(ARCADE/game/"source",level)
        grid=cfg["tilemap"]
        assert valid_tilemap(grid,level)
        cfg["tilemap"]=[row[:12]+"#"+row[13:] for row in grid]
        assert not valid_tilemap(cfg["tilemap"],level)
        path,record,_=run(tmp_path,[json.dumps(cfg)],level=level)
        assert record["first_pass_success"]
        assert valid_tilemap(json.loads(path.read_text())["tilemap"],level)


@pytest.mark.parametrize("embedded", [False,True])
def test_missing_cue_labels_are_normalized_before_first_validation(tmp_path,embedded):
    cfg = default("Feature-Classifier")
    cfg = json.loads(json.dumps(cfg).replace('"green"', '"crimson_mist"'))
    cfg["theme"]["featureLabels"] = {"spiky":"Cut crystal"}
    aura = next(f for f in cfg["mechanics"]["features"] if f["name"]=="aura")
    if embedded:
        aura.update(display_label="Mist hue",value_labels={"crimson_mist":"Ember cloud"})
    path, record, client = run(tmp_path,[json.dumps(cfg)])
    assert record["first_pass_success"] and client.complete.call_count==1
    accepted = json.loads(path.read_text())
    labels = accepted["theme"]["featureLabels"]
    assert labels["core"]=="Core" and labels["spiky"]=="Cut crystal"
    assert labels["aura"]==("Mist hue" if embedded else "Aura")
    assert labels["crimson_mist"]==("Ember cloud" if embedded else "Crimson mist")


def test_generated_props_are_small_and_outside_class_paths(tmp_path):
    cfg=default("Feature-Classifier")
    cfg["world_physics"]["obstacles"]=[
        dict(id=str(i),kind="crate",x=x,y=y,w=.06,h=.08)
        for i,(x,y) in enumerate([(.38,.48),(.68,.72),(.13,.82),(.88,.81)])]
    path,record,_=run(tmp_path,[json.dumps(cfg)])
    accepted=json.loads(path.read_text())
    assert record["first_pass_success"]
    props=accepted["world_physics"]["obstacles"]
    assert len(props)==2 and sum(row.count("#") for row in accepted["tilemap"])==2
    for prop in props:
        assert prop["x"]<.2 or prop["x"]>=.8
        assert accepted["tilemap"][int(prop["y"]*12)][int(prop["x"]*20)]=="#"


@pytest.mark.parametrize("game", ARCHETYPES)
def test_missing_required_ui_and_archetype_pass_first_attempt(tmp_path,game):
    cfg=default(game)
    kind=cfg.pop("archetype")
    cfg["theme"]["title"]="Moon garden"
    for key in cli.UI_KEYS:
        del cfg["theme"][key]
    cfg["ui"]={"labels":{"begin":"Enter garden","success":"Bloom recorded"}}
    cfg["theme"]["copy"]={"guide":"Garden guide"}
    cfg["check"]="Check specimen"
    path,record,client=run(tmp_path,[json.dumps(cfg)],game)
    result=json.loads(path.read_text())
    assert record["first_pass_success"] and client.complete.call_count==1
    assert result["archetype"]==kind
    theme=result["theme"]
    assert all(theme[k].strip() for k in cli.UI_KEYS)
    assert "Moon garden" in theme["practice"]
    assert [theme[k] for k in ("begin","success","guide","check")]==["Enter garden","Bloom recorded","Garden guide","Check specimen"]


def test_bundle_copy_is_shared_and_level_copy_wins(tmp_path):
    client=Mock(model="test")
    client.complete.return_value=json.dumps({"archetype":"Alert-Dial","strings":{"skip":"Skip walk","begin":"Start walk"},
        "level1":{"theme":{"title":"Night watch","begin":"Start shift"}}, "level2":{"controls":{"guide":"Watch guide"}}})
    options=dict(root=tmp_path,log=tmp_path/"log",bundle={},raise_on_failure=True)
    args=client,"Alert-Dial","Alerts","Noir"
    first=generate(*args,1,**options)
    second=generate(*args,2,previous=first,**options)
    a,b=[json.loads(p.read_text())["theme"] for p in (first,second)]
    assert a["skip"]==b["skip"]=="Skip walk"
    assert a["begin"]=="Start shift" and b["begin"]=="Start walk" and b["guide"]=="Watch guide"
    client.complete.assert_called_once()


def test_all_required_ui_defaults_without_any_copy_container(tmp_path):
    cfg=default("Feature-Classifier")
    del cfg["archetype"]
    for key in cli.UI_KEYS:
        del cfg["theme"][key]
    path,record,client=run(tmp_path,[json.dumps(cfg)])
    result=json.loads(path.read_text())
    assert result["archetype"]=="classifier"
    assert all(result["theme"][key].strip() for key in cli.UI_KEYS)
    assert record["first_pass_success"] and client.complete.call_count==1


@pytest.mark.parametrize("attempt", [1, 2, 3])
def test_generate_post_normalizes_wrapped_replies_before_validation(tmp_path, monkeypatch, attempt):
    from email.message import Message
    from studio import server

    game = "Feature-Classifier"
    source = ARCADE/game/"source"
    levels = [cli.tier_default(source, tier) for tier in (1, 2, 3)]
    for level in levels:
        del level["archetype"]
        for key in cli.UI_KEYS:
            del level["theme"][key]
    levels[1]["controls"] = {"labels": {"begin": "Start the second survey"}}
    response = {"game": {"ui": {"theme": {"guide": "Wildlife guide"}}, "levels": levels}}
    client = Mock(model="test")
    client.complete.side_effect = ["{}"]*(attempt-1) + [json.dumps(response)]
    monkeypatch.setattr(server, "ROOT", tmp_path)
    monkeypatch.setattr(server, "LLMClient", lambda: client)
    body = json.dumps({"game": game, "topic": "Wildlife", "theme": "Wildlife reserve"}).encode()
    handler = object.__new__(server.Handler)
    handler.path = "/api/generate"
    handler.headers = Message()
    handler.headers["Host"] = "localhost:8000"
    handler.headers["Content-Type"] = "application/json"
    handler.headers["Content-Length"] = str(len(body))
    handler.rfile = BytesIO(body)
    handler.respond = Mock()
    handler.do_POST()
    status, result = handler.respond.call_args.args
    assert status == 200, result
    assert client.complete.call_count == attempt
    for tier, url in result["levels"].items():
        path = tmp_path/url.lstrip("/")
        config = json.loads(path.read_text())
        assert config["archetype"] == "classifier"
        assert all(config["theme"][key].strip() for key in cli.UI_KEYS)
        assert config["theme"]["guide"] == "Wildlife guide"
        if tier == 2:
            assert config["theme"]["begin"] == "Start the second survey"
        metadata = json.loads(path.with_suffix(".meta.json").read_text())
        assert metadata["attempts"] == (attempt if tier == 1 else 1)


@pytest.mark.parametrize("suffix", [" · reactor-core", " space-station architecture"])
def test_custom_background_prompt_omits_space_layout_suffixes(tmp_path, monkeypatch, suffix):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY", "test")
    send = Mock(side_effect=lambda req, timeout: BytesIO(json.dumps(
        {"base64_images": [base64.b64encode(PNG).decode()]}).encode()))
    monkeypatch.setattr("generator.image_client.urlopen", send)
    game = "Feature-Classifier"
    cfg = cli.tier_default(ARCADE/game/"source", 2)
    cfg["theme"]["environment"]["setting_name"] = "Wildlife reserve" + suffix
    cli.attach_sprites(cfg, None, ARCADE/game/"source", game, 2, tmp_path, "wildlife")
    prompt = json.loads(send.call_args.args[0].data)["prompt"]
    assert "Wildlife reserve" in prompt
    assert not any(text in prompt for text in ("space-station", "reactor-core", "reactor core"))


def test_retro_logs_complete_json_error_with_http_status(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("RETRODIFFUSION_API_KEY", "test")
    monkeypatch.setenv("IMAGE_PROVIDER", "retrodiffusion")
    message = "Details " + "a"*510 + " final constraint"
    error = HTTPError("retro", 422, "Invalid input", {}, BytesIO(json.dumps({"message":message}).encode()))
    monkeypatch.setattr("generator.image_client.urlopen", Mock(side_effect=error))
    client = ImageClient()
    with pytest.raises(ImageGenerationError, match="HTTP 422"):
        client.generate("Wildlife", tmp_path, "test", "backgroundSprite")
    assert "status=422" in caplog.text and message in caplog.text
    assert client.provider_errors[0]["status"] == 422

@pytest.mark.parametrize("revision", [True, False])
def test_lawn_traits_drive_gameplay_labels_and_distinct_art_across_tiers(tmp_path, revision):
    request = ("Garden Plants: Leafy green stems and Glowing sun-core. Lawn Zombies: Tattered suits. "
               "Distractors: Terracotta flowerpot, Yellow sun-orb, Metal watering can.")
    client = Mock(model="test")
    client.complete.return_value = json.dumps({"level1":{"theme":{"title":"Lawn Defense",
        "options":["Garden Plants","Lawn Zombies"]}}})
    opts = dict(root=tmp_path, log=tmp_path/"log", bundle={}, raise_on_failure=True)
    first = None
    for tier in (1,2,3):
        revision_args = dict(revision=default("Feature-Classifier"), instruction=request) if revision and not first else {}
        path = generate(client, "Feature-Classifier", "Visual cues", "Station" if revision else request,
                        tier, previous=first, **revision_args, **opts)
        first = first or path
        cfg = json.loads(path.read_text())
        labels = cfg["theme"]["featureLabels"]
        assert [labels[k] for k in ("round","spiky","green","red")] == [
            "Leafy green stems and Glowing sun-core","Tattered suits","Terracotta flowerpot","Yellow sun-orb"]
        if tier > 1:
            assert labels["fast"] == "Metal watering can" and "beacon" not in labels["slow"].lower()
        prompts = [cli.character_prompt(cfg, i, "Garden Plants versus Lawn Zombies") for i in range(2)]
        assert "zombie" not in prompts[0].lower() and "plant" not in prompts[1].lower()
        assert labels["round"] in prompts[0] and labels["spiky"] in prompts[1]
