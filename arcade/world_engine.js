// Continuous movement in tile units. The renderer projects the same cells onto its floor plane.
const WorldEngine = (() => {
  const width=20,height=12,radius=.20;
  const keys={S:'entry','?':'checkpoint',L:'leftTarget',R:'rightTarget'};
  const index=p=>Math.floor(p.y*height)*width+Math.floor(p.x*width);
  const center=i=>({x:(i%width+.5)/width,y:(Math.floor(i/width)+.5)/height});
  function legacyMap(physical,tier){
    const rows=Array.from({length:height},()=>Array(width).fill('.'));
    if(tier===3)for(let x=7;x<13;x++)rows[6][x]='~';
    for(const o of physical.obstacles)rows[Math.floor(o.y*height)][Math.floor(o.x*width)]='#';
    for(const [symbol,key] of Object.entries(keys)){
      const p=physical.structures[key];rows[Math.floor(p.y*height)][Math.floor(p.x*width)]=symbol;
    }
    return rows.map(r=>r.join(''));
  }
  function project(rows,physical,background=false){
    const structures={...physical.structures},obstacles=[];
    // Older saves may contain dense walls. Retain at most two solid perimeter props.
    rows=rows.map(row=>Array.from(row));
    const cells=[];
    rows.forEach((row,y)=>row.forEach((tile,x)=>{
      if(tile==='#'){cells.push([x,y]);rows[y][x]='.';}
    }));
    // Use identical task landmarks even for older or generated maps with custom coordinates.
    const anchors={S:[10,2],'?':[10,6],L:[4,6],R:[15,6]};
    rows.forEach(row=>row.forEach((tile,x)=>{if(keys[tile])row[x]='.';}));
    const landmarks=Object.values(anchors);
    for(const [tile,[x,y]] of Object.entries(anchors))rows[y][x]=tile;
    structures.checkpoint={...structures.checkpoint,radius:.075};
    for(const side of ['leftTarget','rightTarget'])structures[side]={...structures[side],width:.12,height:.16};
    // The right control dock narrows the playable plane. Keep generated-scene props at its outer left edge.
    const safe=(x,y)=>(background?x===0:(x<4||x>=16)) && landmarks.every(([lx,ly])=>Math.abs(lx-x)>=4 || Math.abs(ly-y)>=3);
    const candidates=[...cells,[2,9],[17,10]];
    for(let y=1;y<height-1;y++)candidates.push([background?0:2,y],[17,y]);
    let placed=0;
    for(const [x,y] of candidates){
      if(!'.~'.includes(rows[y][x])||!safe(x,y))continue;
      if(background && rows.slice(Math.max(0,y-2),y+3).some(row=>row[x]==='#'))continue;
      rows[y][x]='#';
      if(++placed>=Math.min(2,Math.max(1,cells.length)))break;
    }
    rows=rows.map(r=>r.join(''));
    rows.forEach((row,y)=>Array.from(row).forEach((tile,x)=>{
      const point=center(y*width+x);
      if(keys[tile])structures[keys[tile]]={...structures[keys[tile]],...point};
      if(tile==='#'){
        const props=physical.obstacles;
        const nearest=props.reduce((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)<Math.hypot(b.x-point.x,b.y-point.y)?a:b);
        obstacles.push({...nearest,...point,w:1/width,h:1/height});
      }
    }));
    return {...physical,surface:{...physical.surface,speedMultiplier:1,drag:.9},grid:rows,structures,obstacles};
  }
  function path(rows,from,to){
    const start=index(from),end=index(to),queue=[start],prior=new Map([[start,-1]]);
    for(let i=0;i<queue.length&&!prior.has(end);i++){
      const cell=queue[i],x=cell%width,y=Math.floor(cell/width);
      for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
        const next=ny*width+nx;
        if(nx>=0&&nx<width&&ny>=0&&ny<height&&rows[ny][nx]!=='#'&&!prior.has(next)){
          prior.set(next,cell);queue.push(next);
        }
      }
    }
    let destination=end;
    if(!prior.has(end)){
      // Formation seats and decorative actors can request the far side of a solid.
      const distance=i=>Math.hypot(center(i).x-to.x,center(i).y-to.y);
      destination=queue.reduce((a,b)=>distance(a)<=distance(b)?a:b);
      to=center(destination);
    }
    const steps=[];
    for(let i=destination;i!==-1;i=prior.get(i))steps.push(center(i));
    return start===end?[from,to]:[from,...steps.reverse(),to];
  }
  function surfaceAt(world,p){
    const tile=world.grid?.[Math.floor(p.y*height)]?.[Math.floor(p.x*width)];
    const base=world.surface;
    if(tile!=='~')return base;
    return {...base,drag:.96,trailStyle:'footprints'};
  }
  function fits(rows,x,y){
    for(const dx of [-radius,radius])for(const dy of [-radius,radius]){
      const tile=rows[Math.floor(y+dy)]?.[Math.floor(x+dx)];
      if(!tile||tile==='#')return false;
    }
    return true;
  }
  function controller(world,point=world.structures.entry){
    let x=point.x*width,y=point.y*height,vx=0,vy=0,waypoints=[],pending='',facing=1;
    const pos=()=>({x:x/width,y:y/height});
    return {pos,
      walkTo(point,interaction=''){waypoints=path(world.grid,pos(),point).slice(1);pending=interaction;vx=vy=0;},
      step(dx,dy,seconds){
        let contact='',moving=false;
        for(let dt=Math.min(.1,Math.max(0,seconds));dt>1e-8;){
          const tick=Math.min(1/120,dt);dt-=tick;
          const surface=surfaceAt(world,pos()),speed=6*surface.speedMultiplier;
          if(dx||dy){waypoints=[];pending='';}
          let ax=dx,ay=dy;
          if(waypoints.length){
            const wp=waypoints[0];ax=wp.x*width-x;ay=wp.y*height-y;
            const length=Math.hypot(ax,ay);
            if(length<=speed*tick){x=wp.x*width;y=wp.y*height;waypoints.shift();vx=vy=0;
              if(!waypoints.length){contact=pending;pending='';}
              continue;}
            vx=speed*ax/length;vy=speed*ay/length;
          }else{
            const drag=surface.drag**(60*tick),length=Math.hypot(ax,ay)||1;
            vx=drag*vx+(1-drag)*ax/length*speed;vy=drag*vy+(1-drag)*ay/length*speed;
          }
          if(fits(world.grid,x+vx*tick,y))x+=vx*tick;else vx=0;
          if(fits(world.grid,x,y+vy*tick))y+=vy*tick;else vy=0;
          if(Math.abs(vx)>.05)facing=Math.sign(vx);
          moving ||= Math.hypot(vx,vy)>.08;
        }
        return {...pos(),contact,moving,facing};
      }
    };
  }
  function nearby(point, landmarks){
    let nearest=null,best=1.25;
    for(const target of landmarks){
      const d=Math.hypot((target.x-point.x)*width,(target.y-point.y)*height);
      if(d<=best){best=d;nearest=target;}
    }
    return nearest;
  }
  return {legacyMap,project,path,surfaceAt,controller,nearby};
})();
if(typeof module!=='undefined')module.exports=WorldEngine;
