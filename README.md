# AI literacy activity generator

Run these commands from the Git repository root. The Python CLI generates JSON activities for the six standalone games in [arcade](arcade/README.md). Each game still runs independently. The generator requires Python 3.9+ and an OpenAI-compatible chat completions endpoint.

## Set up

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r generator/requirements.txt
```

With your FreeLLMAPI Docker gateway running on port 3001, configure the generator in the same terminal. Replace the placeholder with your gateway key.

```sh
export LLM_BASE_URL="http://localhost:3001/v1"
export LLM_MODEL="auto"
export LLM_API_KEY="<your FreeLLMAPI key>"
```

The URL and model above are the defaults. You can also set the base URL to `http://localhost:3001`. The client appends `/v1` automatically.

## Generate

```sh
python generator/generate.py --archetype Orbit-Patrol --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1
python generator/generate.py --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1 --regenerate-level 2
```

Orbit-Patrol is the default. Other choices are Alert-Dial, Claim-Inspector, Neighborhood-Vote, Reward-Workshop, and Search-Desk. Levels 1, 2, and 3 target Literacy, Fluency, and Competency. The generator defines Level 3 constraints where the game only supplies earlier tiers.

Each accepted activity prints its path under `generated/<archetype>/`. You can send the JSON object to the game's iframe using `LOAD_CONFIG`. The adjacent `.meta.json` records provenance. Each pair shares a unique filename stem. The second prompt includes the accepted Level 1 config. After three failed attempts the command exits with status 1 and retains any accepted first level.

To playtest an activity, serve the repository root:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/arcade/Orbit-Patrol/source/index.html?config=../../../generated/Orbit-Patrol/<file>_L1.json` with the filename printed by the generator. For another archetype, change both occurrences of the game name. Omit `?config=` to play the default round.

## Test and report

```sh
python -m pytest -q generator/tests
python generator/metrics.py
```

Tests use mock model responses and the real game validators. Each requested level that starts generation appends one row to `generator/logs/generation_logs.jsonl`. First-pass and eventual schema conformance rates use all runs as the denominator. A conforming run produced an accepted config within three attempts. Mean and max attempts use successful runs. Regeneration rate uses attempted Level 2 regenerations. Failure counts include every failed attempt. Empty denominators display N/A. Use `python generator/metrics.py --log PATH` to analyze another JSONL file.
