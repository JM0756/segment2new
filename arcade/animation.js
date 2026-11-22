// Actor transforms are shared by diffusion art and the procedural characters.
const ArcadeHUD = {
  drawAvatarIcon(target,image,spec,size){
    ArcadeEnvironment.drawAvatarIcon(target,image,spec,size);
  },
  drawEntitySprite(ctx,image,spec,size,now,mode='idle') {
    const elapsed=now/125, frame=Math.floor(elapsed), wave=Math.sin(elapsed*Math.PI/2);
    const walking=mode==='walk', celebrating=mode==='celebrate';
    ctx.save();
    ctx.translate(size/2,size);
    const bounce=celebrating?Math.abs(wave)*size*.17:walking?Math.abs(wave)*size*.08:0;
    ctx.translate(0,-bounce);
    ctx.rotate(walking?wave*.09:0);
    ctx.scale(1,1+(walking?0:.025*wave));
    ctx.translate(-size/2,-size);
    this.drawAvatarIcon(ctx,image,{...spec,frame,stride:walking?Math.round(2*wave):0,blink:frame%16===3},size);
    ctx.restore();
  },
  laneCenter(side,total){
    if(side===0)return .22;
    if(side===1)return .78;
    return .22+.56*(side-1)/(total-1);
  },
  createCohort() {
    const members=[],counts=[], laneCenter=this.laneCenter;
    return {
      add(actor,side,correct,now,x=.5,y=.5){
        const index=counts[side]||0;
        counts[side]=index+1;
        members.push({actor,side,index,correct,start:now,x,y});
      },
      frame(now,laneCount){
        const arrived=Array(laneCount).fill(0);
        const actors=members.map(member=>{
          const t=Math.min(1,Math.max(0,(now-member.start)/380)),ease=1-(1-t)**3;
          const lane=laneCenter(member.side,laneCount);
          const dx=lane+(member.index%5-2)*.030,dy=.69+Math.floor(member.index/5)*.047;
          if(t===1)arrived[member.side]++;
          return {...member,x:member.x+(dx-member.x)*ease,y:member.y+(dy-member.y)*ease,
            size:40-23*ease,walking:t<1,age:now-member.start};
        });
        return {actors,arrived};
      }
    };
  },
  spawnCallout(entity, outcome, now) {
    return {...outcome,x:entity.x,y:entity.y,entity:{...entity},start:now};
  },
  pose(time,index,vx,age,feedback) {
    const step=Math.sin(time/125+index),stride=Math.abs(step),spawn=Math.max(0,1-age/320);
    const t=feedback?Math.max(0,(time-feedback.start)/700):1;
    const kick=t<1?Math.sin(Math.PI*t):0, jump=feedback?.correct?kick:0;
    return {dy:-stride*2-jump*13,dx:feedback&&!feedback.correct?Math.sin(t*40)*kick*5:0,
      tilt:step*Math.PI/45, sx:(vx<0?-1:1)*(1+spawn*.23+jump*.12),sy:1-spawn*.25+jump*.1,
      shadow:1-stride*.08-jump*.24};
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
