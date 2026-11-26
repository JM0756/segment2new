const $=id=>document.getElementById(id);
const concepts={
  'Signal-Sorter':['Training data quality','Signal Sorter','Accept clean samples and filter noisy labels at the Space Lab.'],
  'Feature-Classifier':['Overfitting','Feature Classifier','Train a classifier to see past misleading patterns.','#b7dc99','#374d58'],
  'Alert-Dial':['Thresholds','Alert Dial','Tune a checkpoint to catch incidents with fewer false alarms.','#ffb876','#684248'],
  'Claim-Inspector':['Fact-Checking','Claim Inspector','Compare incoming claims with the source evidence.','#c0b4ff','#524c76']
};
let items=[],active,path,level=0,unlocked=0,runId,busy=false;
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',text);b.onclick=fn;return b;}
function glyph(ctx,x,y,color,scale=1){
  const rows=['  XXXXX  ',' XXXXXXX ','XX XX XXX','XXXXXXXXX','  XXXXX  ','  X   X  '];
  ctx.fillStyle=color;
  rows.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='X')ctx.fillRect(x+i*scale,y+j*scale,scale,scale);}));
}
const mascot=$('mascot').getContext('2d');glyph(mascot,1,3,'#dbfa90',3);
glyph($('remixMascot').getContext('2d'),1,3,'#dbfa90',3);
const tile=document.createElement('canvas');tile.width=96;tile.height=80;glyph(tile.getContext('2d'),28,28,'#fff');
document.body.style.setProperty('--matrix','url('+tile.toDataURL()+')');
function saved(item){return Object.values(item.levels)[0].startsWith('/generated/');}
let currentCard=null, targetPath=null, session=0, pendingTimer;
const words=['Thinking…','Designing world…','Shaping rules…','Balancing difficulty…','Crafting cosmetics…','Polishing sprites…','Checking mechanics…','Almost ready…'];
const modes=['dark','light','invert'];
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function enterThread(){
  $('home').hidden=true;$('thread').hidden=false;$('back').hidden=false;
  $('main').classList.add('conversation');
}
function resizeInput(){
  const input=$('theme');input.style.height='auto';
  input.style.height=Math.min(120,Math.max(32,input.scrollHeight))+'px';
}
function home(){
  session++;clearInterval(pendingTimer);busy=false;active=null;path=null;targetPath=null;currentCard=null;
  closeChat();$('main').append($('play'));$('play').hidden=true;$('stage').removeAttribute('src');
  $('thread').replaceChildren();$('thread').hidden=true;$('back').hidden=true;$('home').hidden=false;
  $('main').classList.remove('conversation');$('status').textContent='';$('send').disabled=false;
  $('theme').value='';$('theme').placeholder='Describe the setting or game you want to build…';
  $('game').disabled=false;resizeInput();$('theme').focus();
}
function turn(kind){
  const node=document.createElement('article');node.className='turn '+kind;
  node.setAttribute('aria-label',kind==='user'?'You':'Arcade Studio');$('thread').append(node);return node;
}
function renderCardBanner(item,file,result=false){
  const theme=item.config?.theme||item;
  const art=document.createElement('div');
  art.className=result?'card-banner result-banner':'card-banner';
  art.setAttribute('aria-hidden','true');
  const scene=document.createElement('canvas');
  scene.width=640;scene.height=240;
  ArcadeEnvironment.drawArenaBackground(scene.getContext('2d'),640,240,theme,{banner:true});
  art.append(scene);
  function load(asset,onLoad){
    if(!asset)return;
    const image=new Image();
    image.onload=()=>onLoad(image);
    image.src=new URL(asset,new URL(file,location.href)).href;
  }
  load(theme.backgroundImage||theme.backgroundSprite,image=>ArcadeEnvironment.backdrop(scene.getContext('2d'),640,240,image));
  if(item.game==='Signal-Sorter'&&!theme.backgroundImage&&!theme.backgroundSprite){
    const painter=scene.getContext('2d');
    for(const [x,color] of [[236,'#8ff6ca'],[395,'#ff9b79']]){
      painter.fillStyle='#203c55';painter.fillRect(x,113,18,18);
      painter.fillStyle=color;painter.fillRect(x+3,116,12,12);
      if(x>300){painter.fillStyle='#203c55';painter.fillRect(x+8,115,3,10);}
    }
  }
  for(const slot of [0,1]){
    const actor=document.createElement('span');actor.className='banner-actor';
    const spec={theme,slot,facing:slot===0?1:-1};
    const draw=image=>{
      actor.replaceChildren();
      ArcadeEnvironment.drawAvatarIcon(actor,image,spec,88);
    };
    draw(null);
    art.append(actor);
    load(theme['class'+slot+'Sprite']||theme.sprites?.['class'+slot+'_asset'],draw);
  }
  return art;
}
function resultCard(item,file,where,summary){
  enterThread();
  const [category,,lesson]=concepts[item.game]||['ML arcade',item.game,item.game];
  where.replaceChildren();
  if(summary){const text=document.createElement('p');text.className='summary';text.textContent=summary;where.append(text);}
  const card=document.createElement('section');card.className='result result-card';card.tabIndex=-1;card.setAttribute('aria-label',item.title);
  const body=document.createElement('div');body.className='card-body';
  for(const [tag,text] of [['span',category],['h3',item.title],['p',item.subtitle||lesson]]){
    const el=document.createElement(tag);el.textContent=text;if(tag==='span')el.className='category';body.append(el);
  }
  const open=button('Play this version',mount);body.append(open);
  if(file.startsWith('/generated/.tmp/')){
    const save=button('Save Game',async()=>{
      save.disabled=true;
      try{
        const result=await libraryRequest('/api/save-game','POST',item.game,file);
        if(targetPath===file)targetPath=result.config_path;
        file=result.config_path;item.levels=result.levels;item.preview_path=file;
        save.textContent='Saved';await refresh();
      }catch(err){save.disabled=false;$('status').textContent=err.message;}
    });
    body.append(save);
  }
  card.append(renderCardBanner(item,file,true),body);where.append(card);
  function mount(){
    if(currentCard)currentCard.hidden=false;currentCard=open;open.hidden=true;
    card.append($('play'));targetPath=file;$('game').value=item.game;$('game').disabled=true;
    $('sprites').checked=Boolean(item.thumbnail);$('theme').placeholder='Describe a change to this game…';
    play(item,file);$('status').textContent='';
    if(!summary||document.activeElement===open)card.focus();
  }
  mount();
}
const sessionUnlocks=new Map();
let passedRun=false,activeGameId;
function closeChat(){
  $('stageChat').hidden=true;$('remixToggle').setAttribute('aria-expanded','false');
}
function play(item,file,requested,started=false){
  active=item;closeChat();passedRun=false;
  const first=item.levels[1]||file;
  const paths=[item.preview_path||first,first,item.levels[2],item.levels[3]];
  const lastLevel=paths[2]?(paths[3]?3:2):1;
  activeGameId=ArcadeTutorial.gameId(first,location.origin);
  const classifier=item.game==='Feature-Classifier';
  unlocked=sessionUnlocks.get(classifier?activeGameId:item.game)||0;
  if(!classifier||activeGameId===item.game){
    try{
      const stored=Number(localStorage.getItem('arcade-progress-v1/'+item.game));
      if([0,1,2,3].includes(stored))unlocked=Math.max(unlocked,stored);
    }catch{}
  }
  if(classifier)unlocked=Math.max(unlocked,ArcadeProgress.unlocked(ArcadeProgress.read(activeGameId)));
  const tutorialComplete=ArcadeTutorial.has(activeGameId);
  if(tutorialComplete)unlocked=Math.max(1,unlocked);
  level=tutorialComplete?Progression.enter(Math.min(unlocked,lastLevel),requested||1):0;
  path=paths[level];runId=crypto.randomUUID();
  $('play').hidden=false;$('remixToggle').hidden=!Progression.canRemix(level,unlocked);
  if(Object.values(item.levels).includes(path))targetPath=path;
  const url=new URL('/arcade/'+item.game+'/source/index.html',location.origin);
  url.search=new URLSearchParams({config:path,mode:level?'level':'tutorial',level,lastLevel,game:item.game,gameId:activeGameId,run:runId});
  if(classifier){
    if(started)url.searchParams.set('started','1');
    url.searchParams.set('unlocked',Math.min(lastLevel,unlocked));
    url.searchParams.set('progress',JSON.stringify(ArcadeProgress.read(activeGameId)));
  }
  if(level>0 && tutorialComplete)url.searchParams.set('transition','1');
  $('resumeLevel').hidden=level===0||Math.min(unlocked,lastLevel)<=level;
  $('resumeLevel').textContent='Resume Level '+Math.min(unlocked,lastLevel);
  $('stage').src=url;$('stage').title=item.title+' · '+(level?'Level '+level:'Tutorial');
}
window.addEventListener('message',e=>{
  const m=e.data;
  if(!active||e.origin!==location.origin||e.source!==$('stage').contentWindow||
      m?.run!==runId||m.archetype!==active.game||m.level!==level)return;
  const classifier=active.game==='Feature-Classifier';
  if(classifier&&m.type==='ARCADE_SELECT'){
    if(level>0&&Number.isInteger(m.targetLevel)&&m.targetLevel>=1&&m.targetLevel<=unlocked&&active.levels[m.targetLevel])
      play(active,null,m.targetLevel,true);
    return;
  }
  if(m.type==='ARCADE_NEXT'){
    if(passedRun&&level<3)play(active,null,level+1,true);
    return;
  }
  if(m.type!=='ARCADE_PROGRESS')return;
  passedRun=m.passed&&(level===0||m.accuracy>=75&&m.stars>=(classifier?1:2));
  if(classifier&&level>0){
    ArcadeProgress.record(activeGameId,level,passedRun?m.stars:0,m.score??0);
    unlocked=Math.max(unlocked,ArcadeProgress.unlocked(ArcadeProgress.read(activeGameId)));
  }
  unlocked=Progression.complete(unlocked,level,m);
  if(level===0 && passedRun)ArcadeTutorial.finish(activeGameId);
  sessionUnlocks.set(classifier?activeGameId:active.game,unlocked);
});
$('resumeLevel').onclick=()=>play(active,null,unlocked);
let saveTimer;
$('saveProgress').onclick=()=>{
  if(!active)return;
  const control=$('saveProgress');
  let status;
  try{
    if(active.game==='Feature-Classifier'){
      localStorage.setItem('arcade_progress:'+activeGameId,JSON.stringify(ArcadeProgress.read(activeGameId)));
    }
    if(active.game!=='Feature-Classifier'||activeGameId===active.game){
      localStorage.setItem('arcade-progress-v1/'+active.game,String(unlocked));
    }
    control.dataset.saved='true';
    status='Progress saved';
  }catch{delete control.dataset.saved;status='Storage unavailable';}
  control.title=status;control.setAttribute('aria-label',status);
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    delete control.dataset.saved;
    control.title='Save progress';control.setAttribute('aria-label',control.title);
  },1500);
};
async function libraryRequest(endpoint,method,game,path){
  const response=await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({game,path})});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error(result.error||'The library could not be updated.');
  return result;
}
function cards(){
  const library=items.filter(i=>concepts[i.game]&&!saved(i));
  $('catalog').replaceChildren(...library.map(i=>{
    const [cat,title,desc]=concepts[i.game]||['ML arcade',i.game,'Play the interactive activity.','#aadbd7'];
    const file=Object.values(i.levels)[0],b=button('Play '+title,()=>resultCard(i,file,turn('assistant')));b.textContent='';b.className='card game-card';
    const art=renderCardBanner(i,file);
    const body=document.createElement('div');body.className='card-body';
    for(const [tag,text] of [['span',cat],['strong',saved(i)?i.title:title],['p',desc]]){
      const el=document.createElement(tag);el.textContent=text;if(tag==='span')el.className='category';body.append(el);
    }
    if(i.game==='Signal-Sorter'){
      const icon=document.createElement('canvas');icon.width=18;icon.height=16;icon.className='sorter-mascot';
      icon.setAttribute('aria-hidden','true');glyph(icon.getContext('2d'),0,0,'#8ae1b4',2);body.append(icon);
    }
    b.append(art,body);return b;
  }));
  const custom=items.filter(saved);$('savedList').replaceChildren(...custom.map(i=>{
    const file=i.preview_path||Object.values(i.levels)[0];
    const card=button(i.title,()=>{$('saved').close();resultCard(i,file,turn('assistant'));});
    card.className='card game-card';const name=document.createElement('strong');name.className='card-body';name.textContent=i.title;
    card.replaceChildren(renderCardBanner(i,file),name);
    const row=document.createElement('div');row.className='saved-game';
    const remove=button('Delete',async()=>{
      if(!window.confirm('Delete “'+i.title+'” and its saved artwork?'))return;
      remove.disabled=true;
      try{
        await libraryRequest('/api/saved-game','DELETE',i.game,file);
        if(active&&Object.values(active.levels).includes(file))home();
        await refresh();
      }catch(err){remove.disabled=false;$('status').textContent=err.message;}
    });
    row.append(card,remove);return row;
  }));
  if(!custom.length)$('savedList').textContent='Games you save will appear here.';
}
async function refresh(){
  const r=await fetch('/api/catalog');if(!r.ok)throw Error('Unable to load the game library.');
  const catalog=await r.json();items=catalog.items;$('model').textContent='FreeLLMAPI / '+catalog.health.model;cards();
  const selected=$('game').value;
  $('game').replaceChildren(...[...new Set(items.map(i=>i.game))].map(g=>new Option(concepts[g]?.[1]||g,g)));
  if(selected)$('game').value=selected;
}
async function send(e){
  e.preventDefault();
  const prompt=$('theme').value.trim();if(busy||!prompt)return;
  const id=session,chat=Boolean(active),game=chat?active.game:$('game').value;
  const data=chat?{game,path:targetPath,message:prompt,sprites:$('sprites').checked}:
    {game,topic:concepts[game]?.[0]||game,theme:prompt,sprites:$('sprites').checked,pair:true};
  busy=true;$('send').disabled=true;enterThread();$('status').textContent='';
  turn('user').textContent=prompt;
  const reply=turn('assistant'),thinking=document.createElement('span');
  thinking.className='thinking';thinking.setAttribute('aria-live','polite');thinking.setAttribute('aria-atomic','true');
  let step=0;thinking.textContent=words[step];reply.append(thinking);
  if(!reduced())pendingTimer=setInterval(()=>{thinking.textContent=words[++step%words.length];},1600);
  $('theme').value='';resizeInput();$('theme').focus();reply.scrollIntoView({block:'nearest'});
  try{
    const response=await fetch('/api/'+(chat?'chat-refine':'generate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();
    if(id!==session)return;
    if(!response.ok||!result.ok)throw Error(result.error||'Generation failed (HTTP '+response.status+').');
    // A saved turn remains playable if refreshing the library fails.
    try{await refresh();}catch{}
    if(id!==session)return;
    const catalogItem=items.find(i=>Object.values(i.levels).includes(result.config_path));
    const theme=result.config.theme;
    const tier=Number(result.config_path.match(/_L([123])\.json$/)?.[1]||1);
    const item={...catalogItem, game, title:theme.title||catalogItem?.title, subtitle:theme.subtitle,
      levels:result.levels||catalogItem?.levels||{[tier]:result.config_path}, environment:theme.environment,
      config:result.config, thumbnail:theme.class0Sprite||theme.sprites?.class0_asset};
    resultCard(item,result.config_path,reply,result.summary||result.config.theme.setting);
    if(result.message){const note=document.createElement('p');note.textContent=result.message;reply.append(note);}
    reply.scrollIntoView({block:'start',behavior:reduced()?'instant':'smooth'});
  }catch(error){
    if(id!==session)return;
    reply.textContent=error.message;
    reply.append(button('Edit and retry',()=>{$('theme').value=prompt;resizeInput();$('theme').focus();}));
  }finally{
    if(id===session){clearInterval(pendingTimer);busy=false;$('send').disabled=false;}
  }
}
$('composer').onsubmit=send;
$('theme').oninput=resizeInput;
$('theme').onkeydown=e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.isComposing&&e.keyCode!==229){
    e.preventDefault();$('composer').requestSubmit();
  }
};
$('back').onclick=home;$('savedToggle').onclick=()=>$('saved').showModal();$('close').onclick=()=>$('saved').close();
$('remixToggle').onclick=()=>{
  if(!$('stageChat').hidden){closeChat();return;}
  $('stageChat').hidden=false;$('remixToggle').setAttribute('aria-expanded','true');$('remixText').focus();
};
$('stageChat').onsubmit=async e=>{
  e.preventDefault();
  const prompt=$('remixText').value.trim();
  if(!prompt||busy)return;
  $('theme').value=prompt;$('remixText').value='';closeChat();
  if(document.fullscreenElement)await document.exitFullscreen();
  await send(e);
};
$('fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await $('play').requestFullscreen();}
  catch{$('status').textContent='Fullscreen is unavailable in this browser.';}
};
document.addEventListener('fullscreenchange',()=>{
  closeChat();
  $('stage').focus();
  const full=Boolean(document.fullscreenElement);
  $('fullscreen').setAttribute('aria-label',full?'Exit fullscreen':'Enter fullscreen');
  $('fullscreen').setAttribute('aria-pressed',String(full));
});
function themeMode(mode){
  document.documentElement.dataset.theme=mode;
  for(const m of modes)$('mode-'+m).setAttribute('aria-pressed',String(m===mode));
}
function choose(mode){
  themeMode(mode);try{localStorage.setItem('studio-theme',mode);}catch{}
}
let preferred=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
try{const stored=localStorage.getItem('studio-theme');if(modes.includes(stored))preferred=stored;}catch{}
themeMode(preferred);
for(const mode of modes)$('mode-'+mode).onclick=()=>choose(mode);
function shortcuts(e){
  if(e.defaultPrevented||e.isComposing)return;
  const key=e.key.toLowerCase(),editing=e.target.matches('input,textarea,select,[contenteditable=true]');
  if(e.altKey&&key==='t'){e.preventDefault();choose(modes[(modes.indexOf(document.documentElement.dataset.theme)+1)%3]);}
  else if(e.altKey&&key==='h'){e.preventDefault();dismiss();home();}
  else if(key==='escape'){e.preventDefault();if(!dismiss())$('theme').focus();}
  else if(((e.metaKey||e.ctrlKey)&&key==='k')||(key==='/'&&!editing)){
    e.preventDefault();dismiss();$('theme').focus();
  }
}
function dismiss(){
  if(!$('stageChat').hidden){closeChat();$('remixToggle').focus();return true;}
  if($('saved').open){$('saved').close();$('savedToggle').focus();return true;}
  return false;
}
window.addEventListener('keydown',shortcuts);
$('stage').addEventListener('load',()=>{
  $('stage').contentDocument?.addEventListener('keydown',shortcuts);
  if(active&&!$('play').hidden)$('stage').focus();
});
refresh().catch(e=>{$('status').textContent=e.message;});
