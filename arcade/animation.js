// Actor transforms are shared by diffusion art and the procedural characters.
const ArcadeHUD = {
  ambientPhase(ms){
    return {travel:ms*.00028%1,glow:.5+.5*Math.sin(ms*.0026)};
  },
  deckBounds(w,h,platform){
    const ratios={compact:[.175,.31,.58],balanced:[.1875,.335,.55],panoramic:[.20,.36,.52]};
    const [margin,top,height]=ratios[platform.sceneryLayout]||ratios.balanced;
    return {x:w*margin,y:h*top,width:w*(1-2*margin),height:h*height};
  },
  drawDeck(ctx,w,h,p){
    const mat=p.material||{},pattern=p.pattern||mat.pattern;
    const styles={cobble:'cobblestone',pavers:'stone_slate',grate:'steel_grating',planks:'wood_deck',tiles:'lab_tile',organic:'organic'};
    p={...p,material:styles[pattern]||mat.name||mat,deckFill:mat.primaryColor||p.deckFill,gridLine:p.groutColor||mat.accentColor||p.gridLine};
    ctx.fillStyle='rgba(0,0,0,.44)';ctx.fillRect(3,7,w-3,h-7);
    ctx.fillStyle=p.borderAccent;ctx.fillRect(0,0,w-3,h-5);
    ctx.fillStyle=p.deckFill;ctx.fillRect(4,4,w-11,h-13);
    ctx.fillStyle=p.gridLine;
    // Texture is baked once per canvas size. Keep each stamp inside the rim.
    const spacing={stone_slate:[40,20],steel_grating:[9,7],wood_deck:[72,12],
      cobblestone:[18,11],lab_tile:[32,26],noir_concrete:[37,22]};
    const [stepX,stepY]=spacing[p.material]||spacing.noir_concrete;
    ctx.save();
    for(let y=5,r=0;y<h-10;y+=stepY,r++){
      const stagger=['stone_slate','wood_deck','cobblestone'].includes(p.material)&&r%2;
      for(let x=5-(stagger?stepX/2:0),col=0;x<w-8;x+=stepX,col++){
        const left=Math.max(5,x),right=Math.min(w-8,x+stepX-1);
        const dx=right-left,dy=Math.min(stepY-1,h-10-y);
        if(dx<4||dy<3)continue;
        ctx.globalAlpha=.48;ctx.fillStyle=p.gridLine;
        switch(p.material){
          case 'stone_slate':{
            const notch=2+(r+col)%3;
            ctx.beginPath();ctx.moveTo(left+notch,y);ctx.lineTo(right,y+1);
            ctx.lineTo(right-2,y+dy-2);ctx.lineTo(left+2,y+dy);ctx.lineTo(left,y+3);ctx.fill();
            ctx.fillStyle=p.deckFill;ctx.globalAlpha=.72;ctx.fillRect(left+3,y+3,dx-5,Math.max(1,dy-6));
            if((col+r)%3===0){ctx.fillStyle='#78845a';ctx.fillRect(left,y+dy-2,4,2);}
            break;
          }
          case 'steel_grating':
            ctx.fillStyle='#0a1419';ctx.fillRect(left+1,y+1,dx-2,dy-2);
            ctx.fillStyle=p.gridLine;ctx.fillRect(left+1,y+dy-1,dx-2,1);break;
          case 'wood_deck':
            ctx.fillRect(left,y,dx,1);ctx.fillRect(left,y,1,dy);
            ctx.globalAlpha=.25;ctx.fillRect(left+3,y+dy/2,dx*.6,1);break;
          case 'cobblestone':
            ctx.beginPath();ctx.ellipse(left+dx/2,y+dy/2,dx/2,dy/2,0,0,2*Math.PI);ctx.fill();
            ctx.globalAlpha=.2;ctx.fillStyle='#fff';ctx.fillRect(left+dx*.3,y+2,dx*.4,1);break;
          case 'lab_tile':
            ctx.fillRect(left,y,dx,dy);ctx.fillStyle=p.deckFill;
            ctx.fillRect(left+2,y+2,dx-3,dy-3);ctx.fillStyle=p.gridLine;ctx.fillRect(left+3,y+3,3,1);break;
          case 'organic':
            ctx.beginPath();ctx.moveTo(left,y+dy);ctx.lineTo(left+dx*.4,y+dy*.4);ctx.lineTo(right,y+1);ctx.strokeStyle=p.gridLine;ctx.stroke();break;
          default:
            ctx.fillRect(left+1,y+1,3,1);ctx.fillRect(right-2,y+dy-2,1,1);
        }
      }
    }
    ctx.restore();
    ctx.fillStyle='rgba(255,255,255,.22)';ctx.fillRect(1,1,w-5,1);
    ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(2,h-7,w-6,2);
    for(const x of [1,w-9])for(const y of [1,h-11]){
      ctx.fillStyle=p.borderAccent;ctx.fillRect(x,y,6,6);
      ctx.fillStyle='#283439';ctx.fillRect(x+2,y+2,2,2);
    }
    const border=p.borderStyle;
    ctx.fillStyle=border==='neon_bevel'?'#cafffb':border==='brass_trim'?'#f2d098':p.gridLine;
    for(const y of [2,h-8]){
      if(['brass_trim','neon_bevel','iron_railing'].includes(border))ctx.fillRect(2,y,w-7,1);
      for(let x=5;x<w-10;x+=border==='stone_curb'?16:30){
        const length=border==='wood_trim'?12:border==='stone_curb'?1:3;
        ctx.fillRect(x,y,length,border==='iron_railing'?5:2);
      }
    }
  },
  drawClimate(ctx,w,h,ms,environment,deck){
    ctx.save();
    const particles=environment.particleConfig?{...environment.particles,...environment.particleConfig}:environment.particles;
    for(const [raw,amount] of [[particles,'density'],[environment.weather,'intensity']]){
      const layer=typeof raw?.type==='object'?{...raw.type,...raw,type:raw.type.name}:raw;
      if(!layer||layer.type==='none'||!layer[amount])continue;
      const count=Math.min(150,Math.ceil((layer.count??30)*layer[amount])),angle=(layer.angle||0)*Math.PI/180;
      ctx.strokeStyle=ctx.fillStyle=layer.color||layer.primaryColor||layer.tint;
      ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=layer.glow||0;
      for(let i=0;i<count;i++){
        const speed=.018*(1+i%4*.25),t=ms*speed;
        let x=(i*.61803*w+t*.24)%w,y=(i*.38197*h+t)%h;
        ctx.globalAlpha=.18+.12*Math.sin(i+ms*.001);
        if(layer.shape||layer.vx!=null||layer.count!=null||layer.vy!=null||layer.size!=null){
          const seconds=ms/1000,size=layer.size??2;
          x=((i*.61803*w+seconds*(layer.vx??4))%w+w)%w;
          y=((i*.38197*h+seconds*(layer.vy??-6))%h+h)%h;
          ctx.globalAlpha=.35+.18*Math.sin(seconds*(layer.pulseHz??.2)*2*Math.PI+i);
          if(layer.shape==='ring'){ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.stroke();}
          else if(['streak','droplet'].includes(layer.shape)){
            const vx=layer.vx??0,vy=layer.vy??1,n=Math.hypot(vx,vy)||1;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+size*vx/n,y+size*vy/n);ctx.stroke();
          }else{
            ctx.fillRect(x,y,size,size);
            if(['flake','spark'].includes(layer.shape))ctx.fillRect(x-size/2,y+size/2,size*2,1);
          }
          continue;
        }
        switch(layer.type){
          case 'rain':{
            const dx=Math.sin(angle),dy=Math.cos(angle);
            x=((i*.61803*w+t*dx)%w+w)%w;y=((i*.38197*h+t*dy)%h+h)%h;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*9,y+dy*9);ctx.stroke();
            if(deck&&i%5===0){ctx.beginPath();ctx.ellipse(deck.x+deck.width*(i*.61803%1),deck.y+deck.height*(i*.38197%1),1+(ms*.006+i)%5,1,0,0,2*Math.PI);ctx.stroke();}
            break;
          }
          case 'snow':ctx.fillRect(x+5*Math.sin(t*.04+i),y,3,3);break;
          case 'fog':case 'clouds':{
            const fog=layer.type==='fog',span=w*(fog ? .42 : .12);
            const top=h*(i*.38197%1)*(fog ? .85 : .42);
            ctx.globalAlpha=fog ? .042 : .1;
            ctx.fillRect(x-span/2,top,span,5+i%8);
            ctx.fillRect(x-span*.35,top-3,span*.6,4);
            break;
          }
          case 'sun_rays':
            ctx.globalAlpha=.032;
            ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+4,0);
            ctx.lineTo(x-w*.13+18,h*.65);ctx.lineTo(x-w*.13,h*.65);ctx.fill();break;
          case 'wind_streaks':ctx.fillRect(x,y,w*.028,1);break;
          case 'stars':ctx.fillRect(i*.61803*w%w,i*.38197*h%(h*.48),2,2);break;
          case 'bubbles':ctx.beginPath();ctx.arc(x,h-y,1+i%3,0,Math.PI*2);ctx.stroke();break;
          default:case 'embers':case 'dust':case 'spores':case 'neon_glints':
            ctx.fillRect(x+3*Math.sin(i+t*.03),h-y,2,layer.type==='embers'?4:2);
            if(layer.type==='spores'||layer.type==='neon_glints')ctx.fillRect(x-1,h-y+1,5,1);
            break;
        }
      }
    }
    ctx.restore();
  },
  drawAtmosphere(ctx,w,h,ms,theme={}){
    ctx.save();
    ctx.globalAlpha=.32;
    ctx.fillStyle=theme.environment?.accent_color||theme.accent||theme.palette?.team0||'#b9dfd7';
    const bubbles=ArcadeHUD.handlerStyle(theme)==='diver';
    for(let i=0;i<24;i++){
      const speed=1+(i%5)*.18;
      const x=((i*.61803*w+ms*.004*speed)%w)+Math.sin(ms*.0007+i)*3;
      const y=h-(i*.38197*h+ms*(bubbles ? .011 : .005)*speed)%h;
      if(bubbles){
        ctx.strokeStyle=ctx.fillStyle;
        ctx.beginPath();ctx.arc(x,y,1+i%2*.5,0,2*Math.PI);ctx.stroke();
      }else ctx.fillRect(x,y,2+i%2,2);
    }
    ctx.restore();
  },
  drawConduits(ctx,w,h,structures,phase,color){
    const {checkpoint,leftTarget,rightTarget}=structures;
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;
    for(const bay of [leftTarget,rightTarget]){
      const ax=checkpoint.x*w,ay=checkpoint.y*h,bx=bay.x*w,by=bay.y*h;
      ctx.globalAlpha=.28;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
      ctx.globalAlpha=.78;ctx.fillRect(ax+(bx-ax)*phase.travel-2,ay+(by-ay)*phase.travel-1,4,2);
    }
    ctx.restore();
  },
  drawWave(ctx,jagged,ms){
    ctx.clearRect(0,0,48,12);ctx.beginPath();
    ctx.strokeStyle=jagged?'#efbc76':'#79d6bf';
    for(let x=0;x<48;x++){
      const t=x*.22+ms*.003;
      const y=6+(jagged?2*Math.sin(3*t)+2*Math.sin(5.7*t):3*Math.sin(t));
      if(x)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    }
    ctx.stroke();
  },
  handlerStyle(theme={}){
    const setting=[theme.title,theme.setting,theme.environment?.setting_name,theme.environment?.layout].join(' ');
    if(/reef|underwater|ocean|subsea|marine|coral|abyss|aquatic/i.test(setting))return 'diver';
    if(/forest|garden|park|grove|wilderness|ranger/i.test(setting))return 'ranger';
    if(/detective|investigat|noir|evidence|precinct/i.test(setting))return 'detective';
    return 'technician';
  },
  drawHandler(ctx,x,y,state,style,accent,now){
    const stride=state.moving?Math.sin(now/(style==='diver'?160:95)):0;
    ctx.save();ctx.translate(Math.round(x),Math.round(y-Math.abs(stride)*2+Math.sin(now*.003)*1.1));ctx.scale(state.facing*2,2);
    const pixel=(color,x,y,w,h)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
    const ink='#172432',light='#d9ebe5';
    for(const side of [-1,1]){
      const foot=Math.round(side*stride);
      pixel(ink,side*3-2,-5+foot,4,5);pixel(light,side*3-2,-2+foot,style==='diver'?6:4,2);
    }
    pixel(ink,-6,-16,12,12);pixel(style==='technician'?light:accent,-5,-15,10,9);
    pixel(accent,-6,-12,3,6);pixel(ink,2,-10,5,3);
    pixel(ink,-6,-25,12,10);pixel(accent,-5,-24,10,8);
    if(style==='diver'){
      pixel(ink,-8,-16,3,9);pixel(ink,-3,-22,10,5);pixel('#98dfeb',-2,-21,8,3);pixel(light,3,-21,2,1);
    }else{
      pixel('#cc9877',-3,-21,8,5);pixel(ink,3,-20,1,2);
      if(style==='technician')pixel('#84bec9',-3,-21,9,2);
      else{pixel(style==='ranger'?'#8b7847':'#726582',-8,-23,17,2);pixel(light,-4,-16,3,3);}
    }
    ctx.restore();
  },
  drawScenery(ctx,item,x,y,image,accent){
    const descriptor=item.kind||item.style;
    const visual=typeof descriptor==='object'?{...descriptor,...item}:item;
    if(image){ctx.drawImage(image,x-19,y-34,38,38);return;}
    const label=visual.name||visual.kind||visual.label;
    const span=10+String(label||'').length%6;
    ctx.save();ctx.fillStyle=visual.primaryColor||'#394950';ctx.fillRect(x-span,y-12,span*2,14);
    ctx.fillStyle=visual.accentColor||accent;ctx.fillRect(x-span-2,y-15,span*2+4,5);
    if(typeof label==='string'){
      ctx.textAlign='center';ctx.font='9px monospace';ctx.fillText(label.replace(/_/g,' '),x,y-18,80);
    }
    ctx.restore();
  },
  drawVent(ctx,v,w,h,accent,now,image){
    const x=Math.round(v.x*w),y=Math.round(v.y*h);
    ctx.save();accent=v.accentColor||accent;
    if(v.name||image)this.drawScenery(ctx,v,x,y,image,accent);
    else{ctx.fillStyle='#243438';ctx.fillRect(x-14,y-4,28,9);}
    ctx.globalAlpha=v.active ? .65+.35*ArcadeHUD.ambientPhase(now).glow : 1;
    ctx.fillStyle=v.active?accent:'#627471';
    for(let i=-9;i<=9;i+=6)ctx.fillRect(x+i,y-3,2,6);
    const point=(along,across)=>WorldEngine.flowPoint(v,along,across);
    ctx.strokeStyle=accent;
    for(let i=0;i<6;i++){
      const phase=v.active?(now/1200+i/6)%1:i/6;
      const tail=phase*(v.length-.22),tip=point(tail+.22,0);
      ctx.globalAlpha=v.active?.42:.08;
      ctx.beginPath();
      for(const edge of [-1,1]){
        const wing=point(tail,edge*v.width/2);
        ctx.moveTo(wing.x*w,wing.y*h);ctx.lineTo(tip.x*w,tip.y*h);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
  drawPrediction(ctx,x,y,flight,bx,by,impact){
    ctx.save();ctx.textAlign='center';ctx.font='bold 12px monospace';
    const tag=flight.name+' ('+flight.confidence+'%)';
    ctx.lineWidth=3;ctx.strokeStyle='#15232c';ctx.fillStyle='#fff';
    ctx.strokeText(tag,x,y);ctx.fillText(tag,x,y);
    if(impact){
      ctx.fillStyle=flight.correct?'#60d99c':'#ff726c';ctx.globalAlpha=impact;
      ctx.fillRect(bx-32,by+4,64,4);
      for(let i=0;i<10;i++){
        const a=i*Math.PI/5,r=10+(1-impact)*34;
        ctx.fillRect(bx+Math.cos(a)*r,by+Math.sin(a)*r*.5,3,3);
      }
      ctx.fillText(flight.correct?'✓':'✗ '+flight.cue,bx,by-24);
    }
    ctx.restore();
  },
  spawnOpening(now,end){
    const left=end-now;
    return left<=0||left>500?0:Math.min(1,(500-left)/100,left/180);
  },
  structureActivity(now,scanTime,members,lanes){
    const gates=Array(lanes).fill(0);
    for(const member of members){
      if(member.sinceContact<0)continue;
      gates[member.side]=Math.max(gates[member.side],1-member.sinceContact/450);
    }
    return {scan:Math.min(1,Math.max(0,1-(now-scanTime)/600)),gates};
  },
  stationDepth(station,entries,width,height){
    const x=station.x*width,y=station.y*height;
    let depth=y-1;
    for(const actor of entries){
      if(Math.abs(actor.x-x)<=Math.max(55,station.width*width/2) &&
         Math.abs(actor.footY-y)<=Math.max(50,station.height*height/2)){
        depth=Math.min(depth,actor.footY-1);
      }
    }
    return depth;
  },
  paintByDepth(entries){
    entries.sort((a,b)=>a.footY-b.footY);
    for(const entry of entries)entry.draw();
  },
  drawAvatarIcon(target,image,spec,size){
    ArcadeEnvironment.drawAvatarIcon(target,image,spec,size);
  },
  drawEntitySprite(ctx,image,spec,size,now,mode='idle') {
    const elapsed=now/125, frame=Math.floor(elapsed), wave=Math.sin(elapsed*Math.PI/2);
    const walking=mode==='walk', celebrating=mode==='celebrate';
    ctx.save();
    ctx.translate(size/2,size);
    const bounce=walking?Math.abs(wave)*size*.025:0;
    ctx.translate(0,-bounce);
    ctx.rotate(walking||celebrating?wave*.05:0);
    ctx.scale(1,1+(walking?0:.025*wave));
    ctx.translate(-size/2,-size);
    this.drawAvatarIcon(ctx,image,{...spec,frame,stride:walking?Math.round(2*wave):0,blink:frame%16===3},size);
    ctx.restore();
  },
  createCohort(world) {
    const motion=typeof module==='undefined'?ArcadeWorld:require('./world');
    const members=[],counts=[];
    return {
      add(actor,side,correct,now,x,y){
        const index=counts[side]||0,z=motion.zone(world,side);
        counts[side]=index+1;
        const approach=motion.route({x,y},z,world);
        const place={x:z.x+(index%5-2)*.022,y:z.y+z.height/2+.06+Math.floor(index/5)*.04};
        const formation=motion.route(z,place,world);
        members.push({actor,side,index,correct,start:now,approach,formation});
      },
      frame(now,laneCount){
        const arrived=Array(laneCount).fill(0);
        const actors=members.map(member=>{
          const age=now-member.start,sinceContact=age-member.approach.duration;
          const path=sinceContact<0?member.approach:member.formation;
          const elapsed=sinceContact<0?age:sinceContact;
          const walking=elapsed<path.duration;
          if(!walking)arrived[member.side]++;
          const trails=motion.trail(member.approach,age);
          if(sinceContact>=0)trails.push(...motion.trail(member.formation,sinceContact));
          return {...member,...motion.position(path,elapsed),trails,sinceContact,walking,age,
            size:84-60*Math.min(1,age/(member.approach.duration+member.formation.duration||1))};
        });
        return {actors,arrived};
      }
    };
  },
  spawnCallout(entity, outcome, now) {
    return {...outcome,x:entity.x,y:entity.y,entity:{...entity},start:now};
  },
  pose(time,index,vx,age,feedback,strideTime=time) {
    const step=Math.sin(strideTime/125+index),stride=Math.abs(step),spawn=Math.max(0,1-age/320);
    const t=feedback?Math.max(0,(time-feedback.start)/700):1;
    const kick=t<1?Math.sin(Math.PI*t):0, flash=feedback?.correct?kick:0;
    return {dy:-stride*2,dx:feedback&&!feedback.correct?Math.sin(t*40)*kick*5:0,
      tilt:step*Math.PI/45, sx:(vx<0?-1:1)*(1+spawn*.23+flash*.12),sy:1-spawn*.25+flash*.1,
      shadow:1-stride*.08};
  },
  drawCallout(ctx,e,now){
    const t=(now-e.start)/700;if(t<0||t>=1)return;
    ctx.save();ctx.translate(e.x,e.y);ctx.globalAlpha=Math.min(1,(1-t)*3);
    ctx.strokeStyle=e.correct?'#46ed9d':'#ff574c';ctx.lineWidth=2;
    ctx.beginPath();ctx.ellipse(0,12,11+25*t,4+9*t,0,0,2*Math.PI);ctx.stroke();
    ctx.fillStyle=e.correct?'#ffdc6e':'#ff9a45';
    for(let i=0;i<10;i++){
      const a=i*2.4,x=Math.cos(a)*(7+22*t),y=Math.sin(a)*12*t-(e.correct?27*t:0);
      if(e.correct){ctx.fillRect(x-2,y,5,1);ctx.fillRect(x,y-2,1,5);}
      else{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+5*Math.cos(a),y+6*Math.sin(a));ctx.lineTo(x+2,y-2);ctx.fill();}
    }
    ctx.translate(0,-25-t*10);ctx.rotate(e.correct?-.07:.09);ctx.font='bold 11px Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    const width=ctx.measureText(e.text).width+8;
    ctx.fillStyle=e.correct?'#135641':'#872c32';ctx.fillRect(-width/2,-8,width,14);
    ctx.fillStyle=e.correct?'#ffea97':'#fff1cb';ctx.textAlign='center';ctx.fillText(e.text,0,2);ctx.restore();
  }
};
if(typeof module!=='undefined')module.exports=ArcadeHUD;
