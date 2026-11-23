import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "config_schema.json").read_text())

SCHEMA["properties"]["world_physics"] = json.loads((HERE.parents[1] / "world_physics.schema.json").read_text())

def validate(config):
    errors = [e.message for e in Draft202012Validator(SCHEMA).iter_errors(config)]
    if errors:
        return errors
    mechanics = config["mechanics"]
    features = mechanics["features"]
    labels = config["theme"]["featureLabels"]
    fields = {f["name"]: f["values"] for f in features}
    for name, values in fields.items():
        if any(key not in labels for key in [name, *values]):
            errors.append(f"Missing display label for {name} or its values")
    roles = {f["role"]: f for f in features}
    rule = mechanics["class_rule"]
    if len(fields) != len(features) or len(roles) != len(features) or not {"true", "spurious"} <= roles.keys():
        return errors + ["Expected distinct causal and spurious features"]
    if rule["feature"] != roles["true"]["name"] or set(roles["true"]["values"]) != {rule["class_a_value"], rule["class_b_value"]}:
        return errors + ["Invalid class rule"]
    for case in mechanics["curveballs"]:
        item = case["item"]
        if set(item) != set(fields) or any(item[k] not in v for k,v in fields.items()):
            errors.append("Invalid field test features")
        else:
            shortcut = roles["spurious"]
            shortcut_a = item[shortcut["name"]] == shortcut["values"][0]
            actual_a = item[rule["feature"]] == rule["class_a_value"]
            mismatch = shortcut_a != actual_a
            if mismatch != case["expected_model_failure"]:
                errors.append("Incorrect field test annotation")
    return errors

if __name__ == "__main__":
    errors = []
    for filename in sys.argv[1:] or [HERE / "default.json"]:
        errors.extend(validate(json.loads(Path(filename).read_text())))
    print("\n".join(errors) or "OK")
    sys.exit(bool(errors))
