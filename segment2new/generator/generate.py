"""Generate and validate an activity. Run with --help for CLI options."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic
from uuid import uuid4

if __package__:
    from .llm_client import APIError, LLMClient, parse_config
    from .prompts import KNOBS, ORBIT, PROMPT_VERSION, build_messages
else:
    from llm_client import APIError, LLMClient, parse_config
    from prompts import KNOBS, ORBIT, PROMPT_VERSION, build_messages

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT / "segment2new"
LOG = ROOT / "generator/logs/generation_logs.jsonl"
ARCHETYPES = ("Orbit-Patrol", *KNOBS)


def validate(source, archetype, config, level):
    with TemporaryDirectory() as folder:
        candidate = Path(folder) / "candidate.json"
        candidate.write_text(json.dumps(config))
        result = subprocess.run([sys.executable, str(source / "validate.py"), str(candidate)],
                                text=True, capture_output=True)
    if result.returncode:
        return (result.stdout + result.stderr).rstrip("\n")
    if not isinstance(config, dict) or "mechanics" not in config:
        return "Expected standalone config with mechanics and theme."
    m, t = config["mechanics"], config["theme"]
    if archetype in KNOBS:
        field, counts = KNOBS[archetype]
        if len(m[field]) != counts[level-1]:
            return f"Level {level} requires {counts[level-1]} entries in mechanics.{field}."
    if archetype == "Orbit-Patrol":
        features, pool, bias, tests = ORBIT[level]
        training = m["training_pool"]
        if (len(m["features"]) != features or len(m["curveballs"]) != tests
                or not pool[0] <= training["size"] <= pool[1]
                or not bias[0] <= training["bias_strength"] <= bias[1]):
            return f"Level {level} requires feature count, pool, bias and curveballs: {ORBIT[level]}"
        roles = {f["role"]: f for f in m["features"]}
        fields = {f["name"]: f["values"] for f in m["features"]}
        if len(fields) != features or set(roles) != set(["true","spurious","noise"][:features]):
            return "Provide distinct features with the required true, spurious and optional noise roles."
        for name, values in fields.items():
            if any(key not in t["featureLabels"] for key in [name, *values]):
                return f"Missing featureLabels for {name} or its values."
        rule = m["class_rule"]
        if (rule["feature"] != roles["true"]["name"] or
                set(roles["true"]["values"]) != {rule["class_a_value"], rule["class_b_value"]}):
            return "Map both true feature values to distinct classes."
        for case in m["curveballs"]:
            item = case["item"]
            if set(item) != set(fields) or any(item[k] not in vs for k, vs in fields.items()):
                return "Each curveball must contain a declared value for every feature."
            shortcut = roles["spurious"]
            actual_a = item[rule["feature"]] == rule["class_a_value"]
            shortcut_a = item[shortcut["name"]] == shortcut["values"][0]
            if case["expected_model_failure"] != (actual_a != shortcut_a):
                return "Curveball failure annotation disagrees with the shortcut prediction."
        if len(t["options"]) != 2:
            return "Supply two class labels."
    elif archetype == "Search-Desk":
        if len(set(m["order"])) != len(m["order"]) or any(i not in range(len(t["options"])) for i in m["order"]):
            return "Ranking must contain unique, selectable option indices."
    elif archetype == "Claim-Inspector":
        if len(t["claims"]) != len(m["answers"]) or any(i not in range(len(t["options"])) for i in m["answers"]):
            return "Each claim requires a selectable answer."
    elif archetype == "Neighborhood-Vote":
        if (len(m["positions"]) != len(m["classes"]) or not 1 <= m["k"] <= len(m["classes"])
                or any(c not in t["classLabels"] for c in m["classes"])):
            return "Align positions, classes and class labels and choose a feasible k."
    elif archetype == "Reward-Workshop":
        if len(m["routes"]) != len(t["options"]) or m["goal"] not in range(len(m["routes"])):
            return "Align route labels and goal index."
        for weights in m["weights"]:
            scores = [sum(x*w for x,w in zip(route, weights)) for route in m["routes"]]
            if scores[m["goal"]] == max(scores) and scores.count(max(scores)) == 1:
                break
        else:
            return "No offered weights make the goal uniquely optimal."
    elif archetype == "Alert-Dial":
        if len(t["options"]) != 2 or m["minHits"] < 1:
            return "Provide two class labels and a positive hit target."
        for cutoff in m["cutoffs"]:
            flagged = [label for score, label in m["records"] if score >= cutoff]
            if len(flagged) >= m["minHits"] and all(flagged):
                break
        else:
            return "No offered cutoff meets the hit target without false positives."
    return None


def generate(client, archetype, topic, theme, level, *, previous=None, root=ROOT, log=LOG):
    started = monotonic()
    source = GAMES / archetype / "source"
    run_id = uuid4().hex
    timestamp = datetime.now(timezone.utc).isoformat()
    common = dict(archetype=archetype, topic=topic, theme=theme, level=level, model=client.model,
                  prompt_version=PROMPT_VERSION, timestamp=timestamp)
    messages = build_messages(source, archetype, topic, theme, level,
                              json.loads(previous.read_text()) if previous else None)
    failures = []
    output = None
    for attempt in range(1, 4):
        try:
            response = client.complete(messages)
            messages.append({"role": "assistant", "content": response})
            config = parse_config(response)
        except APIError as exc:
            category, error = "api_error", str(exc)
        except ValueError as exc:
            category, error = "json_parse_error", str(exc)
        else:
            error = validate(source, archetype, config, level)
            if error is None:
                slug = re.sub(r"[^a-z0-9]+", "-", f"{topic}-{theme}".lower()).strip("-")[:70] or "activity"
                # Keep each pair together without overwriting earlier research runs.
                stem = previous.stem.rsplit("_L", 1)[0] if previous else f"{slug}-{run_id}"
                output = root / "generated" / archetype / f"{stem}_L{level}.json"
                output.parent.mkdir(parents=True, exist_ok=True)
                meta = dict(common, schema_version="v1", attempts=attempt, run_id=run_id)
                if previous:
                    meta["source_level1_file"] = str(previous.relative_to(root))
                for path, data in [(output.with_suffix(".meta.json"), meta), (output, config)]:
                    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
                break
            category = "schema_validation_error"
        failures.append(category)
        print(f"Attempt {attempt}: {category}: {error}", file=sys.stderr)
        messages.append({"role": "user", "content": f"{category}:\n{error}\nReturn the complete corrected JSON object."})
    record = dict(common, run_id=run_id, is_regeneration=previous is not None, attempts=attempt,
                  passed=output is not None, first_pass_success=output is not None and attempt == 1,
                  failure_categories=failures, latency_ms=round((monotonic()-started)*1000))
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf8") as stream:
        stream.write(json.dumps(record) + "\n")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archetype", choices=ARCHETYPES, default="Orbit-Patrol")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--theme", required=True)
    parser.add_argument("--level", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--regenerate-level", type=int, choices=[2])
    args = parser.parse_args()
    if args.regenerate_level and args.level != 1:
        parser.error("--regenerate-level 2 requires --level 1")
    client = LLMClient()
    inputs = client, args.archetype, args.topic, args.theme
    path = generate(*inputs, args.level)
    if path:
        print(path)
        if args.regenerate_level:
            path = generate(*inputs, 2, previous=path)
            if path:
                print(path)
    return 0 if path else 1


if __name__ == "__main__":
    sys.exit(main())
