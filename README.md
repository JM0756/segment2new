# AI literacy activity generator

Run these commands from the Git repository root. The Python CLI generates JSON activities for the seven standalone games in [arcade](arcade/README.md). Each game still runs independently. The generator requires Python 3.9+ and an OpenAI-compatible chat completions endpoint.

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

Open http://localhost:8000/ and choose an archetype under Explore games. Complete its tutorial to unlock Level 1 and the floating AI remix control. Pass at least three of the four field cases and select **Next Level →** to advance through Level 3. Choose **Save Progress** to remember unlocks for that archetype across sessions. Studio keeps generated and remixed runs in a temporary workspace until you choose **Save Game**. The saved drawer can reopen or delete a game and its artwork. Built-in activities work offline.

Studio reads a repository-root `.env` at startup and gives exported shell variables precedence.

## Generate

```sh
python generator/generate.py --archetype Feature-Classifier --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1
python generator/generate.py --topic "Overfitting" --theme "Nuclear Fallout: Humans vs. Zombies" --level 1 --regenerate-level 2
```

Feature-Classifier is the default. Other choices are Signal-Sorter, Alert-Dial, Claim-Inspector, Neighborhood-Vote, Reward-Workshop, and Search-Desk. Levels 1, 2, and 3 target Literacy, Fluency, and Competency. Every archetype includes playable fixtures for all three tiers.

Each accepted activity prints its path under `generated/<archetype>/`. You can send the JSON object to the game's iframe using `LOAD_CONFIG`. The adjacent `.meta.json` records provenance. Use `--regenerate-level 3` to generate all three tiers with a shared filename stem. The second prompt includes the accepted Level 1 config. After three failed attempts the command exits with status 1 and retains any accepted first level.

To playtest an activity, serve the repository root:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/arcade/Feature-Classifier/source/index.html?config=../../../generated/Feature-Classifier/<file>_L1.json` with the filename printed by the generator. For another archetype, change both occurrences of the game name. Omit `?config=` to play the default round.

## Generate sprites

Add `--generate-sprites` (or select **2D Sprites** in Studio) to generate two characters and a matching arena background. Higher tiers reuse the characters and generate a separate arena background. Without images, the cards and games draw the floor, palette and props from the activity’s environment.

```sh
export IMAGE_MODEL="auto"
python generator/generate.py --archetype Feature-Classifier --topic "Overfitting" --theme "Deep space" --generate-sprites --regenerate-level 2
```

Set `PIXELLAB_API_KEY` in the repository-root `.env` or your shell to use PixelLab Pixflux. Both the CLI and Studio read this file and preserve existing shell settings. Restart Studio after editing the file. With sprite generation enabled, set `ENABLE_ANIMATED_SPRITES=true` for optional four-frame character art, or send `"animated_sprites": true` to the Studio generation or refinement API. If animation times out after 20 seconds, the character uses its static sprite. `PIXELLAB_BASE_URL` defaults to `https://api.pixellab.ai/v1`. Characters request native transparency at 128×128; the arena requests a 320×180 scene. [PixelLab v1 API](https://api.pixellab.ai/v1/docs)

An unset or empty PixelLab key selects the OpenAI-compatible `/images/generations` endpoint and Pillow character cleanup. `IMAGE_MODEL` defaults to `auto`. Set `IMAGE_BASE_URL` or `IMAGE_API_KEY` to override the text gateway URL or key for diffusion. Without the flag, the generator makes only text requests.

The generated levels reference PNGs in the adjacent `assets/` directory. Keep that directory alongside the JSON when copying an activity. The games resolve asset paths relative to the JSON selected by `?config=` and also accept image data URIs. Serve the arcade folder with its shared renderer and stylesheets.

If diffusion fails, the generator saves the validated text activity and records the provider error under `sprite_error` in its metadata and generation log. If only the background request fails, the character images remain playable against the procedural scene.

## Test and report

```sh
python -m pytest -q
python generator/metrics.py
node --test
```

Tests use mock model responses and the real game validators. Each requested level that starts generation appends one row to `generator/logs/generation_logs.jsonl`. First-pass and eventual schema conformance rates use all runs as the denominator. A conforming run produced an accepted config within three attempts. Mean and max attempts use successful runs. Regeneration rate uses attempted Level 2 regenerations. Failure counts include every failed attempt. Empty denominators display N/A. Use `python generator/metrics.py --log PATH` to analyze another JSONL file.
