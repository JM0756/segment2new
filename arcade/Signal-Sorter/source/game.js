const buildWave=typeof module==='undefined'?conduitWave:require('./game_logic').conduitWave;
function sorterPresentation(data){
  const t=data.theme,room=t.environment||{},name=room.setting_name||t.title;
  const reef=/reef|ocean|abyss/i.test(name),forest=/garden|forest|orchard/i.test(name);
  const palette=t.palette||{};
  return {...data,theme:{emitterLabel:name+' Emitter',coreALabel:name+' Alpha',coreBLabel:name+' Beta',
    sinkLabel:'Static Ground',lowLabel:'Low / Sine',highLabel:'High / Twin',lowColor:palette.team0||'#56e1cc',
    highColor:palette.team1||'#ffa86c',...t},titleScreen:{catchyTitle:t.title,divisionBadge:name,
    tagline:'Route the carriers. Ground the interference.',fontStyle:'cyber_mono',
    artStyle:reef?'abyssal_neon':forest?'botanical_parchment':'industrial_steel',...data.titleScreen},
    environment:{weather:{type:reef?'bubbles':'dust',intensity:.3,tint:t.accent},particles:{type:'stars',density:.2,tint:'#aacedd'},
      ...data.environment,platform:{material:forest?'wood_deck':'steel_grating',borderStyle:'bolted_frame',
        deckFill:room.primary_color||'#203943',gridLine:room.secondary_color||'#45616c',borderAccent:room.accent_color||'#94cabe',
        sceneryLayout:'compact',...data.environment?.platform}}};
}
function createRound(config,stage=1){
  return buildWave(Math.max(1,stage),config.mechanics.samples,config.mechanics.pace);
}
function waveform(ctx,x,y,w,h,band,dirty,time,color){
  ctx.strokeStyle=color;ctx.beginPath();
  for(let i=0;i<=32;i++){
    const a=i/32*Math.PI*2+time*3;
    const wave=band===2?Math.sin(a*7)*Math.cos(a*11):band===1?Math.sin(3*a)*Math.cos(a):Math.sin(a);
    const py=y+h*(wave+(dirty?.22*Math.sin(a*16):0));
    if(i)ctx.lineTo(x+i*w/32,py);else ctx.moveTo(x,py);
  }
  ctx.stroke();
}
function drawPipeline(ctx,round,w,h,theme,now,target){
  const {state:s,hop}=round,points=s.points;
  const active=new Set();let node='emit';
  while(s.exits[node]){const dest=round.next(node);active.add(node+'-'+dest);node=dest;}
  const colors=[theme.lowColor,theme.highColor,'#f5baca'];
  ctx.save();ctx.textAlign='center';ctx.font='bold 11px monospace';
  for(const [from,dests] of Object.entries(s.exits)){
    if(!points[from])continue;
    for(const to of dests){
      const [x,y]=points[from],[u,v]=points[to],lit=active.has(from+'-'+to);
      ctx.strokeStyle=lit?colors[0]:'#758993';ctx.lineWidth=lit?3:1;
      ctx.beginPath();ctx.moveTo(x*w,y*h);ctx.lineTo(u*w,v*h);ctx.stroke();
      if(lit)for(let k=0;k<4;k++){
        const t=(now*.0004+k*.25)%1;ctx.fillStyle='#e2fff4';ctx.fillRect((x+(u-x)*t)*w,(y+(v-y)*t)*h,5,2);
      }
    }
  }
  const labels={emit:theme.emitterLabel,low:theme.coreALabel,high:theme.coreBLabel,sink:theme.sinkLabel};
  for(const [id,[u,v]] of Object.entries(points)){
    const x=u*w,y=v*h;
    ctx.fillStyle='#142831';ctx.fillRect(x-16,y-9,32,18);
    ctx.strokeStyle=target===id?'#fff':colors[Number(id==='high')];ctx.strokeRect(x-16,y-9,32,18);
    if(id==='emit'){
      ctx.fillStyle='#a2e4dc';ctx.fillRect(x-3,y-18,6,19);
      for(let j=0;j<3;j++)ctx.fillRect(x-7+j,y-16+j*4,14-j*2,1);
    }else if(id==='sink'){
      ctx.fillStyle='#b4cad1';
      for(let j=0;j<3;j++)ctx.fillRect(x-9+3*j,y-4+j*4,18-6*j,2);
    }
    if(id==='low'||id==='high')waveform(ctx,x-13,y,26,5,Number(id==='high'),false,s.time,ctx.strokeStyle);
    else if(id in s.switches){
      ctx.fillStyle='#fff';ctx.fillText(id+' '+(['FLT','INV'].includes(id)?(s.switches[id]?'●':'○'):['←','→','↓'][s.switches[id]]),x,y+4);
    }
    ctx.fillStyle='#effff9';if(labels[id])ctx.fillText(labels[id],x,y+23,w*.23);
    if(target===id)ctx.fillText('[E]',x,y-14);
  }
  for(const p of s.pulses){
    const a=points[p.from],b=points[p.to],t=Math.min(1,(s.time-p.depart)/hop);
    const x=(a[0]+(b[0]-a[0])*t)*w,y=(a[1]+(b[1]-a[1])*t)*h,band=p.inverted?1-p.band:p.band;
    ctx.strokeStyle=colors[band];ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x-(b[0]-a[0])*w*.09,y-(b[1]-a[1])*h*.09);ctx.lineTo(x,y);ctx.stroke();
    ctx.lineWidth=1;ctx.fillStyle='#152a38';ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fill();ctx.stroke();
    waveform(ctx,x-8,y,16,4,band,p.dirty,s.time,colors[band]);
  }
  if(s.event&&s.time-s.event.time<1){
    const [x,y]=points[s.event.to];ctx.fillStyle=s.event.ok?'#74ffc4':'#ff8383';
    ctx.strokeStyle=ctx.fillStyle;ctx.strokeRect(x*w-19,y*h-12,38,24);
    ctx.fillText(s.event.text,x*w,y*h-18-(s.time-s.event.time)*10);
  }
  ctx.restore();
}
if(typeof module!=='undefined')module.exports={createRound,sorterPresentation};

