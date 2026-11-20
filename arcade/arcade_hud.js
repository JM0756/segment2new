'use strict';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let configPath=params.get('config')||'default.json', generation=0, config, round, images=[], view;
const tier=Number(params.get('level')??(configPath.match(/(?:level|_L)([123])\.json$/)?.[1]||1));
const tutorialMode=params.get('mode')==='tutorial';
let reported=false, passed=false, guideStep=-1, lines=[], practiceActors=[];
let feedback=null, pulse=0, arrival=0, origin, hits=[];
const canvas=$('arena'),ctx=canvas.getContext('2d');
function emit(event,detail={}) {
  if(origin) parent.postMessage({type:'GAME_EVENT',archetype:config.archetype,event,detail},origin);
}
function button(label,fn) {
  const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;
}
function action(fn) {
  if(!round)return;
  const last=view.target;
  const outcome=fn();pulse=performance.now();
  if(outcome && hits[outcome.actor])feedback=ArcadeHUD.spawnCallout(hits[outcome.actor],outcome,pulse);
  view=round.view();
  if(last!==view.target)arrival=pulse;
  if(!view.done){passed=false;reported=false;}
  if(view.done&&!reported){
    const fieldSolved=config.archetype!=='classifier'||view.success;
    passed=fieldSolved&&view.accuracy>=80;
    report('ARCADE_PROGRESS',passed,view.accuracy);
    reported=true;
  }
  emit('action');
  if(view.done)emit(passed?'win':'fail');
  else if(outcome?.correct===false)emit('fail');
  render();
}
function report(type,won,accuracy){
  if(params.has('mode'))parent.postMessage({type,archetype:params.get('game'),level:tier,accuracy,
    stars:accuracy>=80?3:accuracy>=60?2:1,passed:won,run:params.get('run')},location.origin);
}
function guideInput(key){
  const next=ArcadeNarrator.next(guideStep,key);
  if(next===guideStep)return;
  if(typeof key==='number'&&hits[key]){
    const response={actor:key,correct:true,text:key===0?'FIRST EXAMPLE':'SECOND EXAMPLE'};
    feedback=ArcadeHUD.spawnCallout(hits[key],response,performance.now());
  }
  guideStep=next;
  if(guideStep===3&&tutorialMode&&!passed){passed=true;report('ARCADE_PROGRESS',true,100);}
  render();
}
function choose(i){
  if(guideStep>=0){guideInput(i);return;}
  action(()=>round.act(i));
}
function submit(){
  if(guideStep===0)guideInput('continue');
  else if(guideStep===3)finishGuide();
  else if(guideStep<0&&!view.done)action(()=>round.submit());
}
function advance(){
  if(!passed || tier>=3)return;
  if(params.has('mode')){
    report('ARCADE_NEXT',true,tutorialMode?100:view.accuracy);
    return;
  }
  const url=new URL(location.href),next=tier+1;
  const generated=configPath.match(/^(.*)_L[123]\.json$/);
  url.searchParams.set('config',params.get('next')||(generated?generated[1]+'_L'+next+'.json':'level'+next+'.json'));
  url.searchParams.set('level',next);url.searchParams.delete('next');location.assign(url);
}
function finishGuide(){
  if(tutorialMode){passed=true;report('ARCADE_PROGRESS',true,100);advance();return;}
  guideStep=-1;feedback=null;arrival=performance.now();render();
}
function render() {
  view=round.view();
  const guided=guideStep>=0;
  $('title').textContent=config.theme.title;
  $('phase').textContent=tutorialMode?'Tutorial':'Level '+tier+' · '+view.phase;
  const scoreLabels=view.teamNames||(config.archetype==='threshold'?['Hits','False alarms']:['Verified','Errors']);
  for(let i=0;i<2;i++)$('team'+i).textContent=scoreLabels[i]+' '+view.score[i];
  $('subject').textContent=guided?'':view.subject;
  $('detail').textContent=guided?'':view.detail||'';
  $('metric').textContent=view.metric+' '+view.value+'%';
  $('meter').style.setProperty('--value',view.value+'%');
  $('guide').hidden=!guided;
  $('instruction').textContent=guided?lines[guideStep]:'';
  $('continue').hidden=guideStep!==0 && (guideStep!==3||tutorialMode);
  $('continue').textContent=guideStep===3?'Resume →':'Continue →';
  $('skip').hidden=guideStep===3;
  $('help').hidden=guided;
  $('callout').textContent=guided?'':view.note;
  $('actions').replaceChildren();
  const actions=guideStep===3?[]:guided?view.actions.slice(0,2):view.actions;
  actions.forEach((label,i)=>{
    const key='['+(i+1)+']';
    const b=button(guided?key:key+' '+label,()=>choose(i));
    if(guided)b.setAttribute('aria-label',key+' '+label);
    b.disabled=guided?guideStep!==i+1:view.done||view.field;
    b.setAttribute('aria-pressed',String(view.picks?.includes(i)||view.selected===i));
    if(i<2)ArcadeHUD.drawAvatarIcon(b,images[i],{theme:config.theme,slot:i},32);
    $('actions').append(b);
  });
  if(tutorialMode&&guideStep===3)$('actions').append(button('Next Level →',finishGuide));
  if(!guided){
    if(!view.instant){const trigger=button('[SPACE] '+view.submit,submit);trigger.disabled=view.done;$('actions').append(trigger);}
    if(passed&&tier<3)$('actions').append(button('Next Level →',advance));
    if(view.field && !passed)$('actions').append(button('Retrain balanced',()=>{reported=false;action(()=>round.retrain());}));
    if(view.done)$('actions').append(button('Replay',()=>start(config,configPath)));
  }
  $('dial').hidden=guided||!view.range;
  if(view.range){$('slider').max=view.range[1];$('slider').value=view.range[0];}
  $('sources').hidden=guided||!view.sources;
  if(view.sources && $('sources').childElementCount===0){
    view.sources.forEach((source,i)=>{
      const b=button('Source '+(i+1),()=>{b.textContent=source;action(()=>round.inspect());});
      $('sources').append(b);
    });
  }
}
let worldWidth=560,worldHeight=245;
let scenery;
function resizeCanvas(){
  const dpr=window.devicePixelRatio||1;
  const width=Math.max(1,Math.round(canvas.clientWidth*dpr));
  const height=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==width || canvas.height!==height){
    canvas.width=width;canvas.height=height;
  }
  worldWidth=Math.min(660,Math.max(320,canvas.clientWidth));
  worldHeight=worldWidth*height/width;
  ctx.setTransform(width/worldWidth,0,0,height/worldHeight,0,0);
  ctx.imageSmoothingEnabled=true;
}
function paint(now){
  requestAnimationFrame(paint);if(!round)return;
  resizeCanvas();
  const w=worldWidth,h=worldHeight;
  ctx.save();
  if(feedback&&now-feedback.start>=700)feedback=null;
  const zoom=Math.max(w/scenery.width,h/scenery.height);
  const sw=scenery.width*zoom,sh=scenery.height*zoom;
  ArcadeEnvironment.blit(ctx,scenery,(w-sw)/2,(h-sh)/2,sw,sh);
  const actors=guideStep>=0?practiceActors:view.actors||view.names.slice(0,2).map((label,slot)=>({slot,label}));
  hits=[];
  actors.forEach((actor,i)=>{
    const effect=feedback?.actor===i?feedback:null;
    const {label,slot,station}=effect?.entity||actor;
    const vx=station?0:(i%2?-1:1),age=Math.max(0,now-arrival);
    const walking=actor.pace?Math.sin(age*actor.pace/1600)*w*.26:0;
    const x=effect?.x??walking+Math.round((i+1)*w/(actors.length+1)-vx*45*Math.max(0,1-age/900));
    const y=effect?.y??(h/2+(i%2?12:-6));
    if(guideStep===i+1){
      ctx.strokeStyle='#ffe18c';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y+10,22,7,0,0,2*Math.PI);ctx.stroke();
    }
    const pose=ArcadeHUD.pose(now,i,vx,age,effect);
    ctx.fillStyle='#142d3680';ctx.beginPath();ctx.ellipse(x,y+12,14*pose.shadow,4*pose.shadow,0,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(x+pose.dx,y+11+pose.dy);ctx.rotate(pose.tilt);ctx.scale(pose.sx,pose.sy);
    const art=(effect?.entity||actor).art??slot;
    const image=images[art],framed=image?.naturalWidth===128 && image.naturalHeight===128;
    const size=framed?44:36;
    ctx.translate(-size/2,-size*(framed?116/128:1));
    ArcadeHUD.drawAvatarIcon(ctx,image,{theme:config.theme,slot:art},size);
    ctx.restore();
    if(actor.sample!==undefined){
      ctx.save();ctx.translate(x+12,y-4+pose.dy);ctx.rotate(Math.PI/4);
      ctx.fillStyle='#132436';ctx.fillRect(-6,-6,12,12);
      ctx.fillStyle=actor.sample?'#ff936f':'#80f5c4';ctx.fillRect(-4,-4,8,8);
      if(actor.sample){ctx.fillStyle='#182c3d';ctx.fillRect(-1,-5,2,5);ctx.fillRect(0,0,3,5);}ctx.restore();
    }
    ctx.font='600 '+Math.max(11,13*w/canvas.clientWidth)+'px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign='center';const name=String(label).slice(0,36),width=ctx.measureText(name).width+10;
    const pillHeight=Math.max(18,20*w/canvas.clientWidth);
    const center=Math.max(width/2+2,Math.min(w-width/2-2,x));
    ctx.fillStyle='#162831';ctx.beginPath();ctx.roundRect(center-width/2,y+16,width,pillHeight,pillHeight/2);ctx.fill();
    ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(name,center,y+16+pillHeight/2);ctx.textBaseline='alphabetic';
    hits.push({x,y,...actor});
  });
  if(feedback)ArcadeHUD.drawCallout(ctx,feedback,now);
  ctx.restore();
}
async function start(data,path){
  if(data.archetype==='orbit')data={...data,archetype:'classifier'};
  const id=++generation;
  const [loaded,background]=await Promise.all([
    ArcadeSprites.preload(data.theme,path),
    ArcadeSprites.loadImage(data.theme.backgroundSprite,path)
  ]);
  if(id!==generation)return;
  scenery=document.createElement('canvas');scenery.width=560;scenery.height=245;
  const painter=scenery.getContext('2d');
  if(background?.naturalWidth)ArcadeEnvironment.backdrop(painter,scenery.width,scenery.height,background);
  else ArcadeEnvironment.drawArenaBackground(painter,scenery.width,scenery.height,data.theme);
  reported=false;passed=false;feedback=null;hits=[];config=data;configPath=path;images=loaded;round=createRound(data);arrival=performance.now();
  lines=ArcadeNarrator.lines(data);practiceActors=ArcadeNarrator.actors(data);guideStep=tutorialMode||(!params.has('level')&&!params.has('mode'))?0:-1;
  $('sources').replaceChildren();render();emit('start');
}
canvas.onclick=e=>{
  const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)*worldWidth/b.width,y=(e.clientY-b.top)*worldHeight/b.height;
  const hit=hits.find(h=>Math.abs(x-h.x)<22&&Math.abs(y-h.y)<32);
  if(hit&&hit.slot<2&&(guideStep>=0||typeof round.retrain==='function'))choose(hit.slot);
};
function showGuide(){feedback=null;guideStep=0;emit('hint_shown');render();}
$('help').onclick=showGuide;
$('continue').onclick=()=>guideStep===3?finishGuide():guideInput('continue');
$('skip').onclick=finishGuide;
$('slider').oninput=e=>action(()=>round.tune(Number(e.target.value)));
window.addEventListener('keydown',e=>{
  if(!round||e.repeat||e.target.matches('input')&&e.code!=='Space')return;
  if(e.key==='?'){showGuide();return;}
  if(e.code==='Space'){e.preventDefault();submit();return;}
  const n=/^[1-9]$/.test(e.key)?Number(e.key)-1:({ArrowLeft:0,ArrowRight:1})[e.key];
  if(n!==undefined && n<view.actions.length){e.preventDefault();choose(n);}
});
window.addEventListener('message',e=>{
  if(parent===window||e.source!==parent||e.data?.type!=='LOAD_CONFIG'||origin&&e.origin!==origin)return;
  origin=e.origin;start(e.data.config,configPath);
});
fetch(configPath).then(r=>r.json()).then(c=>{if(!generation)return start(c,configPath);}).catch(e=>{$('subject').textContent='Unable to load activity: '+e.message;});
requestAnimationFrame(paint);
