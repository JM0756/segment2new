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
from time import monotonic, sleep
from uuid import uuid4

if __package__:
    from .tilemap import clear_walking_lanes, curated_tilemap, valid_tilemap
    from .world_physics import default_world, edits_since, geometry_error, merge, patch_world
    from .settings import load_env
    from .image_client import ImageClient, ImageGenerationError, classifier_backdrop, scenery_items, visual_name
    from .llm_client import APIError, GatewayTimeout, LLMClient, UnusableCompletion, parse_config
    from .prompts import UI_KEYS, KNOBS, CLASSIFIER, PROMPT_VERSION, SPRITE_STYLE, build_messages
else:
    from tilemap import clear_walking_lanes, curated_tilemap, valid_tilemap
    from world_physics import default_world, edits_since, geometry_error, merge, patch_world
    from settings import load_env
    from image_client import ImageClient, ImageGenerationError, classifier_backdrop, scenery_items, visual_name
    from llm_client import APIError, GatewayTimeout, LLMClient, UnusableCompletion, parse_config
    from prompts import UI_KEYS, KNOBS, CLASSIFIER, PROMPT_VERSION, SPRITE_STYLE, build_messages

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT / "arcade"
LOG = ROOT / "generator/logs/generation_logs.jsonl"
ARCHETYPES = ("Feature-Classifier", *KNOBS)


def validate(source, archetype, config, level):
    normalize_required_ui(config, tier_default(source, level), archetype)
    with TemporaryDirectory() as folder:
        candidate = Path(folder) / "candidate.json"
        candidate.write_text(json.dumps(config))
        result = subprocess.run([sys.executable, str(source / "validate.py"), str(candidate)],
                                text=True, capture_output=True)
    if result.returncode:
        return (result.stdout + result.stderr).rstrip("\n")
    if not isinstance(config, dict) or "mechanics" not in config:
        return "Expected standalone config with mechanics and theme."
    if "tilemap" in config and not valid_tilemap(config["tilemap"],level):
        return "Tilemap requires reachable S, ?, L and R and tier-specific terrain."
    if "world_physics" in config:
        error = geometry_error(config["world_physics"])
        if error:
            return error
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


def character_prompt(config, index, description):
    theme = config["theme"]
    labels = theme.get("options") or [label for _, label in sorted(theme.get("classLabels", {}).items())]
    name = labels[index] if index < len(labels) else f"Character {index+1}"
    other = labels[1-index] if len(labels) >= 2 else ""
    # Drop a contaminated description as a whole: removing a noun can still leave
    # the opposing class's clothing and anatomy in the art direction.
    def roots(label):
        return {word.rstrip("s") for word in re.findall(r"[a-z]+", label.lower())}
    opposing = roots(other) - roots(name)
    rule = config["mechanics"].get("class_rule", {})
    cue = theme.get("featureLabels", {}).get(rule.get(("class_a_value", "class_b_value")[index]), "")
    palette = theme.get("palette", {}).get(f"team{index}") or ("warm amber", "cool violet")[index]
    nonhuman = re.search(r"\b(?:jellyfish|drones?|plants?|creatures?|sensors?|documents?|machines?|robots?|probes?|signals?|corals?)\b", name, re.I)
    human = not nonhuman and re.search(r"\b(?:humans?|people|crew|pilots?|astronauts?|divers?|scientists?|guards?|knights?|couriers?|zombies?|workers?)\b", name, re.I)
    if not human and description:
        # Older saved prompts may contain an appended avatar template. Keep the subject text.
        description = re.split(r"(?i)\b(?:16-bit pixel art chibi|standardized blocky|chibi|humanoid avatar|square pixel head)\b", description)[0].strip(" .,")
    silhouette = "chibi humanoid proportions" if human else "the subject's natural shape and proportions"
    if palette == theme.get("palette", {}).get(f"team{1-index}"):
        palette = ("warm amber", "cool violet")[index]
    parts = [name]
    for detail in (cue, description):
        if detail and not (roots(detail) & opposing):
            parts.append(detail)
    parts.append(f"{silhouette}, {palette} palette")
    return ". ".join(parts) + ". " + SPRITE_STYLE


