'use strict';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let configPath=params.get('config')||'default.json', generation=0, config, round, images=[], view;
const tier=Number(params.get('level')??(configPath.match(/(?:level|_L)([123])\.json$/)?.[1]||1));
let gameId=params.get('gameId')||ArcadeTutorial.gameId(configPath,window.location.href);
const lastLevel=Number(params.get('lastLevel')||3);
const tutorialMode=params.get('mode')==='tutorial';
let reported=false, passed=false, guideStep=-1, lines=[], practiceActors=[];
let escortMode,lastChoice,cohort,world,lowProfile,hover=null;
const entryPaths=new Map(),held=new Set();
let savedPilot=null,land,spawnUntil=-Infinity;
const floorTop=()=>worldHeight*.43, floorHeight=()=>worldHeight*.37;
let pilot=null,frameTime=0,track=[],lastMark=0;
const movement={a:[-1,0],d:[1,0],w:[0,-1],s:[0,1],arrowleft:[-1,0],arrowright:[1,0],arrowup:[0,-1],arrowdown:[0,1]};
function takeControl(){
  if(guideStep>2 || guideStep<0&&(view.field||view.done) || !world.grid)return false;
  if(!pilot){
    const hit=hits.find(h=>!h.station),p=hit?{x:hit.x/mapWidth(),y:(hit.y+11)/floorHeight()}:world.structures.entry;
    pilot=WorldEngine.controller(world,p);
  }
  return true;
}
function signs(){
  const choices=guideStep>=0?practiceActors.slice(0,2).map(a=>a.label):view.actions;
  return choices.map((label,i)=>{
    const side=i%2,z=ArcadeWorld.zone(world,side);
    const count=Math.ceil((choices.length-side)/2);
    const row=Math.floor(i/2),offset=Math.ceil(row/2)*(row%2?-1:1);
    return {x:z.x,y:z.y+offset*Math.min(.22,.8/count),label,index:i};
  });
}
function inspectHere(){
  scanTime=performance.now();
  if(guideStep>=0)guideInput('inspect');
  else {
    if(round.inspect)action(()=>round.inspect(),true);
    $('detail').textContent=[view.subject,view.detail,...(view.legend||[]),...(view.sources||[])].filter(Boolean).join(' · ');
  }
}
function legacyInteract(space=false){
  if(guideStep>=3){if(space)submit();return;}
  if(guideStep<0 && (view.done||view.field)){if(space)submit();return;}
  if(!takeControl())return;
  const pos=pilot.pos(),target=WorldEngine.nearby(pos,signs());
  if(space && guideStep<0 && view.readyToSubmit && (!target||lastChoice===target.index)){submit();return;}
  if(target){
    targetPulse[target.index%2]=performance.now();
    if(guideStep>=0){guideInput('classify');held.clear();}
    else choose(target.index);
  }else if(!space && WorldEngine.nearby(pos,[world.structures.checkpoint,...inspectablePoints()]))inspectHere();
}
function inspectablePoints(){
  const controlled=hits.findIndex(h=>!h.station);
  return hits.filter((h,i)=>!h.station && i!==controlled).map(h=>({x:h.x/mapWidth(),y:(h.y+11)/floorHeight()}));
}
function interactionTarget(){
  if(!escortMode || guideStep>2 || guideStep<0 && (view.field||view.done))return null;
  const pos=pilot.pos();
  const bay=WorldEngine.nearby(pos,signs());
  if(bay)return {point:bay,type:'bay',hint:pilot.tethered?'Deliver to '+bay.label:view.readyToSubmit?'[Space] '+view.submit:'Collect the item at the scanner first.'};
  const pad=world.structures.checkpoint;
  if(WorldEngine.nearby(pos,[pad]))return {point:pad,type:'pad',hint:pilot.tethered?'Deep scan':'Inspect and tether'};
  const vent=WorldEngine.nearby(pos,world.hazards);
  if(vent)return {point:vent,type:'vent',hint:vent.active?'Disable vent':'Enable vent'};
  return null;
}
function interactHere(space=false){
  if(!escortMode)return legacyInteract(space);
  if(guideStep>=3){if(space)submit();return;}
  if(guideStep<0 && (view.done||view.field)){if(space)submit();return;}
  const target=interactionTarget();
  if(target?.type==='pad'){
    const alreadyAttached=pilot.tethered;
    pilot.inspect();scanTime=performance.now();
    if(guideStep>=0)guideInput('inspect');
    else if(!alreadyAttached && round.inspect)action(()=>round.inspect(),true);
    render();
  }else if(target?.type==='vent' && !space){
    target.point.active=!target.point.active;
  }else if(target?.type==='bay' && pilot.tethered){
    const bay=target.point;
    const actor=(guideStep>=0?practiceActors:view.actors).find(a=>!a.station);
    handoff={actor,from:pilot.specimen(),to:bay,start:performance.now()};
    pilot.release();
    targetPulse[bay.index%2]=handoff.start;
    if(guideStep>=0){guideInput('classify');held.clear();}
    else choose(bay.index);
  }else if(space && guideStep<0 && view.readyToSubmit)submit();
}
let handoff=null,objective='';
let scanTime=-Infinity;
const targetPulse=[-Infinity,-Infinity];
let feedback=null, pulse=0, arrival=0, origin, hits=[];
const canvas=$('arena'),ctx=canvas.getContext('2d');
function emit(event,detail={}) {
  if(origin) parent.postMessage({type:'GAME_EVENT',archetype:config.archetype,event,detail},origin);
}
function button(label,fn) {
  const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;
}
function action(fn, inspection=false) {
  if(!round)return;
  const last=view.target;
  const outcome=fn();pulse=performance.now();
  if(inspection)scanTime=pulse;
  if(outcome?.destination!==undefined)scanTime=-Infinity;
  if(outcome?.destination!==undefined){
    const actor=view.actors[outcome.actor], hit=hits[outcome.actor];
    handoff=null;cohort.add(actor,outcome.destination,outcome.correct,pulse,(hit?.x??mapWidth()/2)/mapWidth(),((hit?.y??floorHeight()/2)+11)/floorHeight());
    feedback=null;
  }else if(outcome && hits[outcome.actor])feedback=ArcadeHUD.spawnCallout(hits[outcome.actor],outcome,pulse);
  view=round.view();
  if(last!==view.target){
    arrival=pulse;spawnUntil=view.field?-Infinity:pulse+500;entryPaths.clear();if(escortMode)pilot.release();else pilot=null;lastChoice=null;hits=[];
    if(feedback)feedback.detached=true; // Keep the callout at the previous sample, but show the new cues immediately.
  }
  if(!view.done){passed=false;reported=false;}
  if(view.done&&!reported){
    passed=view.success&&view.accuracy>=75;
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
    stars:tutorialMode?3:view.stars??(accuracy>=75?3:accuracy>=60?2:1),passed:won,run:params.get('run')},location.origin);
}
function guideInput(key){
  const next=ArcadeNarrator.next(guideStep,key);
  if(next===guideStep)return;
  guideStep=next;
  render();
}
function choose(i){
  if(guideStep>=0){guideInput(i);return;}
  if(!view.done&&!view.locked&&!view.field){lastChoice=i;action(()=>round.act(i));}
}
function submit(){
  if(guideStep===5)finishGuide();
  else if(guideStep>=0)guideInput('continue');
  else if(guideStep<0&&!view.done)action(()=>round.submit());
}
function advance(){
  if(!passed || tier>=lastLevel)return;
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
  ArcadeTutorial.finish(gameId);
  if(tutorialMode){passed=true;report('ARCADE_PROGRESS',true,100);report('ARCADE_NEXT',true,100);return;}
  guideStep=-1;scanTime=-Infinity;pilot=savedPilot||(escortMode?WorldEngine.controller(world):null);savedPilot=null;handoff=null;held.clear();hits=[];track=[];entryPaths.clear();
  feedback=null;arrival=performance.now();spawnUntil=pilot||view.field?-Infinity:arrival+500;render();
}
function consoleReadout(guided){
  const m=config.mechanics,t=config.theme;
  const training=m.training_pool?.size||m.samples?.length;
  let total,completed,kind,instruction;
  if(guided){
    total=6;completed=guideStep;kind='Guide';instruction='';
  }else if(view.field){
    total=4;completed=view.completed;kind='Field case';instruction=view.done?'Review the field results.':view.submit;
  }else if(training){
    total=training;completed=view.target%total;kind=m.samples?'Signal':'Specimen';instruction='Inspect the item and choose its destination.';
  }else if(view.range){
    total=2;completed=Number(view.readyToSubmit);kind='Calibration';instruction=view.guide;
  }else if(m.answers){
    total=m.answers.length;completed=view.target;kind='Claim';instruction=view.guide;
  }else{
    total=m.k||m.order?.length||1;completed=Math.min(view.picks.length,total);kind='Selection';instruction='Choose at a station, then submit with Space.';
  }
  $('phase').textContent=guided?'Guide':view.field?'Field test':training?'Collect & train':view.range?'Calibrate':m.answers?'Inspect':'Select';
  objective=instruction;
  $('objective').textContent=objective;
  const number=Math.min(completed+1,total);
  $('itemId').textContent=kind+' '+(view.field&&view.verdict?view.completed:number);
  $('progress').textContent=completed+' / '+total;
  $('pips').replaceChildren();
  for(let i=0;i<total;i++){
    const pip=document.createElement('i');if(i<completed)pip.className='filled';$('pips').append(pip);
  }
  let traits=view.traits||[];
  if(guided && m.class_rule){
    traits=m.features.map(f=>[t.featureLabels[f.name],f.values.map(v=>t.featureLabels[v]).join(' / ')]);
  }else if(!traits.length){
    traits=(view.actors||[]).filter(a=>!a.station && a.label!==view.subject).map(a=>['Item',a.label]);
    const active=view.actors?.find(actor=>!actor.station);
    if(!guided && active?.aura!==undefined)traits.push(['Aura',active.aura?'Amber':'Cyan']);
    if(!guided && view.legend)traits.push(...view.legend.map(line=>['Cue',line]));
  }
  $('traits').replaceChildren();
  if(escortMode && !view.field && !guided && !pilot.tethered)traits=[];
  if(pilot?.tethered && view.trace && !traits.some(([key])=>key===view.trace[0]))traits=[view.trace,...traits];
  for(const [key,value] of traits){
    const cell=document.createElement('span'),label=document.createElement('small'),text=document.createElement('b');
    if(pilot?.traced && key===view.trace?.[0])cell.className='scan-trace';
    label.textContent=key;text.textContent=value;cell.append(label,text);$('traits').append(cell);
  }
  $('subject').textContent=guided?t.title:view.traits && m.class_rule?'':view.subject;
  $('detail').textContent=guided?'':view.detail||'';
}
function render() {
  view=round.view();
  const guided=guideStep>=0;
  $('title').textContent=config.theme.title;
  $('title').title=config.theme.subtitle||'';
  consoleReadout(guided);
  const scoreLabels=view.teamNames||(config.archetype==='threshold'?['Hits','False alarms']:['Verified','Errors']);
  for(let i=0;i<2;i++)$('team'+i).textContent=scoreLabels[i]+' '+view.score[i];
  $('metric').textContent=view.metric+' '+view.value+'%';
  $('meter').style.setProperty('--value',view.value+'%');
  $('guide').hidden=!guided;
  $('instruction').textContent=guided?lines[guideStep]:'';
  $('continue').disabled=guideStep<3;
  $('continue').textContent=guideStep===5?'PLAY THE GAME ▶':'NEXT >>';
  $('skip').hidden=guideStep===5;
  $('help').hidden=guided;
  $('callout').classList.toggle('field-verdict',Boolean(!guided&&view.verdict));
  $('callout').textContent=guided?'':view.auditAvailable?'Model Audit · Which feature should the model prune?':view.success?view.note+' · '+(view.stars||3)+' stars':view.note;
  $('actions').replaceChildren();
  const move=document.createElement('span');move.textContent='[WASD/Arrows] Move';
  $('actions').append(move,button('[E/Space] Interact',()=>interactHere()));
  const dialog=$('modelAudit');
  if(dialog.open && (guided||!view.auditAvailable))dialog.close();
  if(!guided){
    if(!view.instant&&!view.training){const trigger=button('[SPACE] '+(view.field&&view.completed===0?'Launch Field Test':view.submit),submit);trigger.disabled=Boolean(view.done||view.training);if(view.locked&&!view.done)trigger.className='field-trigger';$('actions').append(trigger);}
    if(passed&&tier<lastLevel)$('actions').append(button('Next Level →',advance));
    if(view.auditAvailable){
      $('auditChoices').replaceChildren();
      ['true','spurious'].forEach((role,i)=>{
        const label=(i?'Prune Spurious Cue · ':'Prune True Feature · ')+view.auditChoices[i];
        $('auditChoices').append(button(label,()=>{reported=false;action(()=>round.audit(role));}));
      });
      if(!dialog.open)dialog.showModal();
    }
    if(view.done)$('actions').append(button('Replay',()=>start(config,configPath)));
  }
  $('dial').hidden=guided||!view.range;
  if(view.range){$('slider').max=view.range[1];$('slider').value=view.range[0];}
  $('sources').hidden=guided||!view.sources;
  if(view.sources && $('sources').childElementCount===0){
    view.sources.forEach((source,i)=>{
      const b=button('Source '+(i+1),()=>{b.textContent=source;action(()=>round.inspect(),true);});
      $('sources').append(b);
    });
  }
}
let worldWidth=560,worldHeight=245;
let scenery, layout;
function mapWidth(){
  return worldWidth;
}
function strideTime(now){
  return now*world.surface.speedMultiplier*.9/world.surface.drag;
}
function arenaLayout(logicalWidth,logicalHeight){
  const uiScale=Math.max(.68,Math.min(1.25,Math.min(logicalWidth/1100,logicalHeight/620)));
  return {logicalWidth,logicalHeight,uiScale};
}
function resizeCanvas(){
  const dpr=window.devicePixelRatio||1;
  const width=Math.max(1,Math.round(canvas.clientWidth*dpr));
  const height=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==width || canvas.height!==height){
    canvas.width=width;canvas.height=height;
  }
  const logicalWidth=Math.max(1,canvas.clientWidth),logicalHeight=Math.max(1,canvas.clientHeight);
  if(layout?.logicalWidth!==logicalWidth || layout.logicalHeight!==logicalHeight){
    layout=arenaLayout(logicalWidth,logicalHeight);
  }
  // One transform scales sprites, text, particles and pointer hit boxes together.
  worldWidth=logicalWidth/layout.uiScale;
  worldHeight=logicalHeight/layout.uiScale;
  ctx.setTransform(width/worldWidth,0,0,height/worldHeight,0,0);
  ctx.imageSmoothingEnabled=true;
}
function drawMember(member,now,w,h){
  const x=member.x*w,y=member.y*h,art=member.actor.art??member.actor.slot;
  contactShadow(x,y,member.size*.31);
  ctx.save();ctx.translate(x-member.size/2,y-member.size);
  rimLight();
  ArcadeHUD.drawEntitySprite(ctx,images[art],{theme:config.theme,slot:art,facing:member.walking&&member.side===0?-1:1},member.size,strideTime(now),
    member.walking?'walk':passed?'celebrate':'idle');
  ctx.restore();
  const mark=member.actor.badge??member.actor.sample;
  if(mark!==undefined){
    ctx.save();ctx.translate(x+member.size*.21,y-member.size*.4);
    ctx.fillStyle=mark?'#ffb883':'#fff1bc';ctx.strokeStyle='#152737';ctx.lineWidth=1.5;
    ctx.beginPath();
    if(mark===0)ctx.arc(0,0,member.size*.12,0,2*Math.PI);
    else for(let k=0;k<=16;k++){
      const radius=member.size*(k%2?.08:.16);
      ctx[k?'lineTo':'moveTo'](Math.cos(k*Math.PI/8)*radius,Math.sin(k*Math.PI/8)*radius);
    }
    ctx.fill();ctx.stroke();ctx.restore();
  }
  if(member.sinceContact>=0 && member.sinceContact<670){
    ctx.save();ctx.textAlign='center';ctx.font='bold 11px sans-serif';
    ctx.fillStyle=member.correct?'#a3ffd3':'#ffcac1';ctx.strokeStyle='#102132';ctx.lineWidth=3;
    const text=member.correct?'+1':'Mislabelled!',ty=y-20-member.sinceContact/60;
    ctx.strokeText(text,x,ty);ctx.fillText(text,x,ty);ctx.restore();
  }
}
function drawFloorLandmarks(w,h,activity){
  const {checkpoint}=world.structures;
  const c=config.theme.palette||{};
  ctx.save();ctx.font='bold 11px monospace';ctx.textAlign='center';
  function pad(point,label,color){
    const x=Math.round(point.x*w),y=Math.round(point.y*h);
    const half=Math.round(Math.min(w*.12,Math.max(23,ctx.measureText(label).width/2+6)));
    ctx.fillStyle=c.floor||'#283737';ctx.fillRect(x-half,y-3,half*2,11);
    ctx.fillStyle=color;ctx.fillRect(x-half,y-4,half*2,2);
    for(const end of [x-half,x+half-3])ctx.fillRect(end,y-4,3,12);
    ctx.lineWidth=3;ctx.strokeStyle='#122126';ctx.fillStyle='#fff';
    ctx.strokeText(label,x,y+20,w*.24);ctx.fillText(label,x,y+20,w*.24);
  }
  pad(checkpoint,'SCAN',activity.scan?'#fff':accent);
  if(pilot?.traced && activity.scan){
    ctx.fillStyle=accent;ctx.globalAlpha=activity.scan;
    ctx.fillRect(checkpoint.x*w-19,checkpoint.y*h-4-(1-activity.scan)*48,38,2);
    ctx.globalAlpha=1;
  }
  for(const sign of signs()){
    const side=sign.index%2,primary=sign.index<2;
    const name=primary && (guideStep>=0||view.range||view.training||view.instant)?view.names[side]:sign.label;
    pad(sign,(primary?'0'+(side+1)+' · ':'')+name,activity.gates[side]>0?'#fff':(side?c.team1:c.team0)||accent);
  }
  ctx.restore();
}
function contactShadow(x,y,r){
  ctx.save();ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=3;
  ctx.fillStyle='rgba(0,0,0,0.32)';
  ctx.beginPath();ctx.ellipse(x,y,r,Math.max(2,r*.27),0,0,Math.PI*2);ctx.fill();ctx.restore();
}
let style,accent,handlerStyle;
function rimLight(){
  ctx.shadowColor=accent;ctx.shadowBlur=2;ctx.shadowOffsetX=-1;ctx.shadowOffsetY=-1;
}
function paint(now){
  requestAnimationFrame(paint);if(!round)return;
  resizeCanvas();
  const w=worldWidth,h=floorHeight();
  ctx.save();
  if(feedback&&now-feedback.start>=700)feedback=null;
  const zoom=Math.max(w/scenery.width,worldHeight/scenery.height);
  const sw=scenery.width*zoom,sh=scenery.height*zoom;
  ArcadeEnvironment.blit(ctx,scenery,(w-sw)/2,(worldHeight-sh)/2,sw,sh);
  if(land)ArcadeEnvironment.blit(ctx,land,0,0,w,worldHeight);
  ctx.translate(0,floorTop());
  let driven=null;
  if(pilot && (guideStep>=0 || !view.field && !view.done)){
    let dx=0,dy=0;
    for(const key of held){dx+=movement[key][0];dy+=movement[key][1];}
    driven=pilot.step(Math.sign(dx),Math.sign(dy),(now-frameTime)/1000);
    if(guideStep===0 && driven.moving)guideInput('move');
    if(!escortMode && driven.contact==='inspect')inspectHere();
    if(driven.contact==='interact'){
      interactHere();
      if(!pilot)driven=null;
    }
    if(driven?.moving && now-lastMark>=55){
      track.push({...driven,time:now,step:Math.floor(now/55)});lastMark=now;
    }
  }
  frameTime=now;
  const actors=guideStep>=0?practiceActors:view.actors||view.names.slice(0,2).map((label,slot)=>({slot,label}));
  const playWidth=w;
  const columns=Math.min(actors.length,Math.max(1,Math.floor(playWidth/85)));
  const rows=Math.ceil(actors.length/columns);
  const mw=mapWidth(),{entry:door,checkpoint}=world.structures;
  const lanes=view.lanes?.length||2;
  const group=cohort.frame(now,lanes);
  const entries=[], trails=[];
  const controlled=actors.findIndex(a=>!a.station);
  let doorwayMotion=0;
  hits=[];
  actors.forEach((actor,i)=>{
    const effect=feedback?.actor===i&&!feedback.detached?feedback:null;
    const {slot,station}=effect?.entity||actor;
    const vx=station?0:(i%2?-1:1),age=Math.max(0,now-arrival);
    const inLane=actors.some(a=>a.station);
    const row=Math.floor(i/columns),rowSize=Math.min(columns,actors.length-row*columns);
    const z=ArcadeWorld.zone(world,slot);
    const dest={x:station?z.x:i===controlled||inLane?checkpoint.x:((i%columns)+.5)/rowSize*.86,
      y:station?z.y:i===controlled?checkpoint.y:checkpoint.y+(row-(rows-1)/2)*Math.min(.12, .45/rows)};
    let paths=entryPaths.get(i);
    if(!paths||paths.x!==dest.x||paths.y!==dest.y){
      const approach=ArcadeWorld.route(door,dest,world);
      paths={...dest,approach};entryPaths.set(i,paths);
    }
    let path=paths.approach,elapsed=station||guideStep>=0?path.duration:age;
    const specimen=i===controlled;
    const point=specimen && escortMode?pilot.specimen():specimen && driven?driven:ArcadeWorld.position(path,elapsed);
    if(!station && guideStep<0 && !view.field && (!specimen && age<path.duration)){
      const distance=Math.hypot((point.x-door.x)*20,(point.y-door.y)*12);
      doorwayMotion=Math.max(doorwayMotion,Math.min(1,Math.max(0,2-distance)));
    }
    if(!specimen&&!station&&guideStep<0)trails.push(...ArcadeWorld.trail(path,elapsed));
    const x=effect?.x??point.x*mw,y=effect?.y??(point.y*h-11);
    hits[i]={x,y,...actor};
    entries.push({x,footY:y+11,draw:()=>drawActor(actor,i,effect,x,y,age,specimen&&driven&&!escortMode?driven.facing:vx,specimen&&!escortMode&&driven?driven.moving:!specimen&&!station&&guideStep<0&&elapsed<path.duration)});
  });
  if(escortMode){
  const handler=driven||{...pilot.pos(),facing:1,moving:false};
  const hx=handler.x*mw,hy=handler.y*h;
  entries.push({footY:hy,draw:()=>{
    contactShadow(hx,hy,11);
    ArcadeHUD.drawHandler(ctx,hx,hy,handler,handlerStyle,accent,now);
  }});
  }
  if(handoff){
    const t=Math.min(1,Math.max(0,(now-handoff.start)/300));
    const x=(handoff.from.x+(handoff.to.x-handoff.from.x)*t)*mw;
    const y=(handoff.from.y+(handoff.to.y-handoff.from.y)*t)*h;
    const actor=handoff.actor;
    if(t>=1)handoff=null;
    else entries.push({footY:y,draw:()=>drawActor(actor,0,null,x,y-11,1000,1,false)});
  }
  if(guideStep<0){
    for(const member of group.actors){
      trails.push(...member.trails);
      entries.push({x:member.x*mw,footY:member.y*h,draw:()=>drawMember(member,now,mw,h)});
    }
  }
  for(const o of world.obstacles)entries.push({footY:(o.y+o.h/2)*h,draw:()=>ArcadeEnvironment.solid(ctx,o,mw,h,accent,style)});
  track=track.filter(m=>now-m.time<450);
  for(const m of track){
    const alpha=1-(now-m.time)/450;
    if(handlerStyle==='diver'){
      ctx.save();ctx.globalAlpha=alpha*.45;ctx.fillStyle='#b6eced';
      ctx.fillRect(m.x*mw+(m.step%2?5:-5),m.y*h-(1-alpha)*8,2,2);ctx.restore();
    }else ArcadeEnvironment.drawTrail(ctx,[{...m,alpha}],WorldEngine.surfaceAt(world,m),mw,h);
  }
  ArcadeEnvironment.drawTrail(ctx,trails,world.surface,mw,h);
  const activity=ArcadeHUD.structureActivity(now,scanTime,group.actors,lanes);
  for(let side=0;side<2;side++)activity.gates[side]=Math.max(activity.gates[side]||0,1-(now-targetPulse[side])/350);
  activity.spawn=ArcadeHUD.spawnOpening(now,spawnUntil)*doorwayMotion;
  const cutoff=view.range?view.range[0]/(view.range[1]||1):.5;
  const fixture=part=>ArcadeEnvironment.drawFixtures(ctx,mw,h,world,config.archetype,style,accent,activity,hover,lowProfile,now,cutoff,part);
  fixture('floor');
  fixture('entry');
  drawFloorLandmarks(mw,h,activity);
  for(const vent of world.hazards)ArcadeHUD.drawVent(ctx,vent,mw,h,accent,now);
  if(pilot?.tethered){
    const item=pilot.specimen();
    ctx.save();ctx.strokeStyle=accent;ctx.globalAlpha=.7;ctx.shadowColor=accent;ctx.shadowBlur=3;
    ctx.beginPath();ctx.moveTo(pilot.pos().x*mw,pilot.pos().y*h-14);ctx.lineTo(item.x*mw,item.y*h-12);ctx.stroke();ctx.restore();
  }
  ArcadeHUD.paintByDepth(entries);
  const target=interactionTarget();
  let hint=objective;
  if(target){
    const tx=target.point.x*mw,ty=target.point.y*h-(target.type==='pad'?77:36);
    ctx.save();ctx.textAlign='center';ctx.font='bold 11px monospace';ctx.fillStyle='#122126';
    ctx.fillRect(tx-12,ty-11,24,14);ctx.fillStyle='#fff';ctx.fillText('[E]',tx,ty);ctx.restore();
    hint=target.type==='bay'&&!pilot.tethered?target.hint:'[E] '+target.hint;
  }else if(pilot?.tethered)hint='Escort the item to a destination bay.';
  if($('objective').textContent!==hint)$('objective').textContent=hint;

  if(feedback)ArcadeHUD.drawCallout(ctx,feedback,now);
  ctx.restore();
  if(!lowProfile)ArcadeEnvironment.foreground(ctx,w,worldHeight,config.theme);

  function drawActor(actor,i,effect,x,y,age,vx,walking){
    const {slot}=effect?.entity||actor;
    const entity=effect?.entity||actor;
    if(!entity.station && entity.aura!==undefined){
      const blink=.5+.5*Math.sin(now/(entity.aura?100:400));
      ctx.fillStyle=entity.aura?'#ffac60':'#89e3ed';
      ctx.fillRect(x-22,y-24,3,3);
      if(entity.aura||blink>.5)ctx.fillRect(x-18,y-28,2,2);
    }
    const pose=ArcadeHUD.pose(now,i,vx,age,effect,walking?strideTime(now):now);
    contactShadow(x,y+11,14*pose.shadow);
    ctx.save();ctx.translate(x+pose.dx,y+11+pose.dy);ctx.rotate(pose.tilt);ctx.scale(pose.sx,pose.sy);
    rimLight();
    const art=(effect?.entity||actor).art??slot;
    const image=images[art],framed=image?.naturalHeight===128;
    const size=84;
    ctx.translate(-size/2,-size*(framed?116/128:1));
    ArcadeHUD.drawEntitySprite(ctx,image,{theme:config.theme,slot:art},size,strideTime(now),passed?'celebrate':walking?'walk':'idle');
    ctx.restore();
    if(entity.badge!==undefined){
      ctx.save();ctx.translate(x+10,y-4+pose.dy);ctx.fillStyle='#fff1bc';ctx.strokeStyle='#152737';ctx.lineWidth=2;
      ctx.beginPath();
      if(entity.badge===0)ctx.ellipse(0,0,6,6,0,0,2*Math.PI);
      else for(let k=0;k<=16;k++){
        const angle=k*Math.PI/8,radius=k%2?4:8;
        ctx[k?'lineTo':'moveTo'](Math.cos(angle)*radius,Math.sin(angle)*radius);
      }
      ctx.fill();ctx.stroke();ctx.restore();
    }
    if(entity.verified!==undefined){
      ctx.fillStyle='#182735';ctx.fillRect(x+6,y-11+pose.dy,13,14);
      ctx.fillStyle='#ffedb9';ctx.fillRect(x+8,y-9+pose.dy,9,10);
      ctx.fillStyle='#274559';ctx.fillRect(x+10,y-7+pose.dy,5,1);
      if(entity.verified){ctx.fillStyle='#15815d';ctx.fillRect(x+10,y-3+pose.dy,5,3);}
    }
    if(entity.sample!==undefined){
      ctx.save();ctx.translate(x+12,y-4+pose.dy);ctx.rotate(Math.PI/4);
      ctx.fillStyle='#132436';ctx.fillRect(-6,-6,12,12);
      ctx.fillStyle=entity.sample?'#ff936f':'#80f5c4';ctx.fillRect(-4,-4,8,8);
      if(entity.sample){ctx.fillStyle='#182c3d';ctx.fillRect(-1,-5,2,5);ctx.fillRect(0,0,3,5);}ctx.restore();
    }

  }
}
async function start(data,path){
  if(data.archetype==='orbit')data={...data,archetype:'classifier'};
  if(data.archetype==='classifier')data={...data,theme:GameLogic.themeFor(data)};
  const id=++generation;
  const [loaded,background]=await Promise.all([
    ArcadeSprites.preload(data.theme,path),
    ArcadeSprites.loadImage(data.theme.backgroundImage||data.theme.backgroundSprite,path)
  ]);
  let physical=data.world_physics;
  if(!physical){
    const [baseline,materials]=await Promise.all(['default.json','../../world_materials.json'].map(url=>fetch(url).then(r=>r.json())));
    physical=ArcadeWorld.forLegacyConfig(data,baseline.world_physics,materials);
  }
  if(id!==generation)return;
  escortMode=data.archetype==='classifier';lastChoice=null;
  lowProfile=Boolean(background?.naturalWidth);
  world=WorldEngine.project(data.tilemap||WorldEngine.legacyMap(physical,tier),physical,lowProfile,escortMode?tier:null);pilot=escortMode?WorldEngine.controller(world):null;handoff=null;held.clear();track=[];frameTime=performance.now();hover=null;entryPaths.clear();
  scenery=document.createElement('canvas');scenery.width=background?.naturalWidth||560;scenery.height=background?.naturalHeight||245;
  const painter=scenery.getContext('2d');
  if(background?.naturalWidth)ArcadeEnvironment.backdrop(painter,scenery.width,scenery.height,background);
  else ArcadeEnvironment.drawArenaBackground(painter,scenery.width,scenery.height,data.theme);
  const shade=painter.createLinearGradient(0,0,0,scenery.height);
  shade.addColorStop(0,'rgba(7,13,28,.22)');shade.addColorStop(.48,'rgba(7,13,28,0)');
  shade.addColorStop(1,'rgba(7,13,28,.24)');painter.fillStyle=shade;
  painter.fillRect(0,0,scenery.width,scenery.height);
  style=ArcadeEnvironment.structureStyle(data.theme);
  handlerStyle=ArcadeHUD.handlerStyle(data.theme);
  if(lowProfile){
    const props=(data.theme.environment?.props||[]).filter(p=>['trees','barrels','crates'].includes(p));
    world.obstacles.forEach((obstacle,i)=>{
      obstacle.sceneryProp=props.length ? props[i%props.length] : (world.surface.type==='grass'?'trees':'crates');
    });
  }
  accent=data.theme.environment?.accent_color||data.theme.accent||'#84dacc';
  land=null;
  if(!lowProfile){
    land=document.createElement('canvas');land.width=560;land.height=300;
    ArcadeEnvironment.ground(land.getContext('2d'),land.width,land.height,data.theme);
  }
  scanTime=-Infinity;targetPulse.fill(-Infinity);savedPilot=null;
  reported=false;passed=false;feedback=null;hits=[];config=data;configPath=path;images=loaded;cohort=ArcadeHUD.createCohort(world);round=withFieldTest(createRound(data));arrival=performance.now();
  lines=ArcadeNarrator.lines(data);practiceActors=ArcadeNarrator.actors(data).map(a=>({...a,station:true}));
  practiceActors.push({...practiceActors[0],station:false,slot:2,art:0});guideStep=ArcadeTutorial.has(gameId)||params.get('transition')==='1'?-1:0;spawnUntil=guideStep<0?arrival+500:-Infinity;
  $('sources').replaceChildren();render();emit('start');
  if(tutorialMode && guideStep<0)finishGuide();
}
function pointerDestination(e){
  if(!round||!layout)return null;
  const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)*worldWidth/b.width,y=(e.clientY-b.top)*worldHeight/b.height-floorTop();
  const coord={x:x/mapWidth(),y:y/floorHeight()};
  const hit=hits.find(h=>Math.abs(x-h.x)<25 && y>=h.y-50 && y<=h.y+11);
  const sign=signs().filter(s=>Math.abs(x-s.x*mapWidth())<Math.max(25,mapWidth()*.055) && y-s.y*floorHeight()>-12 && y-s.y*floorHeight()<24)
    .sort((a,b)=>Math.abs(coord.y-a.y)-Math.abs(coord.y-b.y))[0];
  if(sign)return {point:sign,action:'interact'};
  if(!escortMode){
  if(hit && !hit.station)return {point:hit===hits.find(h=>!h.station)?world.structures.checkpoint:{x:hit.x/mapWidth(),y:(hit.y+11)/floorHeight()},action:'inspect'};
  }
  if(escortMode && hit && hit===hits.find(h=>!h.station) && !pilot.tethered)return {point:world.structures.checkpoint,action:'interact'};
  if(hit?.station)return {point:ArcadeWorld.zone(world,hit.slot),action:'interact'};
  if(coord.y<0||coord.y>=1||coord.x<0||coord.x>=1)return null;
  const target=ArcadeWorld.targetAt(world,coord);
  if(target==='checkpoint')return {point:world.structures.checkpoint,action:escortMode?'interact':'inspect'};
  if(target!==null)return {point:ArcadeWorld.zone(world,target),action:'interact'};
  return {point:coord,action:''};
}
canvas.onpointermove=e=>{canvas.style.cursor=pointerDestination(e)?'pointer':'default';};
canvas.onclick=e=>{
  const dest=pointerDestination(e);
  if(dest&&takeControl()){canvas.focus();pilot.walkTo(dest.point,dest.action);}
};
function showGuide(){
  if(guideStep<0)savedPilot=pilot;
  pilot=escortMode?WorldEngine.controller(world):null;handoff=null;feedback=null;held.clear();hits=[];track=[];guideStep=0;spawnUntil=-Infinity;emit('hint_shown');render();
}
$('help').onclick=showGuide;
$('continue').onclick=submit;
$('skip').onclick=finishGuide;
$('slider').oninput=e=>action(()=>round.tune(Number(e.target.value)));
window.addEventListener('keydown',e=>{
  if(!round)return;
  if(e.target.matches('input'))return;
  if(e.key==='?'&&!e.repeat){showGuide();return;}
  if($('modelAudit').open)return;
  const key=e.key.toLowerCase();
  if(movement[key]&&takeControl()){e.preventDefault();canvas.focus();held.add(key);return;}
  if(e.repeat){if(e.code==='Space')e.preventDefault();return;}
  if(e.code==='Space'&&e.target.matches('button')&&!e.target.classList.contains('field-trigger'))return;
  if(e.code==='Space'){e.preventDefault();interactHere(true);return;}
  if(key==='e'){e.preventDefault();interactHere();}

});
window.addEventListener('keyup',e=>held.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>held.clear());
window.addEventListener('message',e=>{
  if(parent===window||e.source!==parent||e.data?.type!=='LOAD_CONFIG'||origin&&e.origin!==origin)return;
  origin=e.origin;gameId=e.data.gameId||gameId;start(e.data.config,configPath);
});
fetch(configPath).then(r=>r.json()).then(c=>{if(!generation)return start(c,configPath);}).catch(e=>{$('subject').textContent='Unable to load activity: '+e.message;});
requestAnimationFrame(paint);
