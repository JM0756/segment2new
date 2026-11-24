// Studio and standalone launch URLs identify the same game across all of its levels.
const ArcadeTutorial = (() => {
  const completed = new Set();
  function gameId(path, base) {
    const pathname = new URL(path, base).pathname;
    const builtin = pathname.match(/^\/arcade\/([^/]+)\/source\/(?:default|level[123])\.json$/i);
    if (builtin) return builtin[1];
    const bundle = pathname.match(/\/([^/]+)\/([a-f0-9]{32})\/[^/]+\.json$/i);
    if (bundle) return bundle[1]+'/'+bundle[2];
    return pathname.replace(/_L[123]\.json$/i, '.json');
  }
  function has(id) {
    if (completed.has(id)) return true;
    try { return localStorage.getItem('arcade_tutorial_completed:'+id)==='1'; }
    catch { return false; }
  }
  function finish(id) {
    completed.add(id);
    try { localStorage.setItem('arcade_tutorial_completed:'+id,'1'); } catch {}
  }
  return {gameId,has,finish};
})();
