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

## Local Web Studio

Activate the virtual environment and run:

```sh
python3 studio/server.py
```

Open http://localhost:8000/ and choose an archetype under Explore games. Complete its tutorial to unlock Level 1 and the floating AI remix control. Finish Level 1 with at least 80% accuracy to earn three stars and unlock Level 2. This browser remembers progress per archetype. Saved themes appear under All Saved Games. Built-in activities work offline.

Studio reads a repository-root `.env` at startup and gives exported shell variables precedence. Click the gateway status pill to update the base URL or key for the current server session. A “key required” status means the gateway responded to the models probe. A blank key preserves the current key when the gateway origin stays the same.

## Generate

```sh
python generator/generate.py --archetype Feature-Classifier --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1
python generator/generate.py --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1 --regenerate-level 2
```

Feature-Classifier is the default. Other choices are Alert-Dial, Claim-Inspector, Neighborhood-Vote, Reward-Workshop, and Search-Desk. Levels 1, 2, and 3 target Literacy, Fluency, and Competency. The generator defines Level 3 constraints where the game only supplies earlier tiers.

Each accepted activity prints its path under `generated/<archetype>/`. You can send the JSON object to the game's iframe using `LOAD_CONFIG`. The adjacent `.meta.json` records provenance. Each pair shares a unique filename stem. The second prompt includes the accepted Level 1 config. After three failed attempts the command exits with status 1 and retains any accepted first level.

To playtest an activity, serve the repository root:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/arcade/Feature-Classifier/source/index.html?config=../../../generated/Feature-Classifier/<file>_L1.json` with the filename printed by the generator. For another archetype, change both occurrences of the game name. Omit `?config=` to play the default round.

## Generate sprites

Add `--generate-sprites` to request two square PNG icons through the gateway's `/v1/images/generations` endpoint. The command below generates a Level 1 activity and reuses its icons for Level 2.

```sh
export IMAGE_MODEL="auto"
python generator/generate.py --archetype Feature-Classifier --topic "Overfitting" --theme "Deep space" --generate-sprites --regenerate-level 2
```

`IMAGE_MODEL` defaults to `auto`. Set `IMAGE_BASE_URL` or `IMAGE_API_KEY` to override the text gateway URL or key for diffusion. Without the flag, the generator makes only text requests.

Both levels reference PNGs in the adjacent `assets/` directory. Keep that directory alongside the JSON when copying an activity. The games resolve asset paths relative to the JSON selected by `?config=` and also accept image data URIs. Serve the arcade folder with its shared renderer and stylesheets.

If diffusion fails, the generator saves the validated text activity and records the provider error under `sprite_error` in its metadata and generation log. Each game draws geometric icons for missing or unavailable sprites.

## Test and report

```sh
python -m pytest -q
python generator/metrics.py
node --test
```

Tests use mock model responses and the real game validators. Each requested level that starts generation appends one row to `generator/logs/generation_logs.jsonl`. First-pass and eventual schema conformance rates use all runs as the denominator. A conforming run produced an accepted config within three attempts. Mean and max attempts use successful runs. Regeneration rate uses attempted Level 2 regenerations. Failure counts include every failed attempt. Empty denominators display N/A. Use `python generator/metrics.py --log PATH` to analyze another JSONL file.
