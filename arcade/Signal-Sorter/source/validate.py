import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "config_schema.json").read_text())

SCHEMA["properties"]["world_physics"] = json.loads((HERE.parents[1] / "world_physics.schema.json").read_text())

def validate(config):
    errors = [err.message for err in Draft202012Validator(SCHEMA).iter_errors(config)]
    if not errors and set(config["mechanics"]["samples"]) != {0, 1}:
        errors.append("Include both clean and noisy samples.")
    return errors

if __name__ == "__main__":
    errors = [err for file in sys.argv[1:] or [HERE/"default.json"]
              for err in validate(json.loads(Path(file).read_text()))]
    print("\n".join(errors) or "OK")
    sys.exit(bool(errors))
