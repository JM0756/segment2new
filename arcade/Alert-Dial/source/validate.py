import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "config_schema.json").read_text())

def validate(config):
    errors = [error.message for error in Draft202012Validator(SCHEMA).iter_errors(config)]
    if errors:
        return errors
    mechanics, theme = config["mechanics"], config["theme"]
    if len(theme["options"]) != 2:
        errors.append("Provide two checkpoint class labels.")
    positives = sum(label for _, label in mechanics["records"])
    if not 1 <= mechanics["minHits"] <= positives:
        errors.append("The hit target must be achievable.")
    return errors

if __name__ == "__main__":
    errors = []
    for filename in sys.argv[1:] or [HERE / "default.json"]:
        errors.extend(validate(json.loads(Path(filename).read_text())))
    print("\n".join(errors) or "OK")
    sys.exit(bool(errors))
