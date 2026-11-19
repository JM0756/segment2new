import copy
import json
import subprocess
import sys
from unittest.mock import Mock

import pytest

from generator.generate import ARCHETYPES, GAMES, generate
from generator.llm_client import APIError
from generator.metrics import summarize


def default(game):
    return json.loads((GAMES / game / "source/default.json").read_text())


def run(tmp_path, responses, game="Orbit-Patrol", level=1, previous=None):
    client = Mock(model="mock-model")
    client.complete.side_effect = responses
    log = tmp_path / "runs.jsonl"
    output = generate(client, game, "Overfitting", "Fallout", level, previous=previous, root=tmp_path, log=log)
    return output, json.loads(log.read_text().splitlines()[-1]), client


@pytest.mark.parametrize("game", ARCHETYPES)
def test_first_pass(tmp_path, game):
    cfg = default(game)
    path, record, _ = run(tmp_path, ["```json\n" + json.dumps(cfg) + "\n```"], game)
    assert json.loads(path.read_text()) == cfg
    assert record["passed"] and record["first_pass_success"]
    assert record["attempts"] == 1
    assert json.loads(path.with_suffix(".meta.json").read_text())["model"] == "mock-model"


def test_validator_error_is_returned_verbatim(tmp_path):
    cfg = default("Orbit-Patrol")
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
def test_orbit_advanced_tiers(tmp_path, level, size, bias, count):
    cfg = default("Orbit-Patrol")
    m = cfg["mechanics"]
    m["features"].append({"name":"size", "values":["small","large"], "role":"noise"})
    cfg["theme"]["featureLabels"].update(size="Badge", small="Brass", large="Silver")
    m["training_pool"].update(size=size, bias_strength=bias)
    template = m["curveballs"][0]
    m["curveballs"] = [dict(template,id=str(i),item=dict(template["item"],size="small")) for i in range(count)]
    path, row, _ = run(tmp_path, [json.dumps(cfg)], level=level)
    assert path and row["passed"]
