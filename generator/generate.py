"""Generate and validate an activity. Run with --help for CLI options."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import copy
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic
from uuid import uuid4

if __package__:
    from .settings import load_env
    from .image_client import ImageClient, ImageGenerationError
    from .llm_client import APIError, GatewayTimeout, LLMClient, parse_config
    from .prompts import KNOBS, CLASSIFIER, PROMPT_VERSION, SPRITE_STYLE, build_messages
else:
    from settings import load_env
    from image_client import ImageClient, ImageGenerationError
    from llm_client import APIError, GatewayTimeout, LLMClient, parse_config
    from prompts import KNOBS, CLASSIFIER, PROMPT_VERSION, SPRITE_STYLE, build_messages

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT / "arcade"
LOG = ROOT / "generator/logs/generation_logs.jsonl"
ARCHETYPES = ("Feature-Classifier", *KNOBS)


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
    if archetype == "Feature-Classifier":
        features, pool, bias, tests = CLASSIFIER[level]
        training = m["training_pool"]
        if (len(m["features"]) != features or len(m["curveballs"]) != tests
                or not pool[0] <= training["size"] <= pool[1]
                or not bias[0] <= training["bias_strength"] <= bias[1]):
            return f"Level {level} requires feature count, pool, bias and curveballs: {CLASSIFIER[level]}"
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


def attach_sprites(config, previous, source, archetype, level, directory, stem, animated_sprites=None, providers=None):
    theme = config["theme"]
    prompts = theme.pop("sprites", {})
    previous_theme = previous["theme"] if previous else {}
    previous_sprites = previous_theme.get("sprites", {})
    sprites = {}
    created = []
    client = ImageClient()
    warnings = []
    if animated_sprites is None:
        animated_sprites = os.getenv("ENABLE_ANIMATED_SPRITES", "").strip().lower() == "true"
    try:
        for slot in ("class0", "class1"):
            asset, prompt = slot + "_asset", slot + "_prompt"
            existing = previous_theme.get(slot+"Sprite") or previous_sprites.get(asset)
            if existing:
                sprites[asset] = existing
                if prompt in previous_sprites:
                    sprites[prompt] = previous_sprites[prompt]
                continue
            if not prompts.get(prompt, "").strip():
                labels = theme.get("options") or [label for _,label in sorted(theme.get("classLabels", {}).items())]
                index = int(slot[-1])
                label = labels[index] if index < len(labels) else f"Character {index+1}"
                prompts[prompt] = f"{label} in {theme['setting']}. {SPRITE_STYLE.replace('<theme outfit/accessories>', 'clothing suited to this setting')}"
            print(f"Generating Level {level} sprite {slot}", flush=True)
            sprites[prompt] = prompts[prompt]
            art_stem = f"{stem}_L{level}" if previous else stem
            try:
                sprites[asset] = client.generate(prompts[prompt], directory, art_stem, slot)
            except ImageGenerationError as exc:
                warnings.append(f"{slot} image failed. Using a procedural character. {exc}")
                continue
            created.append(directory / sprites[asset])
            if animated_sprites and client.pixel_key:
                try:
                    sprites[asset] = client.animate(directory, sprites[asset], prompts[prompt])
                    client.providers[slot+"Animation"] = "pixellab"
                    created.append(directory / sprites[asset])
                except ImageGenerationError as exc:
                    warnings.append(f"{slot} animation unavailable. Using static sprite. {exc}")
        if any(slot+"_asset" in sprites for slot in ("class0", "class1")):
            theme["sprites"] = sprites
            for slot in ("class0", "class1"):
                if slot+"_asset" in sprites:
                    theme[slot+"Sprite"] = sprites[slot+"_asset"]
        env = theme["environment"]
        description = (f"16-bit top-down 2D pixel art game arena background of {env['setting_name']}, "
                       f"{env['layout']} architecture, {env['floor_style']} floor, {', '.join(env['props'])}, "
                       f"palette {env['primary_color']} {env['secondary_color']} {env['accent_color']}, "
                       "atmospheric lighting, clean open center floor space, vibrant cel-shaded pixel art, "
                       "no characters, no text")
        try:
            theme["backgroundSprite"] = client.generate(description, directory, f"{stem}_L{level}", "backgroundSprite")
            created.append(directory / theme["backgroundSprite"])
        except ImageGenerationError as exc:
            warnings.append(f"Arena image failed; using the procedural environment. {exc}")
        error = validate(source, archetype, config, level)
        if error:
            raise ImageGenerationError(error)
    except ImageGenerationError:
        theme.pop("sprites", None)
        theme.pop("backgroundSprite", None)
        for i in (0,1):
            theme.pop(f"class{i}Sprite", None)
        for path in created:
            path.unlink(missing_ok=True)
        raise
    if providers is not None:
        providers.update(client.providers)
    return " ".join(warnings) or None


def inherit_classifier_labels(config, previous):
    theme, prior = config["theme"], previous["theme"]
    theme.setdefault("featureLabels", {})
    theme["options"] = list(prior["options"])
    old_features = {f["role"]:f for f in previous["mechanics"]["features"]}
    for feature in config["mechanics"]["features"]:
        old = old_features.get(feature["role"])
        if old is None:
            continue
        current_values, old_values = feature["values"], old["values"]
        if feature["role"] == "true":
            keys = ("class_a_value","class_b_value")
            current_values = [config["mechanics"]["class_rule"][key] for key in keys]
            old_values = [previous["mechanics"]["class_rule"][key] for key in keys]
        for new_key, old_key in zip([feature["name"],*current_values], [old["name"],*old_values]):
            theme["featureLabels"][new_key] = prior["featureLabels"][old_key]


def annotate_classifier_cases(mechanics):
    # This is derived from the same class rule the playable round uses.
    rule = mechanics["class_rule"]
    roles = {feature["role"]: feature for feature in mechanics["features"]}
    shortcut = roles["spurious"]
    for case in mechanics["curveballs"]:
        item = case["item"]
        actual_a = item[rule["feature"]] == rule["class_a_value"]
        shortcut_a = item[shortcut["name"]] == shortcut["values"][0]
        case["expected_model_failure"] = actual_a != shortcut_a


def tier_default(source, level):
    return json.loads((source / ("default.json" if level == 1 else f"level{level}.json")).read_text())


def tier_base(source, level, previous, used_layouts):
    config = tier_default(source, level)
    if not previous:
        return config
    prior = previous["theme"]
    theme = config["theme"]
    room = theme["environment"]
    rooms = [tier_default(source, n)["theme"]["environment"] for n in (1, 2, 3)]
    room = next(env for env in [room, *rooms] if env["layout"] not in used_layouts)
    origin = prior["environment"]["layout"]
    for family in (("forest-edge", "misty-hollow", "ancient-ruins"),
                   ("space-station", "reactor-core", "observation-deck")):
        if origin in family:
            layouts = [family[level - 1], *family]
            room = dict(room, layout=next(layout for layout in layouts if layout not in used_layouts))
            if origin in ("forest-edge", "misty-hollow", "ancient-ruins"):
                room["props"] = list(prior["environment"]["props"])
            break
    room = dict(room, setting_name=f"{prior['environment']['setting_name']} · {room['layout'].replace('-', ' ')}")
    for key in ("subtitle", "setting", "tutorial", "practice", "hint", "axes", "sources", "classLabels"):
        if key in prior:
            theme[key] = copy.deepcopy(prior[key])
    theme.update(title=prior["title"], environment=room)
    if "options" in prior:
        size = len(theme["options"])
        theme["options"] = (prior["options"] + theme["options"][len(prior["options"]):])[:size]
    if config["archetype"] == "audit":
        answers = previous["mechanics"]["answers"]
        indices = [(i + level - 1) % len(answers) for i in range(len(config["mechanics"]["answers"]))]
        config["mechanics"]["answers"] = [answers[i] for i in indices]
        theme["claims"] = [prior["claims"][i] for i in indices]
        theme["options"] = list(prior["options"])
    if config["archetype"] == "neighbors":
        old_classes = list(dict.fromkeys(config["mechanics"]["classes"]))
        mapping = dict(zip(old_classes, list(prior["classLabels"])))
        config["mechanics"]["classes"] = [mapping.get(c, next(iter(prior["classLabels"]))) for c in config["mechanics"]["classes"]]
    return config


def unpack_levels(response, level):
    try:
        data = parse_config(response)
    except ValueError:
        # A token cap may cut off a later tier after the anchor object has closed.
        match = re.match(r'^\s*(?:```json\s*)?\{\s*"level' + str(level) + r'"\s*:\s*', response)
        if not match:
            raise
        levels = {}
        decoder = json.JSONDecoder()
        start = match.end()
        key = f"level{level}"
        while True:
            try:
                value, end = decoder.raw_decode(response, start)
            except ValueError:
                if not levels:
                    raise
                break
            levels[key] = value
            following = re.match(r'\s*,\s*"(level[123])"\s*:\s*', response[end:])
            if not following:
                break
            key, start = following.group(1), end + following.end()
        return levels
    return data if isinstance(data, dict) else {}


def generate(client, archetype, topic, theme, level, *, previous=None, root=ROOT, log=LOG, generate_sprites=False,
             revision=None, instruction=None, progress=None, raise_on_failure=False, output_dir=None, animated_sprites=None, bundle=None, inherited_providers=None):
    generate_sprites = generate_sprites or animated_sprites is True
    started = monotonic()
    source = GAMES / archetype / "source"
    run_id = uuid4().hex
    timestamp = datetime.now(timezone.utc).isoformat()
    common = dict(archetype=archetype, topic=topic, theme=theme, level=level, model=client.model,
                  prompt_version=PROMPT_VERSION, timestamp=timestamp)
    action = "Regenerating" if previous else "Generating"
    print(f"{action} Level {level} for {archetype}", flush=True)
    previous_config = json.loads(previous.read_text()) if previous else None
    if previous and previous.with_suffix(".meta.json").is_file():
        inherited_providers = json.loads(previous.with_suffix(".meta.json").read_text()).get("asset_providers")
    providers = dict(inherited_providers or {})
    sprite_error = None
    prior_tier = int(previous.stem[-1]) if previous and re.search(r"_L[123]$",previous.stem) else 1
    messages = build_messages(source, archetype, topic, instruction if revision is not None else theme, level,
                              previous_config, generate_sprites, prior_tier)
    used_layouts = set()
    label_source = previous_config
    if previous:
        prefix = previous.stem.rsplit("_L",1)[0]
        for sibling in previous.parent.glob(prefix+"_L[123].json"):
            if sibling.stem.endswith(f"_L{level}"):
                continue
            accepted = json.loads(sibling.read_text())
            env = accepted["theme"].get("environment",{})
            if env.get("layout"):
                used_layouts.add(env["layout"])
            if (archetype == "Feature-Classifier" and
                    len(accepted["mechanics"]["features"]) > len(label_source["mechanics"]["features"])):
                # Later tiers also name the noise feature, which Level 1 omits.
                label_source = accepted
        for aliases in ({"laboratory","clinical"},{"newsroom","archive"}):
            if used_layouts & aliases:
                used_layouts.update(aliases)
        messages.append({"role":"user","content":"Choose a different architectural layout and location from these used layouts: "
                         + ", ".join(sorted(used_layouts))})
        if label_source is not previous_config:
            messages.append({"role": "user", "content": "Keep these accepted feature names, values and display labels: "
                             + json.dumps({"features": label_source["mechanics"]["features"],
                                           "featureLabels": label_source["theme"]["featureLabels"]})})
    if revision is not None:
        messages.append({"role": "user", "content": json.dumps({
            "current_config": revision, "requested_change": instruction,
            "instructions": "Return the complete revised game config directly. Apply the requested setting "
                            "to every entity label, tutorial, hint and feedback. Preserve unrelated mechanics."
        })})
    if bundle is not None and not previous:
        messages[0]["content"] = "Return one compact JSON level bundle. Apply the requested setting and respect the supplied schema for all overridden fields."
        messages.append({"role": "user", "content": f"Produce all tiers in ONE JSON object. Write level{level} first, "
                         'then the other level keys (level1, level2, level3). Each value is {"theme": {...}} '
                         'with only customized theme fields. Tier-specific mechanics and missing theme fields '
                         'come from validated templates. Use distinct environments. Stay under 1400 tokens.'})
    fallback_reason = None
    failures = []
    api_errors = []
    output = None
    for attempt in range(1, 4):
        if progress:
            progress(f"Level {level} · generating config · attempt {attempt}/3")
        print(f"Level {level}, attempt {attempt}/3: waiting for {client.model}", flush=True)
        try:
            if bundle is None:
                response = client.complete(messages)
                messages.append({"role": "assistant", "content": response})
                config = parse_config(response)
            else:
                key = f"level{level}"
                if not previous:
                    try:
                        response = client.complete(messages)
                        messages.append({"role":"assistant", "content":response})
                        levels = unpack_levels(response, level)
                        bundle.clear()
                        bundle.update(levels if key in levels else {key:levels})
                    except GatewayTimeout as exc:
                        fallback_reason = f"Gateway timeout. Using the local starting configuration. {exc}"
                        bundle[key] = {"theme": {}}
                entry = bundle.get(key)
                base = copy.deepcopy(revision) if revision else tier_base(source, level, previous_config, used_layouts)
                if previous and (not isinstance(entry, dict) or attempt > 1):
                    fallback_reason = "Derived from the accepted level using the local tier template."
                    config = base
                elif isinstance(entry, dict) and set(entry) == {"theme"} and isinstance(entry["theme"], dict):
                    if not previous and not revision:
                        base["theme"]["title"] = theme.strip() or base["theme"]["title"]
                        base["theme"]["subtitle"] = topic.strip()
                    for field, value in entry["theme"].items():
                        if isinstance(value, dict) and isinstance(base["theme"].get(field), dict):
                            base["theme"][field].update(value)
                        else:
                            base["theme"][field] = value
                    config = base
                else:
                    config = entry
        except APIError as exc:
            category, error = "api_error", str(exc)
            api_errors.append({"attempt": attempt, "message": error})
        except ValueError as exc:
            category, error = "json_parse_error", str(exc)
        else:
            if previous_config and isinstance(config, dict) and isinstance(config.get("theme"), dict):
                identity = previous_config["theme"]
                config["theme"]["title"] = identity["title"]
                if "subtitle" in identity:
                    config["theme"]["subtitle"] = identity["subtitle"]
                else:
                    config["theme"].pop("subtitle", None)
            if archetype == "Feature-Classifier":
                try:
                    if label_source:
                        inherit_classifier_labels(config, label_source)
                    annotate_classifier_cases(config["mechanics"])
                except (KeyError, TypeError, AttributeError, IndexError):
                    pass  # The validator reports incomplete structures in the repair prompt.
            error = validate(source, archetype, config, level)
            if error is None and "environment" not in config["theme"]:
                error = "Supply the complete theme.environment for the requested setting."
            if error is None and "layout" not in config["theme"]["environment"]:
                error = "Select theme.environment.layout from the architectural layouts in the schema."
            if error is None and config["theme"]["environment"]["layout"] in used_layouts:
                error = "Choose a new environment.layout. Already used: " + ", ".join(sorted(used_layouts))
            if error is None:
                # Only use paths produced by the image stage.
                for field in ("backgroundSprite","class0Sprite","class1Sprite"):
                    config["theme"].pop(field,None)
                print(f"Level {level} validation passed", flush=True)
                slug = re.sub(r"[^a-z0-9]+", "-", f"{topic}-{theme}".lower()).strip("-")[:70] or "activity"
                # Keep each pair together without overwriting earlier research runs.
                stem = previous.stem.rsplit("_L", 1)[0] if previous else f"{slug}-{run_id}"
                output = (output_dir or root / "generated" / archetype) / f"{stem}_L{level}.json"
                output.parent.mkdir(parents=True, exist_ok=True)
                meta = dict(common, schema_version="v1", attempts=attempt, run_id=run_id)
                if fallback_reason:
                    meta["fallback_reason"] = fallback_reason
                    print(fallback_reason, flush=True)
                if generate_sprites:
                    if progress:
                        progress(f"Level {level} · generating character sprites")
                    try:
                        sprite_error = attach_sprites(config, previous_config, source, archetype, level, output.parent, stem, animated_sprites, providers)
                    except ImageGenerationError as exc:
                        sprite_error = str(exc)
                    if sprite_error:
                        meta["sprite_error"] = sprite_error
                        print(f"Warning: {sprite_error}", file=sys.stderr)
                elif revision or previous_config:
                    retained = (revision or previous_config)["theme"]
                    if revision and retained.get("backgroundSprite") and retained.get("environment")==config["theme"].get("environment"):
                        config["theme"]["backgroundSprite"] = retained["backgroundSprite"]
                    config["theme"].pop("sprites", None)
                    if retained.get("sprites"):
                        config["theme"]["sprites"] = copy.deepcopy(retained["sprites"])
                    for i in (0,1):
                        asset = retained.get(f"class{i}Sprite") or retained.get("sprites", {}).get(f"class{i}_asset")
                        if asset:
                            config["theme"][f"class{i}Sprite"] = asset
                else:
                    config["theme"].pop("sprites", None)
                for slot, field in (("class0","class0Sprite"), ("class1","class1Sprite"), ("backgroundSprite","backgroundSprite")):
                    if not config["theme"].get(field):
                        providers[slot] = "procedural"
                meta["asset_providers"] = providers
                if previous:
                    meta[f"source_level{prior_tier}_file"] = str(previous.relative_to(root))
                for path, data in [(output.with_suffix(".meta.json"), meta), (output, config)]:
                    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
                    print(f"Saved {path}", flush=True)
                break
            print(f"Level {level} validation failed", flush=True)
            category = "schema_validation_error"
        failures.append(category)
        print(f"Attempt {attempt}: {category}: {error}", file=sys.stderr)
        messages.append({"role": "user", "content": f"{category}:\n{error}\nReturn the complete corrected JSON object."})
    record = dict(common, run_id=run_id, is_regeneration=previous is not None, attempts=attempt,
                  passed=output is not None, first_pass_success=output is not None and attempt == 1,
                  failure_categories=failures, latency_ms=round((monotonic()-started)*1000))
    if output:
        record["asset_providers"] = providers
    if sprite_error is not None:
        record["sprite_error"] = sprite_error
    if api_errors:
        record["api_errors"] = api_errors
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf8") as stream:
        stream.write(json.dumps(record) + "\n")
    if not output and raise_on_failure:
        raise APIError(f"Level {level} failed after {attempt} attempts: {error}")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archetype", choices=ARCHETYPES, default="Feature-Classifier")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--theme", required=True)
    parser.add_argument("--level", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--regenerate-level", type=int, choices=[2, 3])
    parser.add_argument("--generate-sprites", action="store_true", help="Generate two themed characters and their arena background")
    args = parser.parse_args()
    load_env(ROOT / ".env")
    if args.regenerate_level and args.level != 1:
        parser.error("--regenerate-level requires --level 1")
    client = LLMClient()
    inputs = client, args.archetype, args.topic, args.theme
    bundle = {} if args.regenerate_level else None
    path = generate(*inputs, args.level, generate_sprites=args.generate_sprites, bundle=bundle)
    if path and args.regenerate_level:
        first = path
        for tier in range(2, args.regenerate_level + 1):
            path = generate(*inputs, tier, previous=first, generate_sprites=args.generate_sprites, bundle=bundle)
            if not path:
                break
    return 0 if path else 1


if __name__ == "__main__":
    sys.exit(main())
