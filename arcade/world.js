// Physics is expressed on a normalized ground plane. Rendering and hit testing
// use the same projection, including when the stage changes size.
const ArcadeWorld = (() => {
  const clearance=.012, clamp=n=>Math.max(.015,Math.min(.985,n));
  const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
  function forLegacyConfig({theme,archetype},template,materials){
    const env=theme.environment||{},world=JSON.parse(JSON.stringify(template));
    const hints=[env.setting_name,env.layout,theme.setting,theme.title];
    const material=hints.map(h=>Object.keys(materials).find(k=>new RegExp(materials[k].pattern,'i').test(h||''))).find(Boolean)||'stone';
    const {speedMultiplier,drag,trailStyle,kind,portal}=materials[material];
    world.surface={type:material,speedMultiplier,drag,trailStyle,trailColor:env.accent_color||theme.accent||'#b4c8ce'};
    const {entry,checkpoint,leftTarget,rightTarget}=world.structures;
    Object.assign(entry,{style:portal,label:env.setting_name||theme.title});
    if(!['audit','threshold','sorter'].includes(archetype)){
      leftTarget.style=rightTarget.style=portal;
      checkpoint.reaction=['grass','stone'].includes(material)?'rune_pulse':'scan_ring';
    }
    for(const o of world.obstacles)o.kind=kind;
    return world;
  }
  function bounds(o){
    return {left:o.x-o.w/2-clearance,right:o.x+o.w/2+clearance,
      top:o.y-o.h/2-clearance,bottom:o.y+o.h/2+clearance};
  }
  function safePoint(point,boxes){
    const p={x:clamp(point.x),y:clamp(point.y)};
    for(const b of boxes){
      if(p.x<=b.left||p.x>=b.right||p.y<=b.top||p.y>=b.bottom)continue;
      const edges=[{x:b.left,y:p.y},{x:b.right,y:p.y},{x:p.x,y:b.top},{x:p.x,y:b.bottom}]
        .filter(q=>q.x===clamp(q.x)&&q.y===clamp(q.y));
      return edges.reduce((a,c)=>distance(c,p)<distance(a,p)?c:a);
    }
    return p;
  }
  function crosses(a,b,box){
    // Intersect the open interior of an inflated footprint with this segment.
    let lo=0,hi=1;
    for(const [axis,min,max] of [['x',box.left,box.right],['y',box.top,box.bottom]]){
      const d=b[axis]-a[axis],start=a[axis];
      if(Math.abs(d)<1e-9){if(start<=min||start>=max)return false;continue;}
      const t0=(min-start)/d,t1=(max-start)/d;
      lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
    }
    return hi-lo>1e-8;
  }
  function roundTurns(points,boxes){
    if(points.length<3)return points;
    const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    const turns=points.map((p,i)=>{
      if(i===0||i===points.length-1)return p;
      const a=points[i-1],b=points[i+1];
      const dx=(p.x-a.x)/distance(a,p)+(p.x-b.x)/distance(b,p);
      const dy=(p.y-a.y)/distance(a,p)+(p.y-b.y)/distance(b,p);
      const offset=.012/(Math.hypot(dx,dy)||1);
      return {x:clamp(p.x+dx*offset),y:clamp(p.y+dy*offset)};
    });
    const arc=[points[0]];
    for(let i=1;i<turns.length-1;i++){
      const p=turns[i],a=turns[i-1],b=turns[i+1];
      const trim=Math.min(.02,distance(a,p)/3,distance(b,p)/3);
      const start=mix(p,a,trim/(distance(a,p)||1)),end=mix(p,b,trim/(distance(b,p)||1));
      for(let step=0;step<=4;step++){
        const t=step/4;
        arc.push(mix(mix(start,p,t),mix(p,end,t),t));
      }
    }
    arc.push(points.at(-1));
    // In a tight passage the original path preserves the entire foot clearance.
    return arc.some((p,i)=>i && boxes.some(b=>crosses(arc[i-1],p,b)))?points:arc;
  }
  function route(from,to,world){
    const boxes=world.obstacles.map(bounds);
    const nodes=[safePoint(from,boxes),safePoint(to,boxes)];
    for(const b of boxes)for(const x of [b.left,b.right])for(const y of [b.top,b.bottom]){
      if(x>=.015&&x<=.985&&y>=.015&&y<=.985)nodes.push({x,y});
    }
    // With four obstacles this visibility graph has at most eighteen vertices.
    const costs=nodes.map(()=>Infinity),prev=[],visited=new Set();
    costs[0]=0;
    while(true){
      let i=-1;
      nodes.forEach((_,j)=>{if(!visited.has(j)&&Number.isFinite(costs[j])&&(i<0||costs[j]<costs[i]))i=j;});
      if(i<0||i===1)break;
      visited.add(i);
      nodes.forEach((p,j)=>{
        const cost=costs[i]+distance(nodes[i],p);
        if(cost<costs[j]&&!boxes.some(b=>crosses(nodes[i],p,b))){costs[j]=cost;prev[j]=i;}
      });
    }
    const points=[nodes[0]];
    if(Number.isFinite(costs[1])){
      const chain=[];
      for(let j=1;j!==0;j=prev[j])chain.push(nodes[j]);
      points.push(...chain.reverse());
    }
    const path=roundTurns(points,boxes);
    const length=path.reduce((sum,p,i)=>i?sum+distance(path[i-1],p):0,0);
    const duration=length*1900/world.surface.speedMultiplier;
    return {points:path,length,duration,drag:world.surface.drag};
  }
  function position(path,age){
    const t=path.duration?Math.max(0,Math.min(1,age/path.duration)):1;
    const ease=t*t*(3-2*t),glide=(path.drag-.8)/.18;
    let remaining=path.length*(ease*(1-glide)+t*glide);
    for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i],len=distance(a,b);
      if(remaining<len)return {x:a.x+(b.x-a.x)*remaining/len,y:a.y+(b.y-a.y)*remaining/len};
      remaining-=len;
    }
    return path.points[path.points.length-1];
  }
  function trail(path,age){
    const marks=[];
    for(let t=Math.ceil(Math.max(0,age-450)/55)*55;t<=Math.min(age,path.duration);t+=55){
      marks.push({...position(path,t),alpha:1-(age-t)/450,step:t/55});
    }
    return marks;
  }
  function zone(world,side){
    const {leftTarget,rightTarget}=world.structures;
    if(side===0)return leftTarget;
    if(side===1)return rightTarget;
    return {...leftTarget,x:(leftTarget.x+rightTarget.x)/2,y:Math.min(.85,leftTarget.y+.2)};
  }
  function targetAt(world,p){
    for(const side of [0,1]){
      const z=zone(world,side);
      if(Math.abs(p.x-z.x)<=z.width/2&&Math.abs(p.y-z.y)<=z.height/2)return side;
    }
    const c=world.structures.checkpoint;
    return distance(c,p)<=c.radius?'checkpoint':null;
  }
  return {forLegacyConfig,route,position,trail,zone,targetAt};
})();
if(typeof module!=='undefined')module.exports=ArcadeWorld;
