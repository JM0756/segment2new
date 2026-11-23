import json

PROMPT_VERSION = "fgp-v3"
SPRITE_STYLE = ("16-bit pixel art chibi avatar character sprite matching a standardized blocky base template "
                "(square pixel head with two dark pixel eyes, compact rectangular body, bold 2px dark outline), "
                "wearing <theme outfit/accessories>, centered full-body standing pose, isolated on pure solid "
                "#FFFFFF background, no floor, no shadow, no frame, no text.")
TIERS = {
    1: "Literacy / Remember–Understand. Ask for one recognizable pattern. Give a worked cue and a direct hint.",
    2: "Fluency / Apply–Analyze. Require applying the rule across multiple cases and distinguishing at least one plausible distractor. Give a guiding hint without revealing the answer.",
    3: "Competency / Evaluate–Create. Ask learners to construct or evaluate a solution against competing evidence. Include edge cases and a reflective hint. Only ask for actions the game supports.",
}
# Counts correspond to independently adjustable inputs in each game's evaluator.
KNOBS = {
    "Signal-Sorter": ("samples", (5, 7, 9)),
    "Alert-Dial": ("records", (5, 7, 9)),
    "Claim-Inspector": ("answers", (3, 4, 5)),
    "Neighborhood-Vote": ("positions", (5, 7, 9)),
    "Reward-Workshop": ("routes", (3, 4, 5)),
    "Search-Desk": ("order", (2, 3, 4)),
}
CLASSIFIER = {1: (2, (6, 6), (2/3, 1), 1), 2: (3, (8, 10), (.75, .9), 3),
         3: (3, (11, 12), (.5, .75), 4)}


def build_messages(source, archetype, topic, theme, level, previous, generate_sprites=False, prior_tier=1):
    if archetype in KNOBS:
        field, targets = KNOBS[archetype]
        knobs = f"Use exactly {targets[level-1]} entries in mechanics.{field}."
    else:
        features, pool, bias, tests = CLASSIFIER[level]
        knobs = f"Use {features} features, pool size within {pool}, bias within {bias}, and {tests} curveballs."
    inputs = {"topic": topic, "theme": theme, "level": f"level_{level}",
              "constraints": [TIERS[level], knobs, "Give this game a themed title and short subtitle shared by all tiers."]}
    inputs["world_physics_schema"] = json.loads((source.parents[1]/"world_physics.schema.json").read_text())
    inputs["constraints"].append("Design top-level world_physics for each level: normalized center coordinates, "
        "theme-matched surface speed, drag, trails, interactive structures and 1–4 separated solid obstacles. "
        "Keep obstacles away from entry-to-checkpoint lane and zones. Preserve mechanics for physical edits. "
        "For classifiers give theme.class0 and class1 names, trueFeature and one spuriousFeatures entry, "
        "each feature with a display name and two themed value labels. Use them in all player-facing text.")
    if generate_sprites:
        inputs["constraints"].append(
            "In theme.sprites, supply class0_prompt and class1_prompt for the first two "
            "theme.options (or classLabels in sorted key order). Describe each entity using this exact style: "
            f"{SPRITE_STYLE} Use the same front/three-quarter "
            "stance for both classes; vary only clothing, helmet, hair and accessories. Omit asset paths."
        )
    else:
        inputs["constraints"].append("Omit theme.sprites.")
    if archetype == "Alert-Dial":
        inputs["constraints"].append("Set falseAlarmCost and missCost. At Level 2 shift the incident base rate and use asymmetric error costs.")
    if archetype == "Claim-Inspector":
        inputs["constraints"].append("Provide retrieved evidence in theme.sources. Include supported, contradicted and unsupported claims. At Level 2 include subtle extrapolations.")
    inputs["constraints"].append("Set theme.palette floor, stripe, team0 and team1 to contrasting six-digit hex colors suited to the setting.")
    inputs["constraints"].append(
        "Design a complete theme.environment for this specific world: setting_name, floor_style, "
        "primary_color, secondary_color, accent_color and at least two distinct perimeter props. "
        "Each tier visits a distinct location within the world. Change layout, perimeter props and palette while preserving class identities, feature identifiers and cue terminology. Select the architectural layout matching the scenario (space-station, speakeasy, party, wasteland, laboratory, clinical, newsroom, archive, reactor-core, observation-deck, forest-edge, misty-hollow, ancient-ruins). Choose layout, floor_style and props from config_schema. Omit preset for a custom setting. "
        "Never supply class0Sprite, class1Sprite, backgroundSprite or image asset paths; the image stage writes them."
    )
    if level == 3:
        inputs["constraints"].append({
            "Feature-Classifier":"Invert the shortcut correlation in mastery field cases while the true signal stays reliable.",
            "Alert-Dial":"Use closely spaced scores around the operating cutoff and asymmetric error costs.",
            "Claim-Inspector":"Require comparing multiple source records and distinguishing inference from explicit evidence.",
            "Signal-Sorter":"Use a faster mixed wave of clean and noisy samples with one unambiguous cue."
        }.get(archetype, "Require several decisions to solve the mastery round."))
    for name in ("config_schema", "default", "levels"):
        path = source / (name + ".json")
        if name=="default" and level>1:
            path = source/f"level{level}.json"
        inputs[name] = json.loads(path.read_text())
    inputs["evaluation_rules"] = {
        "Feature-Classifier": (
            "Use one true and one spurious binary feature, plus one noise feature at higher levels. A six-sample wave always contains four aligned and two inverted cases. "
            "Supply featureLabels for every feature name and value. Each curveball item must map "
            "every feature name, including noise, to one of its declared values. The first spurious "
            "value predicts class A and the second predicts class B. Set expected_model_failure "
            "to true exactly when that prediction disagrees with class_rule."
        ),
        "Signal-Sorter": "Show two chibi lab couriers carrying their respective samples. Use 0 for an intact, clean sample and 1 for a damaged, noisy sample. Label the two visually distinct samples in theme.options. Mix both classes in each wave. Set pace to 0.7, 1.4 or 2.1 by level.",
        "Alert-Dial": "A winning cutoff flags at least minHits records, all positive.",
        "Claim-Inspector": "Each claim has one answer index in theme.options. Match claims and answers in sequence.",
        "Neighborhood-Vote": "Select k closest positions to target. Classes align with positions and have visible classLabels.",
        "Reward-Workshop": "A selectable weight vector must give the goal route a uniquely highest dot product.",
        "Search-Desk": "Select distinct document indices in the exact order. Include additional plausible documents.",
    }[archetype]
    if previous is not None:
        inputs[f"accepted_level_{prior_tier}"] = previous
    return [
        {"role": "system", "content": """Return exactly one JSON config object. Follow config_schema strictly.
Use default as a structural exemplar and levels for compatible mechanics. Only change data. Keep game_logic.js rules intact.
Keep internal identifiers stable and use the required mechanics counts. Keep choices and answer indices aligned,
supply a display label for every entity, feature and value, and ensure a winning solution exists.
Rewrite every visible label, tutorial instruction, hint and feedback message for the requested theme.
Leave zero default-theme text behind. In a regeneration retain the world, entity identities and terminology
from the supplied accepted activity. Scale difficulty to the requested tier. Never add metadata or unsupported UI fields."""},
        {"role": "user", "content": json.dumps(inputs, ensure_ascii=False)},
    ]
