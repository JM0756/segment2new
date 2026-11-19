import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "config_schema.json").read_text())

def validate(config):
    if isinstance(config, dict) and "mechanics" not in config and "features" in config:
        from legacy_validate import validate as validate_legacy
        return validate_legacy(config)
    return [error.message for error in Draft202012Validator(SCHEMA).iter_errors(config)]

if __name__ == "__main__":
    errors = []
    for filename in sys.argv[1:] or [HERE / "default.json"]:
        errors.extend(validate(json.loads(Path(filename).read_text())))
    print("\n".join(errors) or "OK")
    sys.exit(bool(errors))
