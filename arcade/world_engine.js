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
  function project(rows,physical,background=false,tier=1,solidCount){
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
    const safe=(x,y)=>(x>0 && x<width-1 && (x<4||x>=16)) && landmarks.every(([lx,ly])=>Math.abs(lx-x)>=4 || Math.abs(ly-y)>=3);
    // Generated artwork already contains scenery. Keep authored perimeter solids
    // there, without manufacturing extra wooden props along the frame.
    const candidates=[...cells];
    if(tier>=2 || tier===null && !background){
      candidates.push([2,9],[17,10]);
      for(let y=1;y<height-1;y++)candidates.push([2,y],[17,y]);
    }
    let placed=0;
    for(const [x,y] of candidates){
      if(tier!==null && tier<2)break;
      if(!'.~'.includes(rows[y][x])||!safe(x,y))continue;
      if(background && rows.slice(Math.max(0,y-2),y+3).some(row=>row[x]==='#'))continue;
      rows[y][x]='#';
      if(++placed>=(solidCount??(tier===null?Math.min(2,Math.max(1,cells.length)):tier===2?1:2)))break;
    }
    rows=rows.map(r=>r.join(''));
    rows.forEach((row,y)=>Array.from(row).forEach((tile,x)=>{
      const point=center(y*width+x);
      if(keys[tile])structures[keys[tile]]={...structures[keys[tile]],...point};
      if(tile==='#'){
        const props=physical.obstacles.length?physical.obstacles:[{...point,kind:'boulder'}];
        const nearest=props.reduce((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)<Math.hypot(b.x-point.x,b.y-point.y)?a:b);
        obstacles.push({...nearest,...point,w:1/width,h:1/height});
      }
    }));
    const vents=[{x:7.5/width,y:6.5/height,dx:0,dy:1},{x:13.5/width,y:6.5/height,dx:0,dy:-1}];
    const hazards=vents.slice(0,Math.max(0,tier-1)).map((v,i)=>{
      const item=physical.hazards?.[i],spec=typeof item==='string'?{name:item}:item;
      const dx=spec?.dx??v.dx,dy=spec?.dy??v.dy,norm=Math.hypot(dx,dy);
      const free=spec?.x!=null&&spec?.y!=null&&[...Object.values(structures),...obstacles].every(p=>
        Math.abs(p.x-spec.x)>.09||Math.abs(p.y-spec.y)>.12);
      return {...spec,...v,x:free?spec.x:v.x,y:free?spec.y:v.y,dx:norm?dx/norm:v.dx,dy:norm?dy/norm:v.dy,active:true,length:3.2,width:1.55,pushForce:24};
    });
    return {...physical,hazards,surface:{...physical.surface,speedMultiplier:1,drag:.9},grid:rows,structures,obstacles};
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
  // Project tile-space displacement onto the vent's unit flow and cross-flow axes.
  function inFlow(v,p){
    const x=(p.x-v.x)*width,y=(p.y-v.y)*height;
    const along=x*v.dx+y*v.dy,across=-x*v.dy+y*v.dx;
    return along>=0 && along<=v.length && Math.abs(across)<=v.width/2;
  }
  function flowPoint(v,along,across){
    return {x:v.x+(along*v.dx-across*v.dy)/width,y:v.y+(along*v.dy+across*v.dx)/height};
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
    let tethered=false,traced=false,item={...world.structures.checkpoint};
    // Follow the handler's traversed path around corners. Retain only the short
    // length of trail between the specimen and its handler, measured in tiles.
    const trail=[];
    const tileDistance=(a,b)=>Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
    let trailLength=0;
    function follow(){
      const here=pos(),distance=tileDistance(trail.at(-1)||item,here);
      if(distance<.04)return;
      trail.push(here);trailLength+=distance;
      while(trail.length && trailLength>1){
        const next=trail[0],segment=tileDistance(item,next);
        const advance=Math.min(trailLength-1,segment);
        if(advance===segment)item=trail.shift();
        else{
          const t=advance/segment;
          item={x:item.x+t*(next.x-item.x),y:item.y+t*(next.y-item.y)};
        }
        trailLength-=advance;
      }
    }
    function release(){
      tethered=false;traced=false;item={...world.structures.checkpoint};
      trail.length=0;trailLength=0;
    }
    return {pos, specimen:()=>({...item}),get tethered(){return tethered;},get traced(){return traced;},
      inspect(){if(tethered)traced=true;else tethered=true;},
      release,
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
            const walkSpeed=Math.min(speed,Math.hypot(vx,vy)+45*tick);
            if(length<=walkSpeed*tick){x=wp.x*width;y=wp.y*height;waypoints.shift();
              if(!waypoints.length){contact=pending;pending='';vx=vy=0;}
              continue;}
            vx=walkSpeed*ax/length;vy=walkSpeed*ay/length;
          }else{
            const drag=surface.drag**(60*tick),length=Math.hypot(ax,ay)||1;
            vx=drag*vx+(1-drag)*ax/length*speed;vy=drag*vy+(1-drag)*ay/length*speed;
          }
          const vent=world.hazards?.find(v=>v.active && inFlow(v,pos()));
          if(vent){vx+=vent.dx*vent.pushForce*tick;vy+=vent.dy*vent.pushForce*tick;}
          const stepX=vx*tick,stepY=vy*tick;
          if(fits(world.grid,x+stepX,y))x+=stepX;else vx=0;
          if(fits(world.grid,x,y+stepY))y+=stepY;else vy=0;
          if(tethered)follow();
          if(Math.abs(vx)>.05)facing=Math.sign(vx);
          moving ||= Math.hypot(vx,vy)>.08;
        }
        return {...pos(),vx,vy,contact,moving,facing};
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
  return {legacyMap,project,path,surfaceAt,controller,nearby,inFlow,flowPoint};
})();
if(typeof module!=='undefined')module.exports=WorldEngine;
