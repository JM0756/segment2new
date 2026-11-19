# Standalone AI literacy games

Serve the repository over HTTP (for local development, run `python3 -m http.server 8000`). Each folder's `source/index.html` is an independent iframe entry point. Opening it directly over HTTP starts its default round.

## Embed

Listen before setting the iframe URL. Send the complete validated JSON object after the iframe loads. Use the actual game origin, including its port. The parent must have a regular HTTP(S) origin.

```js
const frame = document.querySelector('iframe');
const url = new URL('/arcade/Orbit-Patrol/source/index.html', location.origin);
window.addEventListener('message', ({source, origin, data}) => {
  if (source === frame.contentWindow && origin === url.origin && data?.type === 'GAME_EVENT') {
    console.log(data.archetype, data.event, data.detail);
  }
});
frame.addEventListener('load', async () => {
  const config = await fetch(new URL('fallout.json', url)).then(r => r.json());
  frame.contentWindow.postMessage({type: 'LOAD_CONFIG', config}, url.origin);
});
frame.src = url;
```

Each load starts a fresh round and opens the skippable practice overlay. Events are start, action (select or submit), fail (retry available), win, and hint_shown. Selection indices are zero-based. Replay emits another start. The Orbit Patrol fallout.json and party.json files use identical mechanics.

## Validation

Validate host-generated configs before sending them. Each source folder contains a Draft 2020-12 schema and Python CLI. Install jsonschema, then run `python validate.py default.json` and `node --test tests/*.js` inside the folder. Orbit Patrol also supports its earlier Python validation suite via `python -m unittest discover -s tests`. Its example1.json and example2.json are legacy validation fixtures. Use default.json, fallout.json or party.json for embedding.
