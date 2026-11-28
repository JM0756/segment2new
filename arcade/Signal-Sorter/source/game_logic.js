// Switch positions are sampled only as a packet crosses the node.
function conduitWave(stage,samples,pace){
  const points={emit:[.5,.06],FLT:[.5,.25],A:[.5,.53],B:[.28,.55],
    low:[.08,.6],high:[.92,.6],sink:[.5,.93]};
  if(stage>=2)points.C=[.71,.54];
  if(stage===3)points.INV=[.5,.39];
  const switches={A:0,B:0,FLT:0};
  if(points.C)switches.C=1;
  if(points.INV)switches.INV=0;
  const exits={emit:['FLT'],FLT:[points.INV?'INV':'A'],INV:['A'],
    A:['B',points.C?'C':'high','sink'],B:['low','high','sink'],C:['low','high','sink']};
  const total=10+stage*2,interval=3.6/Math.sqrt(pace),hop=1.15;
  const packets=Array.from({length:total},(_,i)=>({
    band:i%5===3?2:samples[i%samples.length],dirty:i%4===2&&i%5!==3,
    shifted:stage===3&&i>=total/2,spawn:1+i*interval
  }));
  const state={time:0,total,spawned:0,resolved:0,score:0,good:0,buffers:[0,0],heat:[0,0],
    pulses:[],switches,points,exits,done:false,stars:0,snr:100,event:null,shift:false};
  function next(node){return exits[node][exits[node].length===1?0:switches[node]];}
  function resolve(p){
    const sink=p.to==='sink',side=Number(p.to==='high');
    const hit=!sink&&!p.dirty&&side===p.band&&!p.inverted;
    const ok=sink?p.band===2:hit;
    if(hit){state.buffers[side]++;state.score+=100;}
    if(!sink&&!hit)state.heat[side]++;
    state.resolved++;if(ok)state.good++;
    state.snr=Math.round(100*state.good/state.resolved);
    state.event={time:state.time,to:p.to,ok,text:hit?'+100':sink?(ok?'GROUNDED':'WASTED SIGNAL'):
      p.dirty||p.band===2?'STATIC NOISE!':'WRONG CORE!'};
    state.done=state.heat.includes(5)||state.resolved===total;
    if(state.done&&!state.heat.includes(5)){
      const hits=state.buffers[0]+state.buffers[1];
      state.stars=state.snr>=90&&hits>=total*.65?3:state.snr>=70&&hits>=total*.45?2:1;
    }
  }
  function tick(dt){
    if(state.done)return;
    state.time+=dt;
    while(state.spawned<total&&packets[state.spawned].spawn<=state.time){
      const packet=packets[state.spawned++];
      state.shift=packet.shifted;
      state.pulses.push({...packet,inverted:packet.shifted&&packet.band!==2,from:'emit',to:'FLT',depart:packet.spawn});
    }
    for(const p of state.pulses){
      while(!p.finished&&state.time>=p.depart+hop){
        if(!exits[p.to]){resolve(p);p.finished=true;break;}
        if(p.to==='FLT'&&switches.FLT)p.dirty=false;
        if(p.to==='INV'&&switches.INV&&p.band!==2)p.inverted=!p.inverted;
        p.from=p.to;p.to=next(p.from);p.depart+=hop;
      }
      if(state.done)break;
    }
    state.pulses=state.pulses.filter(p=>!p.finished);
  }
  function lookahead(){
    const incoming=[];
    const travel=(points.INV?3:2)*hop;
    for(const scheduled of packets){
      const eta=scheduled.spawn+travel-state.time;
      if(eta<0)continue;
      const live=state.pulses.find(p=>p.spawn===scheduled.spawn);
      const inverted=live?.inverted??(scheduled.shifted&&scheduled.band!==2);
      incoming.push({band:inverted?1-scheduled.band:scheduled.band,dirty:live?.dirty??scheduled.dirty,eta});
      if(incoming.length===2)break;
    }
    return incoming;
  }
  return {state,next,tick,hop,lookahead,toggle(id){
    if(id in switches)switches[id]=(switches[id]+1)%(['FLT','INV'].includes(id)?2:3);
  }};
}
if(typeof module!=='undefined')module.exports={conduitWave};
