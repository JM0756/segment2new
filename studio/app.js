const $=id=>document.getElementById(id);
const concepts={
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
function preview(game){
  const c=document.createElement('canvas');c.width=200;c.height=73;
  const ctx=c.getContext('2d'),[,,,ink,sky]=concepts[game]||['','','','#9bd8d1','#364d50'];
  ctx.fillStyle=sky;ctx.fillRect(0,0,200,73);
  for(let i=0;i<28;i++){ctx.fillStyle='#ffffff55';ctx.fillRect(i*43%199,i*17%40,1,1);}
  ctx.fillStyle=ink;ctx.fillRect(146,9,16,12);ctx.fillRect(149,6,10,18);
  for(let i=0;i<26;i++){const y=34+Math.round(6*Math.sin(i));ctx.fillStyle='#232b3c';ctx.fillRect(i*8,y,8,73-y);}
  ctx.fillStyle='#ffffff26';for(let i=0;i<9;i++)ctx.fillRect(i*28-14,55+i%2*7,16,1);
  if(game==='Alert-Dial'){ctx.fillStyle=ink;ctx.fillRect(95,21,5,33);ctx.fillRect(134,21,5,33);ctx.fillRect(95,21,44,5);for(let i=0;i<5;i++)ctx.fillRect(96+i*9,31,5,3);}
  if(game==='Claim-Inspector'){for(let i=0;i<3;i++){ctx.fillStyle=i===2?ink:'#8f89b1';ctx.fillRect(95+i*8,20+i*3,30,24);ctx.fillStyle=sky;ctx.fillRect(99+i*8,25+i*3,19,2);ctx.fillRect(99+i*8,31+i*3,13,2);}}
  if(game==='Feature-Classifier'){glyph(ctx,112,33,'#ebb89b',3);ctx.fillStyle='#a6d8c8';ctx.fillRect(39,51,42,2);}
  glyph(ctx,47,34,ink,3);return c;
}
const mascot=$('mascot').getContext('2d');glyph(mascot,1,3,'#dbfa90',3);
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
  $('main').append($('play'));$('play').hidden=true;$('stage').removeAttribute('src');
  $('thread').replaceChildren();$('thread').hidden=true;$('back').hidden=true;$('home').hidden=false;
  $('main').classList.remove('conversation');$('status').textContent='';$('send').disabled=false;
  $('theme').value='';$('theme').placeholder='Describe the setting or game you want to build…';
  $('game').disabled=false;resizeInput();$('theme').focus();
}
function turn(kind){
  const node=document.createElement('article');node.className='turn '+kind;
  node.setAttribute('aria-label',kind==='user'?'You':'Arcade Studio');$('thread').append(node);return node;
}
function artFor(item,file){
  const art=document.createElement('div');art.className='preview';art.append(preview(item.game));
  art.setAttribute('aria-hidden','true');
  if(item.thumbnail){const img=new Image();img.alt='';img.src=new URL(item.thumbnail,new URL(file,location.href));art.append(img);}
  return art;
}
function resultCard(item,file,where,summary){
  enterThread();
  const [category,,lesson]=concepts[item.game]||['ML arcade',item.game,item.game];
  where.replaceChildren();
  if(summary){const text=document.createElement('p');text.className='summary';text.textContent=summary;where.append(text);}
  const card=document.createElement('section');card.className='result';card.tabIndex=-1;card.setAttribute('aria-label',item.title);
  const body=document.createElement('div');body.className='card-body';
  for(const [tag,text] of [['span',category],['h3',item.title],['p',lesson]]){
    const el=document.createElement(tag);el.textContent=text;if(tag==='span')el.className='category';body.append(el);
  }
  const open=button('Play this version',mount);body.append(open);card.append(artFor(item,file),body);where.append(card);
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
function play(item,file,requested){
  active=item;
  const storageKey='arcade-progress-v1/'+item.game;
  unlocked=sessionUnlocks.get(item.game)||0;
  try{
    const stored=Number(localStorage.getItem(storageKey));
    if([0,1,2].includes(stored))unlocked=Math.max(unlocked,stored);
  }catch{}
  const baseline=items.find(i=>i.game===item.game&&!saved(i))||{title:item.game,levels:{1:'/arcade/'+item.game+'/source/default.json'}};
  const paths=[baseline.levels[1],item.levels[1]||baseline.levels[1],item.levels[2]||baseline.levels[2]];
  level=Progression.enter(unlocked,requested??(file&&file===item.levels[2]?2:1));
  if(!paths[level])level=1;
  path=paths[level];runId=crypto.randomUUID();
  $('play').hidden=false;
  $('remixToggle').hidden=!Progression.canRemix(level,unlocked);
  if(level>0&&Object.values(item.levels).includes(path))targetPath=path;
  const url=new URL('/arcade/'+item.game+'/source/index.html',location.origin);
  url.search=new URLSearchParams({config:path,mode:level?'level':'tutorial',level,game:item.game,run:runId});
  $('stage').src=url;$('stage').title=(level===0?baseline:item).title+' · '+(level?'Level '+level:'Tutorial');
  $('levels').replaceChildren(...['Tutorial','Level 1','Level 2'].map((name,n)=>{
    const locked=n>unlocked||!paths[n];
    const b=button(name+(locked?' 🔒':''),()=>play(item,paths[n],n));
    b.disabled=locked;b.setAttribute('aria-pressed',String(n===level));
    b.title=locked?(n===2?'Score ≥ 80% (3 Stars) in Level 1 to unlock Level 2':'Complete the tutorial first'):'';
    return b;
  }));
}
window.addEventListener('message',e=>{
  const m=e.data;
  if(!active||e.origin!==location.origin||e.source!==$('stage').contentWindow||m?.type!=='ARCADE_PROGRESS'||
      m.run!==runId||m.archetype!==active.game||m.level!==level)return;
  const next=Progression.complete(unlocked,level,m);
  if(next>unlocked||level===0&&m.passed){
    sessionUnlocks.set(active.game,next);unlocked=next;try{localStorage.setItem('arcade-progress-v1/'+active.game,String(next));}catch{}
    $('status').textContent=level===0?'Tutorial complete · Level 1 unlocked.':Math.floor(m.accuracy)+'% · ★★★ Level 2 unlocked.';
    play(active,null,level===0?1:next);
  }else if(level===1&&m.accuracy<80){
    $('status').textContent=Math.floor(m.accuracy)+'% · Replay Level 1 and score at least 80% to unlock Level 2.';
  }
});
function cards(){
  const library=items.filter(i=>concepts[i.game]&&!saved(i));
  $('catalog').replaceChildren(...library.map(i=>{
    const [cat,title,desc]=concepts[i.game]||['ML arcade',i.game,'Play the interactive activity.','#aadbd7'];
    const file=Object.values(i.levels)[0],b=button('Play '+title,()=>resultCard(i,file,turn('assistant')));b.textContent='';b.className='card';
    const art=artFor(i,file);
    const body=document.createElement('div');body.className='card-body';
    for(const [tag,text] of [['span',cat],['strong',saved(i)?i.title:title],['p',desc]]){
      const el=document.createElement(tag);el.textContent=text;if(tag==='span')el.className='category';body.append(el);
    }
    b.append(art,body);return b;
  }));
  const custom=items.filter(saved);$('savedList').replaceChildren(...custom.map(i=>button(i.title,()=>{$('saved').close();resultCard(i,Object.values(i.levels)[0],turn('assistant'));})));
  if(!custom.length)$('savedList').textContent='Your generated games will appear here.';
}
async function refresh(){
  const r=await fetch('/api/catalog');if(!r.ok)throw Error('Unable to load the game library.');
  const catalog=await r.json();items=catalog.items;showHealth(catalog.health);cards();
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
    if(!response.ok||!result.ok)throw Error('generation');
    // A saved turn remains playable if refreshing the library fails.
    try{await refresh();}catch{}
    if(id!==session)return;
    const item=items.find(i=>Object.values(i.levels).includes(result.config_path))||
      {game,title:result.config.theme.title,levels:{[Number(result.config_path.match(/_L([123])/)[1])]:result.config_path},thumbnail:result.config.theme.sprites?.class0_asset};
    resultCard(item,result.config_path,reply,result.summary||result.config.theme.setting);
    if(result.message){const note=document.createElement('p');note.textContent='The playable version is ready. Some requested extras could not be generated.';reply.append(note);}
    reply.scrollIntoView({block:'start',behavior:reduced()?'instant':'smooth'});
  }catch{
    if(id!==session)return;
    reply.textContent='I couldn’t finish this game. Check the gateway connection or revise your prompt.';
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
$('remixToggle').onclick=()=>$('theme').focus();
$('fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await $('play').requestFullscreen();}
  catch{$('status').textContent='Fullscreen is unavailable in this browser.';}
};
document.addEventListener('fullscreenchange',()=>{
  const full=Boolean(document.fullscreenElement);
  $('fullscreen').textContent=full?'Exit Fullscreen':'Launch Fullscreen';$('fullscreen').setAttribute('aria-pressed',String(full));
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
  if($('saved').open){$('saved').close();$('savedToggle').focus();return true;}
  for(const [id,trigger] of [['shortcuts','help'],['settings','gateway']]){
    if($(id).matches(':popover-open')){$(id).hidePopover();$(trigger).focus();return true;}
  }
  return false;
}
window.addEventListener('keydown',shortcuts);
$('stage').addEventListener('load',()=>{$('stage').contentDocument?.addEventListener('keydown',shortcuts);});
function showHealth(s){
  $('model').textContent='FreeLLMAPI / '+s.model;
  $('gateway').textContent=s.auth_required?'Gateway · key required':!s.online?'Gateway unavailable':
    s.http_status===200?'Gateway online':'Gateway · HTTP '+s.http_status;
  $('gateway').classList.toggle('online',s.online);
  if(!$('settings').matches(':popover-open'))$('baseUrl').value=s.base_url;
}
$('gatewayForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({base_url:$('baseUrl').value,api_key:$('apiKey').value})});
    const result=await response.json();if(!result.ok)throw Error(result.error);
    $('apiKey').value='';$('settingsMessage').textContent='';$('settings').hidePopover();showHealth(result);
  }catch(err){$('settingsMessage').textContent=err.message;}
};
async function status(){try{showHealth(await (await fetch('/api/health')).json());}catch{$('gateway').textContent='Gateway unavailable';}}
setInterval(status,30000);refresh().catch(e=>{$('status').textContent=e.message;});
