const panel=document.querySelector('section'), statusLine=document.querySelector('[role=status]'), dialog=document.querySelector('dialog');
let m,t,picks,origin,revision=0;
let submissions=0;
function emit(event,detail={}) {
  if(origin) parent.postMessage({type:'GAME_EVENT',archetype:'reward',event,detail},origin);
}
function button(parent,label,action) {
  const b=document.createElement('button');
  b.textContent=label; b.onclick=action; parent.append(b); return b;
}
function choices() { return m.weights.map(row => row.join(' / ')); }
function tutorial() {
  dialog.replaceChildren();
  const prompt=document.createElement('p'); prompt.textContent=t.tutorial+' '+t.practice; dialog.append(prompt);
  button(dialog,choices()[0],()=>{advance.disabled=false;});
  const advance=button(dialog,t.begin,()=>dialog.close()); advance.disabled=true;
  button(dialog,t.skip,()=>dialog.close()); dialog.showModal();
}
function render() {
  panel.replaceChildren();
  const description=document.createElement('p');
  description.append(t.axes+' · ');
  m.routes.forEach((route, i) => {
    if (i) description.append(' | ');
    ArcadeSprites.draw(description, i, spriteImages);
    description.append(t.options[i]+' '+route.join('/'));
  });
  panel.append(description);
  choices().forEach((label,i)=>{
    const b=button(panel,label,()=>{
      picks=[i];
      emit('action',{kind:'select',index:i}); render();
    });
    b.setAttribute('aria-pressed',String(picks.includes(i)));
  });
  button(panel,t.check,()=>{
    const won=evaluateSelection(m,picks);
    emit('action',{kind:'submit',picks:[...picks]});
    statusLine.textContent=won?t.success:t.failure; emit(won?'win':'fail');
    submissions++;
    const params=new URLSearchParams(window.location.search);
    if(won&&params.has('mode')){
      const level=Number(params.get('level')),accuracy=100/submissions,stars=accuracy>=80?3:accuracy>=60?2:1;
      parent.postMessage({type:'ARCADE_PROGRESS',archetype:params.get('game'),level,accuracy,stars,
        passed:level===0||stars===3,run:params.get('run')},'*');
    }
    if(won){panel.replaceChildren(); button(panel,t.again,()=>start(false));}
  });
  button(panel,t.hintLabel,()=>{statusLine.textContent=t.hint; emit('hint_shown');});
  button(panel,t.guide,tutorial);
}
function start(showGuide) {
  submissions=0;picks=[]; statusLine.textContent=''; document.querySelector('h1').textContent=t.title;
  document.documentElement.style.setProperty('--accent',t.accent); render(); emit('start');
  if(dialog.open) dialog.close();
  if(showGuide) tutorial();
}
let spriteImages = [];
async function load(config) {
  if(config.archetype!=='reward') throw Error('Wrong archetype');
  const current = ++revision;
  const sprites = config.theme?.sprites;
  const images = sprites?.class0_asset || sprites?.class1_asset
    ? await ArcadeSprites.preload(sprites, configPath) : [];
  if (current !== revision) return;
  spriteImages = images;
  m=config.mechanics;t=config.theme;start(true);
}
window.addEventListener('message',e=>{
  if(e.source!==parent || parent===window || e.data?.type!=='LOAD_CONFIG') return;
  if(origin && origin!==e.origin) return;
  origin=e.origin; load(e.data.config);
});
const configPath = new URLSearchParams(window.location.search).get('config') || 'default.json';
fetch(configPath).then(r=>r.json()).then(c=>{if(!revision) load(c);});
