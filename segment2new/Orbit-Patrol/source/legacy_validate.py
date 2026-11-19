"""Schema + level-rule validation. Usage: python validate.py example_level1.json
The generator's retry loop should feed the returned error strings back to the LLM."""
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).parent
SCHEMA = json.loads((HERE / "legacy_schema.json").read_text())
LEVELS = json.loads((HERE / "levels.json").read_text())

def in_range(v, rng): return rng[0] <= v <= rng[1]

def validate(cfg: dict) -> list[str]:
    errs = [f"schema: {'/'.join(map(str, e.path)) or '<root>'}: {e.message}"
            for e in Draft202012Validator(SCHEMA).iter_errors(cfg)]
    if errs:
        return errs
    k = LEVELS[str(cfg["level"]["tier"])]
    if cfg["level"]["label"] != k["label"]:
        errs.append(f"level: tier {cfg['level']['tier']} must be labeled {k['label']}")
    feats = cfg["features"]
    if not in_range(len(feats), k["n_features"]): errs.append(f"levels: n_features {len(feats)} outside {k['n_features']}")
    if not in_range(cfg["training_pool"]["size"], k["pool_size"]): errs.append("levels: pool size outside allowed range")
    if not in_range(cfg["training_pool"]["bias_strength"], k["bias_strength"]): errs.append("levels: bias_strength outside allowed range")
    if not in_range(len(cfg["curveballs"]), k["curveballs"]): errs.append("levels: curveball count outside allowed range")
    if cfg["ui"]["show_confidence_meter"] != k["show_confidence_meter"]: errs.append("levels: show_confidence_meter mismatch")
    if cfg["ui"]["show_vocab_terms"] != k["show_vocab_terms"]: errs.append("levels: show_vocab_terms mismatch")
    roles = [f["role"] for f in feats]
    if roles.count("true") != 1 or roles.count("spurious") != 1:
        errs.append("features: need exactly one 'true' and one 'spurious' feature")
    if len({f['name'] for f in feats}) != len(feats):
        errs.append('features: names must be unique')
    rule = cfg['class_rule']
    true_feats = [f for f in feats if f['role'] == 'true']
    if len(true_feats) != 1 or rule['feature'] != true_feats[0]['name']:
        errs.append('class_rule: must name the true feature')
    else:
        if {rule['class_a_value'], rule['class_b_value']} != set(true_feats[0]['values']):
            errs.append('class_rule: must map the two distinct true values to classes')
    if len({cb['id'] for cb in cfg['curveballs']}) != len(cfg['curveballs']):
        errs.append('curveballs: IDs must be unique')
    spur = next((f for f in feats if f['role'] == 'spurious'), None)
    if spur and not errs:
        for cb in cfg['curveballs']:
            item = cb['item']
            if rule['feature'] in item and spur['name'] in item:
                actual = 'a' if item[rule['feature']] == rule['class_a_value'] else 'b'
                baseline = 'a' if item[spur['name']] == spur['values'][0] else 'b'
                if cb['expected_model_failure'] != (actual != baseline):
                    errs.append(f"curveball {cb['id']}: baseline failure annotation is inconsistent")
    names = {f["name"]: set(f["values"]) for f in feats}
    for cb in cfg["curveballs"]:
        for fname, val in cb["item"].items():
            if fname not in names or val not in names[fname]:
                errs.append(f"curveball {cb['id']}: {fname}={val} not a declared feature value")
        if set(cb["item"]) != set(names):
            errs.append(f"curveball {cb['id']}: must specify every feature")
    if cfg["level"]["tier"] == 1:
        for h in cfg["hints"].values():
            if "{spurious_feature}" not in cfg["hints"]["on_failure"]:
                errs.append("hints: level-1 failure hint must reference {spurious_feature}"); break
    return errs

if __name__ == '__main__':
    failed = False
    for p in sys.argv[1:]:
        e = validate(json.loads(Path(p).read_text()))
        failed |= bool(e)
        print(p, 'OK' if not e else 'FAIL')
        for x in e: print('  -', x)
    sys.exit(1 if failed else 0)
