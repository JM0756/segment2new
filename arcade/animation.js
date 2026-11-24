// Actor transforms are shared by diffusion art and the procedural characters.
const ArcadeHUD = {
  handlerStyle(theme){
    const setting=[theme.title,theme.setting,theme.environment?.setting_name,theme.environment?.layout].join(' ');
    if(/reef|underwater|ocean|subsea|marine|coral|abyss|aquatic/i.test(setting))return 'diver';
    if(/forest|garden|park|grove|wilderness|ranger/i.test(setting))return 'ranger';
    if(/detective|investigat|noir|evidence|precinct/i.test(setting))return 'detective';
    return 'technician';
  },
  drawHandler(ctx,x,y,state,style,accent,now){
    const stride=state.moving?Math.sin(now/(style==='diver'?160:95)):0;
    ctx.save();ctx.translate(Math.round(x),Math.round(y-Math.abs(stride)*2));ctx.scale(state.facing*2,2);
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
  drawVent(ctx,v,w,h,accent,now){
    const x=Math.round(v.x*w),y=Math.round(v.y*h);
    ctx.save();ctx.fillStyle='#243438';ctx.fillRect(x-14,y-4,28,9);
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