def attach_sprites(config, previous, source, archetype, level, directory, stem, animated_sprites=None, providers=None, provider_errors=None):
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
            prompts[prompt] = character_prompt(config, int(slot[-1]), prompts.get(prompt, ""))
            print(f"Generating Level {level} sprite {slot}", flush=True)
            sprites[prompt] = prompts[prompt]
            art_stem = f"{stem}_L{level}" if previous else stem
            try:
                sprites[asset] = client.generate(prompts[prompt], directory, art_stem, slot)
            except ImageGenerationError as exc:
                warnings.append(f"{slot} image failed. Using a procedural character. {exc}")
                continue
            created.append(directory / sprites[asset])
            if animated_sprites and client.pixel_key and (client.provider != "retrodiffusion" or client.providers.get(slot) == "pixellab"):
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
        surface = config.get("world_physics",{}).get("surface",{}).get("type",env["floor_style"])
        location = environment_name(env["setting_name"])
        description = (f"16-bit top-down 2D pixel art game arena background of {location}, "
                       f"{surface} walking surface, perimeter details: {', '.join(map(visual_name,env['props']))}, "
                       f"palette {env['primary_color']} {env['secondary_color']} {env['accent_color']}, "
                       "atmospheric lighting, open floor for the live checkpoint, gates and obstacles, vibrant cel-shaded pixel art, "
                       "no characters, no text")
        if archetype == "Feature-Classifier":
            description = classifier_backdrop(location, env, config.get("titleScreen", {}).get("catchyTitle", theme["title"]))
        try:
            theme["backgroundSprite"] = client.generate(description, directory, f"{stem}_L{level}", "backgroundSprite")
            created.append(directory / theme["backgroundSprite"])
        except ImageGenerationError as exc:
            warnings.append(f"Arena image failed; using the procedural environment. {exc}")
        if client.pixel_key and client.provider in ("auto","pixellab"):
            baseline = tier_default(source,level)
            stock = baseline["theme"]["environment"]["props"]
            env["props"] = [dict(name=p) if isinstance(p,str) and p not in stock else p for p in env["props"]]
            world = config.get("world_physics", {})
            if "hazards" in world:
                world["hazards"] = [dict(name=v) if isinstance(v,str) else v for v in world["hazards"]]
            stock_styles = [o.get("kind",o.get("style")) for o in scenery_items(baseline)]
            for node in scenery_items(config):
                descriptor = node.get("kind",node.get("style"))
                if isinstance(descriptor,dict):
                    node.update(descriptor)
                elif descriptor and descriptor not in stock_styles:
                    node.setdefault("name",descriptor)
                if node.get("visualPrompt") and not node.get("name"):
                    node["name"] = descriptor or node.get("id","station")
                if node.get("name"):
                    try:
                        node.pop("sprite", None)
                        palette = {"primaryColor": env["primary_color"], "accentColor": env["accent_color"]}
                        node["sprite"] = client.scenery(directory, theme["title"], {**palette, **node})
                    except (ImageGenerationError,OSError) as exc:
                        warnings.append(f"{node['name']} scenery unavailable: {exc}")
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
    finally:
        if provider_errors is not None:
            provider_errors.extend(client.provider_errors)
        if providers is not None:
            providers.update(client.providers)
    return " ".join(warnings) or None


UI_CONTAINERS = ("ui", "labels", "strings", "controls", "narrator", "copy", "theme")