function pipelineTarget(){
  const pos=pilot.pos(),points=round.state.points;
  const nodes=Object.keys(round.state.switches).map(id=>({id,x:points[id][0],y:points[id][1]}));
  return WorldEngine.nearby(pos,[...nodes,...world.hazards]);
}
function pipelineInteract(){
  const target=pipelineTarget();
  if(!target||guideStep>=0||round.state.done)return;
  if(target.id in round.state.switches)round.toggle(target.id);
  else target.active=!target.active;
  chime(440);
}
function pipelineHint(target){
  if(!target)return 'Approach a switch and press E or Space.';
  const id=target.id,value=round.state.switches[id];
  if(value===undefined)return '[E] Toggle vent';
  if(id==='INV'||id==='FLT')return '[E] '+id+' '+(value?'ON → OFF':'OFF → ON');
  const names=['LEFT','RIGHT','DOWN'];
  return '[E] Flip Switch '+id+' · '+names[value]+' → '+names[(value+1)%3];
}
function renderPipeline(){
  const s=round.state,t=config.theme,guided=guideStep>=0;
  view={points:s.score,stars:s.stars,accuracy:s.snr};
  $('title').textContent=t.title+' · Stage '+Math.max(1,tier);
  $('guide').hidden=!guided;$('skip').hidden=false;$('continue').disabled=false;
  $('instruction').textContent=lines[guideStep]||'';$('continue').textContent=guideStep===lines.length-1?'START':'NEXT';
  $('help').hidden=guided;
  if(!s.done||guided){cleared.hidden=true;return;}
  passed=Boolean(s.stars);
  const total=priorWaveScore+s.score;
  if(!reported){
    ArcadeProgress.record(gameId,tier,s.stars,s.score);
    report('ARCADE_PROGRESS',passed,s.snr);reported=true;emit(passed?'win':'fail');
  }
  cleared.hidden=false;cleared.replaceChildren();
  const title=document.createElement('h2'),summary=document.createElement('p');
  title.textContent=passed?'STAGE '+tier+' CLEARED!':'CORE OVERLOAD';
  summary.textContent=(passed?'★'.repeat(s.stars)+'☆'.repeat(3-s.stars)+' · ':'')+'Wave Score '+s.score+' · Total Score '+total+' · SNR '+s.snr+'%';
  cleared.append(title,summary);
  if(passed&&tier<lastLevel)cleared.append(button('NEXT LEVEL',advance));
  cleared.append(button(passed&&s.stars<3?'REPLAY STAGE FOR 3 STARS':'RETRY STAGE',()=>start(config,configPath)),button('STAGE SELECT',quitToMenu));
}
function pipelineFrame(dt,now){
  const s=round.state,t=config.theme,w=mapWidth(),h=floorHeight();
  let handler={...pilot.pos(),moving:false,facing:1};
  if(startScreen.hidden&&guideStep<0&&!s.done){
    let x=0,y=0;
    for(const key of held){x+=movement[key][0];y+=movement[key][1];}
    handler=pilot.step(Math.sign(x),Math.sign(y),dt);
    if(handler.contact==='interact')pipelineInteract();
    const last=s.event;
    round.tick(dt);
    if(last!==s.event)chime(s.event.ok?680:160);
    if(s.done)renderPipeline();
  }
  const target=pipelineTarget();
  if(s.event&&!s.event.ok&&s.time-s.event.time<.3&&!s.done)ctx.translate(Math.sin(now*.1)*2,0);
  drawPipeline(ctx,round,w,h,t,now,target?.id);
  for(const o of world.obstacles)ArcadeEnvironment.solid(ctx,o,w,h,accent,style);
  for(const v of world.hazards)ArcadeHUD.drawVent(ctx,v,w,h,accent,now);
  ArcadeHUD.drawHandler(ctx,handler.x*w,handler.y*h,handler,handlerStyle,accent,now);
  if(target&&!target.id){ctx.fillStyle='#fff';ctx.fillText('[E]',target.x*w,target.y*h-18);}
  $('objective').textContent=pipelineHint(target);
  $('progress').textContent=String(s.resolved).padStart(2,'0')+' / '+s.total+' PACKETS RESOLVED';
  $('metric').textContent='SNR '+s.snr+'% · Wave Score '+s.score;
  $('callout').textContent=s.shift?'CARRIER FREQUENCY SHIFT · Engage INV':'';
  for(let i=0;i<2;i++){
    const label=i?t.coreBLabel:t.coreALabel;
    $('core'+i).textContent=label+' · Buffer '+s.buffers[i]+' · Heat '+s.heat[i]+'/5';
    $('buffer'+i).value=s.buffers[i];$('buffer'+i).max=s.total;
    $('heat'+i).value=s.heat[i];
  }
  $('detail').textContent=Object.entries(s.switches).map(([id,v])=>id+' '+(['FLT','INV'].includes(id)?(v?'ON':'OFF'):['LEFT','RIGHT','DOWN'][v])).join(' · ');
  const next=round.lookahead();
  for(let i=0;i<2;i++){
    const p=next[i],screen=$('wave'+i),g=screen.getContext('2d');
    g.clearRect(0,0,100,24);
    const band=p?.band;
    const channel=[t.lowLabel,t.highLabel][band];
    const frequency=['LOW / SINE','HIGH / TWIN','NOISE / JAGGED'][band];
    const label=channel&&channel.toUpperCase()!==frequency?channel+' · '+frequency:frequency;
    $('next'+i).textContent='NEXT '+(i+1)+' · '+(p?label+(p.dirty?' + STATIC':'')+' · '+p.eta.toFixed(1)+'s TO SWITCH':'—');
    if(p)waveform(g,0,12,100,8,band,p.dirty,s.time,band===1?t.highColor:t.lowColor);
  }
}
