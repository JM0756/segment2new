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

// Level results are shared by Studio and standalone play on the same origin.
const ArcadeProgress = (() => {
  const memory=new Map();
  function read(id){
    const levels={...memory.get(id)};
    try{
      const stored=JSON.parse(localStorage.getItem('arcade_progress:'+id));
      for(const level of [1,2,3]){
        const row=stored?.[level];
        if(!Number.isInteger(row?.stars)||row.stars<0||row.stars>3||!Number.isSafeInteger(row.score)||row.score<0)continue;
        levels[level]={stars:Math.max(levels[level]?.stars||0,row.stars),score:Math.max(levels[level]?.score||0,row.score)};
      }
    }catch{}
    return levels;
  }
  function record(id,level,stars,score){
    if(![1,2,3].includes(level)||![0,1,2,3].includes(stars)||!Number.isSafeInteger(score)||score<0)return;
    const levels=read(id),best=levels[level];
    levels[level]={stars:Math.max(best?.stars||0,stars),score:Math.max(best?.score||0,score)};
    memory.set(id,levels);
    try{localStorage.setItem('arcade_progress:'+id,JSON.stringify(levels));}catch{}
  }
  function unlocked(levels){
    return levels[2]?.stars?3:levels[1]?.stars?2:1;
  }
  return {read,record,unlocked};
})();
