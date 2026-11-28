# Standalone AI literacy games

Serve the repository over HTTP (for local development, run `python3 -m http.server 8000`). Each folder's `source/index.html` is an independent iframe entry point. Opening it directly over HTTP starts its default round.

## Embed

Listen before setting the iframe URL. Send the complete validated JSON object after the iframe loads. Use the actual game origin, including its port. The parent must have a regular HTTP(S) origin.

```js
const frame = document.querySelector('iframe');
const url = new URL('/arcade/Feature-Classifier/source/index.html', location.origin);
window.addEventListener('message', ({source, origin, data}) => {
  if (source === frame.contentWindow && origin === url.origin && data?.type === 'GAME_EVENT') {
    console.log(data.archetype, data.event, data.detail);
  }
});
frame.addEventListener('load', async () => {
  const config = await fetch(new URL('default.json', url)).then(r => r.json());
  frame.contentWindow.postMessage({type: 'LOAD_CONFIG', config}, url.origin);
});
frame.src = url;
```

The four Studio archetypes and the three additional standalone games share arcade_hud.js, narrator.js, and style.css. Signal-Sorter streams carrier waves through live switches, a filter and a ground sink. Later stages introduce a splitter, a vent and a frequency inverter. Serve the arcade directory structure together. Use the config query parameter to select a saved activity; sprite paths resolve relative to that JSON. Hosts can also send LOAD_CONFIG and listen for GAME_EVENT from the iframe.

## Adding a New Archetype

1. Start from the Alert-Dial source layout. Define a stable archetype ID, mechanics, and independently editable theme in the schema. Include neutral, playable default.json, level2.json, and level3.json fixtures, a levels.json difficulty guide, and a standalone validate.py. Validate cross-field relationships as well as JSON types.
2. Implement createRound(config) in game.js. Keep scoring and transitions independent of the DOM. Return view(), act(index), and submit(). The view supplies phase, subject, two team names, action labels, score, metric, value (0–100), tutorial guidance and completion state. Alert-Dial demonstrates a continuous control and Claim-Inspector demonstrates evidence inspection.
3. Use the shared HUD entry point and arcade/style.css. For an original control, extend the view and renderer together. Keep generated strings in textContent. Test the default and shifted distribution, a failing decision, and a winning decision.
4. Register the difficulty counts and prompt guidance in generator/prompts.py and the semantic checks in generator/generate.py. The Studio discovers registered games and groups generated levels by filename. Run both test suites from the repository root.

Neighborhood-Vote, Reward-Workshop and Search-Desk retain their original playable selection controls. Use their existing evaluators when moving them to the arena HUD.
