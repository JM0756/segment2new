import json

PROMPT_VERSION = "fgp-v1"
TIERS = {
    1: "Literacy / Remember–Understand. Ask for one recognizable pattern. Give a worked cue and a direct hint.",
    2: "Fluency / Apply–Analyze. Require applying the rule across multiple cases and distinguishing at least one plausible distractor. Give a guiding hint without revealing the answer.",
    3: "Competency / Evaluate–Create. Ask learners to construct or evaluate a solution against competing evidence. Include edge cases and a reflective hint. Only ask for actions the game supports.",
}
# Counts correspond to independently adjustable inputs in each game's evaluator.
KNOBS = {
    "Alert-Dial": ("records", (5, 7, 9)),
    "Claim-Inspector": ("answers", (3, 4, 5)),
    "Neighborhood-Vote": ("positions", (5, 7, 9)),
    "Reward-Workshop": ("routes", (3, 4, 5)),
    "Search-Desk": ("order", (2, 3, 4)),
}
ORBIT = {1: (2, (6, 6), (1, 1), 1), 2: (3, (8, 10), (.75, .9), 3),
         3: (3, (11, 12), (.5, .75), 4)}


def build_messages(source, archetype, topic, theme, level, previous):
    if archetype in KNOBS:
        field, targets = KNOBS[archetype]
        knobs = f"Use exactly {targets[level-1]} entries in mechanics.{field}."
    else:
        features, pool, bias, tests = ORBIT[level]
        knobs = f"Use {features} features, pool size within {pool}, bias within {bias}, and {tests} curveballs."
    inputs = {"topic": topic, "theme": theme, "level": f"level_{level}",
              "constraints": [TIERS[level], knobs]}
    for name in ("config_schema", "default", "levels"):
        path = source / (name + ".json")
        if path.exists():
            inputs[name] = json.loads(path.read_text())
    inputs["evaluation_rules"] = {
        "Orbit-Patrol": "One true and one spurious binary feature. Add one noise feature at higher levels. Supply featureLabels for every feature name and value. Curveballs must specify all features.",
        "Alert-Dial": "A winning cutoff flags at least minHits records, all positive.",
        "Claim-Inspector": "Each claim has one answer index in theme.options. Match claims and answers in sequence.",
        "Neighborhood-Vote": "Select k closest positions to target. Classes align with positions and have visible classLabels.",
        "Reward-Workshop": "A selectable weight vector must give the goal route a uniquely highest dot product.",
        "Search-Desk": "Select distinct document indices in the exact order. Include additional plausible documents.",
    }[archetype]
    if previous is not None:
        inputs["accepted_level_1"] = previous
    return [
        {"role": "system", "content": """Return exactly one JSON config object. Follow config_schema strictly.
Use default as a structural exemplar and levels for compatible mechanics. Only change data. Keep game_logic.js rules intact.
Keep internal identifiers stable and use the required mechanics counts. Keep choices and answer indices aligned,
supply a display label for every entity, feature and value, and ensure a winning solution exists.
Rewrite every visible label, tutorial instruction, hint and feedback message for the requested theme.
Leave zero default-theme text behind. In a regeneration retain the world, entity identities and terminology
from accepted_level_1 while increasing difficulty. Never add metadata or unsupported UI fields."""},
        {"role": "user", "content": json.dumps(inputs, ensure_ascii=False)},
    ]
