# AI literacy activity generator

Run these commands from the Git repository root. The Python CLI generates JSON activities for the six standalone games in [segment2new](segment2new/README.md). Each game still runs independently. The generator requires Python 3.9+ and an OpenAI-compatible chat completions endpoint.

## Set up

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r generator/requirements.txt
```

For local generation, start Ollama (or run `ollama serve` in another terminal) and run `ollama pull qwen2.5:7b` once. The defaults are `http://localhost:11434/v1` and `qwen2.5:7b`. For a hosted endpoint, export its API base including any version prefix as `LLM_BASE_URL`, its model ID as `LLM_MODEL`, and its key as `LLM_API_KEY`.

## Generate

```sh
python generator/generate.py --archetype Orbit-Patrol --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1
python generator/generate.py --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1 --regenerate-level 2
```

Orbit-Patrol is the default. Other choices are Alert-Dial, Claim-Inspector, Neighborhood-Vote, Reward-Workshop, and Search-Desk. Levels 1, 2, and 3 target Literacy, Fluency, and Competency. The generator defines Level 3 constraints where the game only supplies earlier tiers.

Each accepted activity prints its path under `generated/<archetype>/`. Send the JSON object to the game's iframe using `LOAD_CONFIG`. The adjacent `.meta.json` records provenance. Each pair shares a unique filename stem. The second prompt includes the accepted Level 1 config. After three failed attempts the command exits with status 1 and retains any accepted first level.

## Test and report

```sh
python -m pytest -q generator/tests
python generator/metrics.py
```

Tests use mock model responses and the real game validators. Each requested level that starts generation appends one row to `generator/logs/generation_logs.jsonl`. First-pass and eventual schema conformance rates use all runs as the denominator. A conforming run produced an accepted config within three attempts. Mean and max attempts use successful runs. Regeneration rate uses attempted Level 2 regenerations. Failure counts include every failed attempt. Empty denominators display N/A. Use `python generator/metrics.py --log PATH` to analyze another JSONL file.
