// Actor transforms are shared by diffusion art and the procedural characters.
const ArcadeHUD = {
  drawAvatarIcon(target,image,spec,size){
    ArcadeEnvironment.drawAvatarIcon(target,image,spec,size);
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