def ui_fields(node):
    """Collect strings from known copy containers, preferring the nearest direct field."""
    result = {}
    if isinstance(node, dict):
        for name in UI_CONTAINERS:
            result.update(ui_fields(node.get(name)))
        for key in (*UI_KEYS, "archetype"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                result[key] = value
    return result


def lift_ui(config, shared=None):
    if not isinstance(config, dict):
        return
    theme = config.get("theme")
    fields = {**(shared or {}), **ui_fields(config), **ui_fields(theme)}
    kind = fields.pop("archetype", None)
    if kind and not config.get("archetype"):
        config["archetype"] = kind
    if fields and theme is None:
        theme = config["theme"] = {}
    if isinstance(theme, dict):
        theme.update(fields)
        theme.pop("archetype", None)
    for node in (config, theme):
        if isinstance(node, dict):
            for name in UI_CONTAINERS:
                if name != "theme":
                    node.pop(name, None)
    for key in UI_KEYS:
        config.pop(key, None)


def normalize_required_ui(config, exemplar, game):
    if not isinstance(config, dict):
        return
    lift_ui(config)
    kind = config.get("archetype")
    if kind is None or isinstance(kind, str) and kind.strip() in ("", game):
        config["archetype"] = exemplar["archetype"]
    theme = config.get("theme")
    if isinstance(theme, dict):
        defaults = dict(exemplar["theme"])
        if title := theme.get("title"):
            defaults.update(practice=f"Practice a round of {title}.", success=f"{title} round complete.")
        for key in UI_KEYS:
            if not isinstance(theme.get(key), str) or not theme[key].strip():
                theme[key] = defaults[key]


def generic_cue(label, names):
    return not isinstance(label, str) or not label.strip() or label.strip().casefold() in {
        "quiet surface cue", "bright surface cue", "surface cue", "identity mark",
        "rapid beacon", "slow beacon", *(f"{name} mark".casefold() for name in names)}


def normalize_classifier_labels(config):
    theme = config["theme"]
    if theme.get("featureLabels") is None:
        theme["featureLabels"] = {}
    labels = theme["featureLabels"]
    for feature in config["mechanics"]["features"]:
        name = feature["name"]
        label = feature.pop("label", None)
        display = feature.pop("display_label", None) or label
        overrides = feature.pop("value_labels", {})
        for key in [name, *feature["values"]]:
            supplied = display if key == name else overrides.get(key) if isinstance(overrides, dict) else None
            if isinstance(supplied, str) and supplied.strip():
                if not generic_cue(supplied.strip(), theme.get("options", [])) or not labels.get(key):
                    labels[key] = supplied.strip()
            elif not isinstance(labels.get(key), str) or not labels[key].strip():
                words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", key)
                labels[key] = re.sub(r"[_-]+", " ", words).strip().capitalize()


def concise_cue(text):
    # Keep a concrete noun phrase, leaving explanatory prose in the tutorial.
    phrase = re.sub(r"\s*\([^()]*\)", "", text)
    phrase = re.split(r"[,;:.!?()—–]|\s+-\s+|\s+(?:which|that|because|while|whereas|when|with)\b",
                      phrase, maxsplit=1, flags=re.I)[0]
    words = phrase.split() or text.strip(" ()").split()
    return " ".join(words[:3])


def compact_classifier_cues(theme):
    labels = theme.get("featureLabels")
    if isinstance(labels, dict):
        for key, value in labels.items():
            if isinstance(value, str):
                labels[key] = concise_cue(value)
    def compact(spec):
        if isinstance(spec, str):
            return concise_cue(spec)
        if isinstance(spec, dict):
            if isinstance(spec.get("name"), str):
                spec["name"] = concise_cue(spec["name"])
            if isinstance(spec.get("values"), list):
                spec["values"] = [concise_cue(v) if isinstance(v,str) else v for v in spec["values"]]
        return spec
    if "trueFeature" in theme:
        theme["trueFeature"] = compact(theme["trueFeature"])
    if isinstance(theme.get("spuriousFeatures"), list):
        theme["spuriousFeatures"] = [compact(spec) for spec in theme["spuriousFeatures"]]


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
            if feature["role"] != "true" and new_key in old["values"]:
                old_key = new_key
            inherited = prior["featureLabels"][old_key]
            current = theme["featureLabels"].get(new_key)
            fallback = {"Shape", "Rounded outline", "Angular outline", "Accessory", "Striped accessory",
                        "Spotted accessory", "Decoration", "Plain trim", "Patterned trim"}
            if (generic_cue(current, theme["options"]) or current in fallback or
                    not generic_cue(inherited, theme["options"]) and inherited not in fallback):
                theme["featureLabels"][new_key] = inherited


def requested_traits(text, names):
    """Read explicit class descriptions and labelled cue lists without guessing class order."""
    def items(value):
        parts = re.split(r"\s*(?:,|/|\bversus\b|\bvs\.?\s|\band\b|\bor\b)\s*", value, flags=re.I)
        return [p.strip(" '\"*()") for p in parts if p.strip(" '\"*()")]

    traits = []
    for name in names:
        subject = re.escape(name)
        match = re.search(subject + r"\s*(?:[:(]|\b(?:have|wear|with|show|feature)\b)\s*([^.;\n)]+)", text, re.I)
        if not match:
            match = re.search(r"(?:look for|recognize)\s+([^.;\n]+?)\s+to identify\s+" + subject, text, re.I)
        clause = match[1] if match else ""
        for other in names:
            if other != name:
                clause = re.split(r"(?:,?\s+(?:while|whereas|and)\s+|,\s*)" + re.escape(other) + r"\b", clause, flags=re.I)[0]
        traits.append(" and ".join(items(clause)))
    def values(pattern):
        match = re.search(pattern + r"\s*(?::|=|include\b|are\b|like\b|such as\b)\s*([^.;\n]+)", text, re.I)
        if not match:
            return "", []
        clause = match[1].strip()
        named = re.fullmatch(r"([^():]+?)\s*(?:\(([^()]+)\)|:\s*(.+))", clause)
        if named:
            return named[1].strip(), items(named[2] or named[3])
        return "", items(clause)
    true_name, causal = values(r"(?:true features?|true cues?|causal (?:traits?|features?))")
    spurious_name, distractors = values(r"(?:distractors?|spurious (?:features?|cues?)|props)")
    return {"names": {"true": true_name, "spurious": spurious_name},
            "true": [trait or cue for trait, cue in zip(traits, (causal + ["", ""])[:2])],
            "spurious": distractors[:2], "noise": distractors[2:4]}


def apply_classifier_identity(config, template, previous, request=""):
    theme = config["theme"]
    keys = ("class0", "class1", "trueFeature", "spuriousFeatures")
    if previous:
        for key in keys:
            if key in previous["theme"]:
                theme[key] = copy.deepcopy(previous["theme"][key])
            elif key in ("class0", "class1"):
                theme.pop(key, None)
    names = theme["options"]
    for index, key in enumerate(keys[:2]):
        if key in theme:
            names[index] = theme[key]["name"]
    if not previous and theme["title"] != template["theme"]["title"]:
        for i,name in enumerate(names):
            if name == template["theme"]["options"][i]:
                names[i] = f"{theme['title']} · Type {'AB'[i]}"
    roles = {f["role"]: f for f in config["mechanics"]["features"]}
    labels = theme["featureLabels"]
    stock = template["theme"]
    custom = names != stock["options"] or any(key in theme for key in keys)
    # Prefer the user's labelled clauses. Model-written tutorial and hint prose
    # also carry concrete traits when a compact bundle omits structured values.
    requested = requested_traits(request, names)
    described = requested_traits("\n".join(theme.get(k, "") for k in ("tutorial", "hint")), names) if custom else {}
    fallback = {"true": ("Shape", ["Rounded outline", "Angular outline"]),
                "spurious": ("Accessory", ["Striped accessory", "Spotted accessory"]),
                "noise": ("Decoration", ["Plain trim", "Patterned trim"])}
    for role, feature in roles.items():
        spec = {"true": theme.get("trueFeature"), "spurious": (theme.get("spuriousFeatures") or [None])[0]}.get(role)
        if isinstance(spec, str):
            spec = {"name": spec}
        values = feature["values"]
        if role == "true":
            rule = config["mechanics"]["class_rule"]
            values = [rule["class_a_value"], rule["class_b_value"]]
        if spec:
            if not generic_cue(spec["name"], names) or generic_cue(labels.get(feature["name"]), names):
                labels[feature["name"]] = spec["name"]
        if custom or any(requested[role]):
            if generic_cue(labels.get(feature["name"]), names) or (not spec and labels.get(feature["name"]) in stock["featureLabels"].values()):
                labels[feature["name"]] = fallback[role][0]
            if requested["names"].get(role):
                labels[feature["name"]] = requested["names"][role]
            for i, value in enumerate(values):
                explicit = (requested[role] + ["", ""])[i]
                inferred = (described.get(role, []) + ["", ""])[i]
                if explicit:
                    labels[value] = explicit
                elif spec and "values" in spec and not generic_cue(spec["values"][i], names):
                    labels[value] = spec["values"][i]
                elif generic_cue(labels.get(value), names) or labels.get(value) in stock["featureLabels"].values():
                    labels[value] = inferred or fallback[role][1][i]
            if spec:
                spec["name"] = labels[feature["name"]]
                if role == "true" and isinstance(theme.get("trueFeature"), str):
                    theme["trueFeature"] = spec["name"]
                if role == "spurious" and isinstance(theme["spuriousFeatures"][0], str):
                    theme["spuriousFeatures"][0] = spec["name"]
            if spec and "values" in spec:
                spec["values"] = [labels[value] for value in values]
    if custom or labels != stock["featureLabels"]:
        replacements = dict(zip(stock["options"],names))
        for feature in template["mechanics"]["features"]:
            other = roles.get(feature["role"])
            if other:
                for old,new in zip([feature["name"],*feature["values"]],[other["name"],*other["values"]]):
                    if new in labels:
                        replacements[stock["featureLabels"][old]] = labels[new]
        # Rebuild inherited station prose as a whole. It uses shorthand such
        # as "crew" and "hull seal" in addition to the full display names.
        if custom:
            rule = config["mechanics"]["class_rule"]
            causal = labels[rule["feature"]]
            shortcut = labels[roles["spurious"]["name"]]
            examples = [labels[rule[k]] for k in ("class_a_value", "class_b_value")]
            narration = {
                "setting": f"In {theme['title']}, sort {names[0]} and {names[1]} by {causal}.",
                "tutorial": f"Check {causal} before choosing {names[0]} or {names[1]}.",
                "hint": f"{examples[0]} identifies {names[0]}. {examples[1]} identifies {names[1]}. {shortcut} can mislead.",
            }
            for key, value in narration.items():
                if theme.get(key) == stock.get(key):
                    theme[key] = value
        changed = {old.casefold(): new for old, new in replacements.items() if old != new}
        if changed:
            pattern = re.compile("|".join(map(re.escape, sorted(changed, key=len, reverse=True))), re.I)
            for key in ("setting", "tutorial", "hint", "practice", "success", "failure"):
                if isinstance(theme.get(key), str):
                    theme[key] = pattern.sub(lambda match: changed[match[0].casefold()], theme[key])


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


def unchanged_game(original, response):
    # Paths in the draft are local to its directory and the provider may omit them.
    asset_keys = {"sprites","backgroundImage","backgroundSprite","class0Sprite","class1Sprite"}
    def authored_theme(config):
        return {k:v for k,v in config["theme"].items() if k not in asset_keys}
    return (isinstance(response.get("theme"),dict) and
            response.get("archetype")==original["archetype"] and
            response.get("mechanics")==original["mechanics"] and
            authored_theme(response)==authored_theme(original) and
            all(response.get(k)==original.get(k) for k in ("environment","titleScreen")))


def classifier_presentation(config, request, previous):
    """Complete partial visual specifications; preserve authored values across tier patches."""
    theme = config.get("theme")
    if not isinstance(theme, dict):
        return
    room = theme.get("environment", {})
    if not isinstance(room, dict):
        return
    profiles = [
        ("reef|ocean|underwater|marine|jellyfish", "bubbles spores steel_grating neon_bevel panoramic cyber_mono abyssal_neon", "Marine Survey"),
        ("noir|detective|precinct|1920", "rain sun_rays noir_concrete brass_trim balanced noir_serif noir_brass", "Investigations Bureau"),
        ("alpine|snow|summit|arctic|mountain", "snow clouds stone_slate stone_curb panoramic field_stencil alpine_console", "Summit Survey"),
        ("forest|garden|botanic|orchard|woodland", "dust spores wood_deck wood_trim balanced storybook_bold botanical_parchment", "Field Research"),
        ("forge|volcan|foundry|lava", "embers wind_streaks cobblestone iron_railing compact field_stencil industrial_steel", "Materials Division"),
        ("lab|clinic", "none neon_glints lab_tile neon_bevel compact cyber_mono industrial_steel", "Research Division"),
    ]
    description = f"{theme.get('title','')} {room.get('setting_name','')} {theme.get('setting','')}"
    profile, badge = next(((style, tag) for text in (request, description)
                           for pattern, style, tag in profiles if re.search(pattern, text, re.I)),
                          ("dust stars steel_grating bolted_frame balanced pixel_arcade industrial_steel", "Survey Division"))
    weather, particles, material, trim, layout, font, art = profile.split()
    palette = theme.get("palette") or {}
    if not isinstance(palette,dict) or not isinstance(theme.get("featureLabels",{}),dict) or not isinstance(config.get("mechanics",{}),dict):
        return
    accent = room.get("accent_color", "#8acbc8")
    environment = dict(weather=dict(type=weather, intensity=.45, angle=12, tint=accent),
                       particles=dict(type=particles, density=.35, tint=accent),
                       platform=dict(material=room["floor_style"] if isinstance(room.get("floor_style"),dict) else material, borderStyle=trim, sceneryLayout=layout,
                                     deckFill=room.get("primary_color", "#27383d"), gridLine=room.get("secondary_color", "#405357"),
                                     borderAccent=accent, bayLeftAccent=palette.get("team0", "#77d6cc"),
                                     bayRightAccent=palette.get("team1", "#f2ab79")))
    words = re.findall(r"[\w’-]+", str(theme.get("title") or badge))[:4]
    if not words:
        words = badge.split()
    if len(words) == 1:
        words.append("Survey")
    rule = config.get("mechanics",{}).get("class_rule")
    core = rule.get("feature") if isinstance(rule,dict) else None
    title = dict(catchyTitle=" ".join(words).upper(), divisionBadge=badge.upper(),
                 tagline=f"Track the {theme.get('featureLabels',{}).get(core,'reliable signal')} and train your classifier to see through the disguise.",
                 fontStyle=font, artStyle=art)
    if config.get("archetype") == "sorter":
        title["tagline"] = "Route the carriers and ground the interference."
        location = room.get("setting_name") or theme.get("title") or "Signal"
        conduit_defaults = {
            "emitterLabel": f"{location} Emitter", "coreALabel": f"{location} Alpha",
            "coreBLabel": f"{location} Beta", "sinkLabel": "Static Ground",
            "lowLabel": "Low / Sine", "highLabel": "High / Twin",
            "lowColor": palette.get("team0", "#56e1cc"), "highColor": palette.get("team1", "#ffa86c"),
        }
        prior_theme = (previous or {}).get("theme", {})
        for field, value in conduit_defaults.items():
            theme.setdefault(field, prior_theme.get(field, value))
    for key, defaults in (("environment", environment), ("titleScreen", title)):
        inherited = (previous or {}).get(key, {})
        supplied = config.get(key, {})
        if key == "environment" and isinstance(supplied,dict):
            for layer in ("weather","particles"):
                if isinstance(supplied.get(layer),str):
                    supplied[layer] = {"type":supplied[layer]}
                elif isinstance(supplied.get(layer),dict) and "name" in supplied[layer]:
                    supplied[layer].setdefault("type", supplied[layer].pop("name"))
        config[key] = merge(merge(defaults, inherited), supplied) if isinstance(supplied, dict) else supplied


def environment_name(name):
    # Older tier fallbacks appended procedural layout slugs to custom settings.
    return re.sub(r"(?:\s*[·,–—:]\s*|\s+-\s+)(?:space[- ]station|reactor[- ]core)"
                  r"(?: architecture)?\s*$|\s+(?:space[- ]station|reactor[- ]core) architecture\s*$",
                  "", name, flags=re.I)


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
    room = dict(room, setting_name=f"{environment_name(prior['environment']['setting_name'])} · Area {level}")
    for key in ("subtitle", "setting", "tutorial", *UI_KEYS, "hint", "axes", "sources", "classLabels"):
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
        match = re.match(r'^\s*(?:```json\s*)?\{\s*"level' + str(level) + r'"\s*:\s*', response or "")
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
    if not isinstance(data, dict):
        return {}
    game = data.get("game")
    if isinstance(game, dict):
        data = {**game, **{key: value for key, value in data.items() if key != "game"}}
        lift_ui(data, ui_fields(game))
    levels = data.pop("levels", None)
    if isinstance(levels, list):
        levels = {f"level{number}": entry for number, entry in enumerate(levels[:3], 1)}
    if isinstance(levels, dict):
        for number in (1, 2, 3):
            key = f"level{number}"
            entry = levels.get(key, levels.get(str(number)))
            if entry is not None:
                data.setdefault(key, entry)
    for key in ("environment", "titleScreen"):
        if isinstance(data.get(key), dict):
            for number in (1, 2, 3):
                entry = data.get(f"level{number}")
                if isinstance(entry, dict):
                    entry[key] = merge(data[key], entry.get(key, {}))
    return data


def generate(client, archetype, topic, theme, level, *, previous=None, root=ROOT, log=LOG, generate_sprites=False,
             revision=None, instruction=None, progress=None, raise_on_failure=False, output_dir=None, animated_sprites=None, bundle=None, inherited_providers=None, revision_levels=None):
    generate_sprites = generate_sprites or animated_sprites is True
    started = monotonic()
    source = GAMES / archetype / "source"
    exemplar = tier_default(source, level)
    run_id = uuid4().hex
    timestamp = datetime.now(timezone.utc).isoformat()
    common = dict(archetype=archetype, topic=topic, theme=theme, level=level, model=client.model,
                  prompt_version=PROMPT_VERSION, timestamp=timestamp)
    action = "Regenerating" if previous else "Generating"
    print(f"{action} Level {level} for {archetype}", flush=True)
    previous_config = json.loads(previous.read_text()) if previous else None
    if previous and inherited_providers is None and previous.with_suffix(".meta.json").is_file():
        inherited_providers = json.loads(previous.with_suffix(".meta.json").read_text()).get("asset_providers")
    providers = dict(inherited_providers or {})
    provider_errors = []
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
                         'then the other level keys (level1, level2, level3). Each value may patch theme, world_physics and tilemap. When visual_keys are supplied, include environment and titleScreen patches. For physical edits return only world_physics patches. '
                         'Include only changed fields. Tier-specific mechanics and missing theme fields '
                         'come from validated templates. Use distinct environments. Stay under 1400 tokens.'})
    fallback_reason = None
    failures = []
    api_errors = []
    output = None
    recoverable = False
    for attempt in range(1, 5):
        local = attempt == 4
        if local and not recoverable:
            break
        if progress and not local:
            progress(f"Level {level} · generating config · attempt {attempt}/3")
        if not local:
            print(f"Level {level}, attempt {attempt}/3: waiting for {client.model}", flush=True)
        recoverable = False
        entry = None
        try:
            physics_patch = None
            if local:
                if progress:
                    progress(f"Level {level} · building local fallback")
                fallback_reason = "No usable gateway completion after three attempts. Using the local tier template."
                config = copy.deepcopy(revision) if revision else tier_base(source, level, previous_config, used_layouts)
                if not previous_config and not revision:
                    config["theme"]["title"] = theme.strip() or config["theme"]["title"]
                    config["theme"]["subtitle"] = topic.strip()
                    config["theme"]["environment"]["setting_name"] = (theme.strip() or topic.strip())[:100] or config["theme"]["environment"]["setting_name"]
                    config.pop("world_physics", None)
                    config.pop("tilemap", None)
                if bundle is not None and instruction:
                    bundle["_cue_request"] = instruction
            elif bundle is None:
                response = client.complete(messages)
                config = unpack_levels(response, level)
                messages.append({"role": "assistant", "content": response})
                if f"level{level}" in config:
                    envelope = config
                    config = envelope[f"level{level}"]
                    lift_ui(config, ui_fields(envelope))
            else:
                key = f"level{level}"
                if not previous:
                    try:
                        response = client.complete(messages)
                        levels = unpack_levels(response, level)
                        messages.append({"role":"assistant", "content":response})
                        bundle.clear()
                        bundle.update(levels if key in levels else {key:levels})
                    except GatewayTimeout as exc:
                        fallback_reason = f"Gateway timeout. Using the local starting configuration. {exc}"
                        bundle[key] = {"theme": {}}
                entry = bundle.get(key)
                shared_ui = ui_fields(bundle)
                lift_ui(entry, shared_ui)
                if (isinstance(entry, dict) and entry.get("archetype") in (archetype, exemplar["archetype"])
                        and set(entry) <= {"archetype", "theme", "world_physics", "tilemap","environment","titleScreen"}):
                    entry.pop("archetype")
                if revision and isinstance(entry, dict) and isinstance(entry.get("world_physics"), dict):
                    # Providers sometimes echo the complete original along with a physical edit.
                    if unchanged_game(revision,entry):
                        geometry = edits_since(revision.get("world_physics",{}),entry["world_physics"])
                        entry = {k:entry[k] for k in ("tilemap",) if k in entry and entry[k]!=revision.get(k)}
                        entry["world_physics"] = geometry
                original = revision
                if previous and bundle.get("_physics_revision"):
                    original = (revision_levels or {}).get(level)
                base = copy.deepcopy(original) if original else tier_base(source, level, previous_config, used_layouts)
                if previous and (not isinstance(entry, dict) or attempt > 1):
                    fallback_reason = "Derived from the accepted level using the local tier template."
                    config = base
                elif (isinstance(entry, dict) and entry and set(entry) <= {"theme","world_physics","tilemap","environment","titleScreen"}
                      and isinstance(entry.get("theme", {}), dict)):
                    physics_patch = entry.get("world_physics")
                    if not previous and (physics_patch is not None or "tilemap" in entry):
                        bundle["_shared_physics"] = physics_patch or {}
                        bundle["_physics_revision"] = bool(revision and not any(entry.get(k) for k in ('theme','environment','titleScreen')))
                    base["tilemap"] = entry.get("tilemap")
                    base.pop("world_physics", None)
                    if not previous and not revision:
                        base["theme"]["title"] = theme.strip() or base["theme"]["title"]
                        base["theme"]["subtitle"] = topic.strip()
                    for field, value in entry.get("theme", {}).items():
                        if isinstance(value, dict) and isinstance(base["theme"].get(field), dict):
                            base["theme"][field].update(value)
                        else:
                            base["theme"][field] = value
                    for field in ("environment","titleScreen"):
                        if field in entry:
                            base[field] = merge(base.get(field, {}), entry[field])
                    config = base
                else:
                    config = entry
        except APIError as exc:
            category, error = "api_error", str(exc)
            api_errors.append({"attempt": attempt, "message": error})
            recoverable = isinstance(exc, (UnusableCompletion, GatewayTimeout))
        except ValueError as exc:
            category, error = "json_parse_error", str(exc)
            recoverable = True
        else:
            normalize_required_ui(config, exemplar, archetype)
            retained_level = None
            if (bundle or {}).get("_physics_revision"):
                retained_level = revision or (revision_levels or {}).get(level)
            if isinstance(config, dict) and isinstance(config.get("theme"),dict) and isinstance(config.get("archetype"),str):
                defaults = default_world(config, level, instruction or theme)
                shared = (bundle or {}).get("_shared_physics", {})
                if revision:
                    defaults = merge(defaults,revision.get("world_physics", {}))
                elif previous_config and (bundle or {}).get("_physics_revision") and level in (revision_levels or {}):
                    defaults = merge(defaults,revision_levels[level].get("world_physics", {}))
                elif previous_config and not shared:
                    accepted = previous_config.get("world_physics", {})
                    if accepted != default_world(previous_config,prior_tier):
                        defaults = merge(defaults,accepted)
                patch = config.get("world_physics", {}) if physics_patch is None else physics_patch
                if previous_config and bundle is not None and (not isinstance(entry,dict) or attempt>1):
                    patch = {}
                    config.pop("tilemap",None)
                config["world_physics"] = patch_world(defaults,merge(shared,patch))
                world = config["world_physics"]
                if isinstance(world,dict) and isinstance(world.get("obstacles"),list):
                    world["obstacles"] = world["obstacles"][:2]
                if previous_config and bundle is not None and attempt == 3 and not patch:
                    # A shared obstacle may fit the anchor but intersect a sibling's own checkpoint.
                    config["world_physics"] = copy.deepcopy(previous_config["world_physics"])
            if previous_config and not retained_level and isinstance(config, dict) and isinstance(config.get("theme"), dict):
                identity = previous_config["theme"]
                config["theme"]["title"] = identity["title"]
                if "subtitle" in identity:
                    config["theme"]["subtitle"] = identity["subtitle"]
                else:
                    config["theme"].pop("subtitle", None)
            if archetype == "Feature-Classifier":
                try:
                    normalize_classifier_labels(config)
                except (KeyError, AttributeError, TypeError):
                    pass  # Structural errors go through the normal schema repair.
            if archetype == "Feature-Classifier" and not retained_level:
                try:
                    if label_source:
                        inherit_classifier_labels(config, label_source)
                    if bundle is not None and instruction:
                        bundle["_cue_request"] = instruction
                    cue_request = instruction or (bundle or {}).get("_cue_request") or f"{topic}\n{theme}"
                    apply_classifier_identity(config, exemplar, previous_config, cue_request)
                    annotate_classifier_cases(config["mechanics"])
                except (KeyError, TypeError, AttributeError, IndexError):
                    pass  # The validator reports incomplete structures in the repair prompt.
            if archetype in ("Feature-Classifier", "Signal-Sorter") and isinstance(config, dict):
                if archetype == "Feature-Classifier" and isinstance(config.get("theme"), dict):
                    compact_classifier_cues(config["theme"])
                classifier_presentation(config, instruction or f"{topic} {theme}", previous_config)
            rows = config.pop("tilemap",None) if isinstance(config,dict) else None
            error = validate(source, archetype, config, level)
            if error is None:
                if not valid_tilemap(rows, level):
                    rows = curated_tilemap(config["world_physics"],level)
                    if not valid_tilemap(rows, level):
                        rows = tier_default(source,level)["tilemap"]
                config["tilemap"] = clear_walking_lanes(rows,config["world_physics"])
            if error is None and "environment" not in config["theme"]:
                error = "Supply the complete theme.environment for the requested setting."
            if error is None and "layout" not in config["theme"]["environment"]:
                error = "Select theme.environment.layout from the architectural layouts in the schema."
            if error is None and not retained_level and config["theme"]["environment"]["layout"] in used_layouts:
                error = "Choose a new environment.layout. Already used: " + ", ".join(sorted(used_layouts))
            if error is None:
                # Only use paths produced by the image stage.
                for field in ("backgroundImage","backgroundSprite","class0Sprite","class1Sprite"):
                    config["theme"].pop(field,None)
                print(f"Level {level} validation passed", flush=True)
                slug = re.sub(r"[^a-z0-9]+", "-", f"{topic}-{theme}".lower()).strip("-")[:70] or "activity"
                # Keep each pair together without overwriting earlier research runs.
                stem = previous.stem.rsplit("_L", 1)[0] if previous else f"{slug}-{run_id}"
                output = (output_dir or root / "generated" / archetype) / f"{stem}_L{level}.json"
                output.parent.mkdir(parents=True, exist_ok=True)
                meta = dict(common, schema_version="v1", attempts=min(attempt, 3), run_id=run_id)
                if fallback_reason:
                    meta["fallback_reason"] = fallback_reason
                    print(fallback_reason, flush=True)
                if generate_sprites:
                    if progress:
                        progress(f"Level {level} · generating character sprites")
                    try:
                        sprite_error = attach_sprites(config, previous_config, source, archetype, level, output.parent, stem, animated_sprites, providers, provider_errors)
                    except ImageGenerationError as exc:
                        sprite_error = str(exc)
                    if sprite_error:
                        meta["sprite_error"] = sprite_error
                        print(f"Warning: {sprite_error}", file=sys.stderr)
                elif revision or previous_config:
                    retained = (retained_level or revision or previous_config)["theme"]
                    background = retained.get("backgroundImage") or retained.get("backgroundSprite")
                    if (retained_level or revision) and background and retained.get("environment")==config["theme"].get("environment"):
                        config["theme"]["backgroundSprite"] = background
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
                meta["provider_errors"] = provider_errors
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
        if recoverable and attempt < 3:
            sleep(1.5 * attempt)
        messages.append({"role": "user", "content": f"{category}:\n{error}\nReturn the complete corrected JSON object."})
    attempt = min(attempt, 3)
    record = dict(common, run_id=run_id, is_regeneration=previous is not None, attempts=attempt,
                  passed=output is not None, first_pass_success=output is not None and attempt == 1,
                  failure_categories=failures, latency_ms=round((monotonic()-started)*1000))
    if output:
        if fallback_reason:
            record["fallback_reason"] = fallback_reason
        record["asset_providers"] = providers
        record["provider_errors"] = provider_errors
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
