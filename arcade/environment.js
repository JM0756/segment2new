// Scene geometry is shared by the arena, library banners and saved activity cards.
const ArcadeEnvironment = (() => {
  function rect(ctx, color, x, y, w, h) {
    ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));
  }
  function oval(ctx,color,x,y,rx,ry,angle=0){
    ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,angle,0,2*Math.PI);ctx.fill();
  }
  function viewport(ctx,x,y,w,h,planet){
    rect(ctx,'#121e32',x-3,y-3,w+6,h+6);
    rect(ctx,'#8ea1b7',x-1,y-1,w+2,h+2);
    rect(ctx,'#111c38',x,y,w,h);
    for(let i=0;i<44;i++){
      const sx=x+2+(i*47+i*i)%Math.max(1,w-5),sy=y+2+(i*13+i*i)%Math.max(1,h-5);
      rect(ctx,i%4?'#96bfdd':'#f3ead0',sx,sy,i%7?1:2,1);
    }
    if(planet){
      const r=Math.min(h*.31,w*.13),px=x+w*.64,py=y+h*.47;
      oval(ctx,'#dea97a',px,py,r,r);
      oval(ctx,'#dcac83',px,py,r*1.75,r*.22,-.25);
      ctx.strokeStyle='#fff0b6';ctx.lineWidth=1.4;ctx.beginPath();ctx.ellipse(px,py,r*1.75,r*.22,-.25,0,Math.PI);ctx.stroke();
    }
  }
  const settings = [
    ['speakeasy', /speakeasy|cabaret|prohibition|jazz club/i],
    ['party', /frat|party|dancefloor|disco|nightclub/i],
    ['wasteland', /fallout|wasteland|apocalyp|zombie|radioactive/i],
    ['clinical', /autoimmune|clinic|hospital|immune|antibod/i],
    ['laboratory', /laboratory|lab\b|research facility/i],
    ['archive', /archive|library/i],
    ['newsroom', /newsroom|journalis|editorial|reporter/i],
    ['space-station', /space.station|orbital|starship|airlock/i]
  ];
  function layoutFor(theme){
    const env=theme.environment||{};
    if(settings.some(([name])=>name===env.layout))return env.layout;
    for(const hint of [theme.name,theme.title,theme.setting,env.setting_name,theme.theme,env.preset]){
      const match=settings.find(([,pattern])=>pattern.test(hint||''));
      if(match)return match[0];
    }
    return 'custom';
  }
  function drawAvatarIcon(target,image,{theme={},slot=0,facing=1}={},size=32){
    let ctx=target;
    if(typeof target.fillRect!=='function'){
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=size;
      canvas.setAttribute('aria-hidden','true');
      target.append(canvas);
      ctx=canvas.getContext('2d');
    }
    if(!ctx)return;
    ctx.save();
    ctx.translate(facing<0?size:0,0);
    ctx.scale((facing<0?-1:1)*size/32,size/32);
    if(image?.naturalWidth && image.naturalHeight){
      const scale=32/Math.max(image.naturalWidth,image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      blit(ctx,image,(32-w)/2,(32-h)/2,w,h);
    }else{
      const layout=layoutFor(theme),android=slot===1, ink='#182637';
      const suit=theme.palette?.['team'+slot]||(android?'#e2a566':'#69ced0');
      const r=(color,x,y,w,h)=>rect(ctx,color,x,y,w,h);
      // Boots, gloves, torso and the offset eyes keep the silhouette readable at 32px.
      r(ink,8,18,15,10);r(suit,9,19,13,7);
      r(ink,6,19,4,8);r(suit,6,20,3,5);r(ink,22,19,4,7);r(suit,23,20,3,4);
      r(ink,9,26,5,5);r(ink,18,26,5,5);r('#9bacb5',9,29,4,1);r('#9bacb5',19,29,4,1);
      r(ink,6,5,20,15);r(suit,7,6,18,12);
      if(layout==='space-station'){
        r('#26465a',9,9,16,7);r(android?'#ffcf78':'#acffff',13,10,android?3:10,2);
        if(android){r(ink,18,2,2,4);r('#ffbd56',17,1,4,2);}
      }else{
        r(android?'#cc8f62':'#f1c99e',10,9,15,9);
        r(ink,16,12,2,3);r(ink,22,12,2,3);
        if(layout==='speakeasy'||layout==='newsroom'||layout==='archive'){
          r(ink,9,2,14,5);r('#cd9667',9,5,14,2);r(ink,5,7,22,2);
        }else if(layout==='wasteland'||layout==='clinical'||layout==='laboratory'){
          r('#3a5063',8,10,18,5);r('#8be0dc',14,11,5,2);r('#8be0dc',21,11,3,2);
        }else{r(ink,8,4,15,3);r(suit,5,7,20,2);}
      }
      r('#fbe2a9',18,20,3,3);
    }
    ctx.restore();
  }
  function prop(ctx,id,x,y,accent){
    ctx.save();ctx.translate(x,y);
    const r=(color,x,y,w,h)=>rect(ctx,color,x,y,w,h);
    const dark='#202734',gold='#d5ad73';
    switch(id){
      case 'viewport':viewport(ctx,-15,-8,30,12,false);break;
      case 'airlock':case 'barriers':
        r(dark,-15,-6,30,10);for(let i=-13;i<13;i+=6)r(gold,i,-5,3,7);break;
      case 'consoles':case 'dj_booth':
        r(dark,-17,-10,34,16);r('#566675',-15,-8,30,6);
        if(id==='dj_booth'){oval(ctx,'#141b29',-8,-5,5,3);oval(ctx,'#141b29',8,-5,5,3);}
        else{r(accent,-13,-7,13,4);r('#ecd090',4,-7,6,2);}
        for(let i=-12;i<13;i+=5)r(accent,i,1,2,1);break;
      case 'red_cups':
        r('#795641',-17,1,34,4);for(const i of [-11,0,9]){r('#b8414a',i,-6,6,8);r('#fde2be',i-1,-7,8,2);}break;
      case 'string_lights':
        for(let i=-18;i<=18;i+=3){const drop=4-Math.abs(i)/6;r(dark,i,drop,4,1);if(!(i%6))r(accent,i,drop+1,2,3);}break;
      case 'dance_tiles':
        for(let i=0;i<8;i++)r(i%3?accent:'#d2a5dd',-13+i%4*7,-7+Math.floor(i/4)*7,6,6);break;
      case 'velvet_booths':
        r(dark,-17,-8,34,15);r('#84384d',-15,-7,30,9);r('#af5467',-15,2,30,3);
        for(const i of [-10,0,10])r(gold,i,-4,1,1);break;
      case 'brass_rail':r(gold,-18,-6,36,2);r(gold,-15,-6,2,14);r(gold,13,-6,2,14);break;
      case 'stage_spotlight':case 'desk_lamps':
        r(dark,-2,-9,3,13);r(gold,-7,4,14,2);r(accent,-7,-10,14,4);
        oval(ctx,'#ffe4a52e',4,1,12,4);break;
      case 'barrels':oval(ctx,dark,0,4,10,4);r('#7b7857',-9,-9,18,13);oval(ctx,'#b5ad7c',0,-9,9,3);r(dark,-9,-2,18,2);break;
      case 'rubble':for(let i=0;i<9;i++)r(i%2?'#657173':'#475052',i*9%30-14,i*7%12-6,3+i%5,3);break;
      case 'trees':r('#554633',-2,-6,4,15);oval(ctx,'#304d44',0,-8,12,9);oval(ctx,'#598569',-3,-10,8,6);break;
      case 'shelves':r(dark,-15,-10,30,17);for(let i=-12;i<13;i+=4)r(i%3?gold:accent,i,-7,2,10);break;
      default:r('#795f49',-10,-8,20,14);r('#af9470',-10,-8,20,2);r('#af9470',-2,-8,3,14);
    }
    ctx.restore();
  }
  function architecture(ctx,layout,e,accent){
    const r=(color,x,y,w,h)=>rect(ctx,color,x,y,w,h);
    const o=(color,x,y,rx,ry)=>oval(ctx,color,x,y,rx,ry);
    const line=(color,x,y,dx,dy)=>{
      const steps=Math.max(Math.abs(dx),Math.abs(dy));
      for(let i=0;i<=steps;i++)r(color,x+dx*i/steps,y+dy*i/steps,1,1);
    };
    if(layout==='speakeasy'){
      r('#553324',0,0,320,140);
      for(let y=36;y<146;y+=8)for(let x=-16;x<320;x+=16){
        line('#94674a',x,y,8,-6);line('#764d35',x+8,y-6,8,6);
      }
      r('#641f39',0,0,320,35);
      for(let x=0;x<320;x+=9){r('#922e43',x,0,5,32+x%4);r('#401d31',x+6,0,2,35);}
      r('#361c20',85,18,150,18);r('#cd9b55',82,17,156,3);r('#bd874b',86,32,148,2);
      for(let i=0;i<13;i++){const x=96+i*10,c=['#618575','#be8464','#acc5a0'][i%3];r(c,x,11,4,6);r(c,x+1,8,2,4);}
      for(const x of [41,278]){
        o('#ffd57622',x,48,25,10);r('#e3b96f',x-5,0,10,3);
        for(const y of [68,110]){r('#372531',x-2,y,4,13);o('#b98a57',x,y,13,5);r('#e9bc7a',x-1,y-5,2,5);}
      }
    }else if(layout==='party'){
      const colors=['#434972','#7c537e','#396176','#665483'];
      r('#272840',0,0,320,140);
      for(let y=32;y<140;y+=15)for(let x=0;x<320;x+=22){
        r(colors[(x/22+(y-32)/15)%4],x,y,21,14);r('#ffffff2b',x+1,y+1,12,1);
      }
      for(let x=0;x<320;x+=4){
        const drop=3+Math.round(Math.abs(Math.sin(x/33))*6);
        r('#b29cb9',x,drop,4,1);if(x%12===0)r(['#fabc72','#ff6eac','#7aece3'][x/12%3],x,drop+1,3,4);
      }
      r('#1c1936',117,17,86,22);r('#fb68ba',118,31,84,2);
      for(const x of [138,181]){o('#687189',x,21,10,4);o('#292c4c',x,21,4,2);}
      for(const x of [98,211]){r('#242339',x,12,12,26);o('#83728d',x+6,20,4,4);o('#af79aa',x+6,31,5,5);}
      prop(ctx,'red_cups',27,91,accent);prop(ctx,'red_cups',295,104,accent);
    }else if(layout==='wasteland'){
      r('#b48758',0,0,320,140);
      for(let i=0;i<180;i++)r('#8d674c',(i*79)%320,(i*i*7)%140,2+i%4,1);
      for(let i=0;i<16;i++){
        const x=i*71%320,y=32+i*43%102;
        line('#634e43',x,y,8,-4);line('#634e43',x+8,y-4,9,1);line('#745743',x+8,y-4,2,-6);
      }
      for(const x of [2,65,208,270]){
        r('#8c5038',x,6,50,23);for(let j=2;j<50;j+=5)r('#b67955',x+j,7,2,20);
      }
      for(const x of [23,295]){
        prop(ctx,'barrels',x,49,accent);r('#b4dc58',x-5,46,10,4);
        for(let i=0;i<5;i++)o('#a79770',x-9+i%3*8,111-Math.floor(i/3)*5,6,3);
        prop(ctx,'rubble',x+4,126,accent);
      }
    }else if(layout==='laboratory'||layout==='clinical'){
      r('#8ba9ad',0,0,320,140);
      for(let y=27;y<140;y+=13)for(let x=0;x<320;x+=18)r('#c9d9d4',x,y,17,12);
      r('#536e80',0,0,320,30);
      for(const x of [15,69,232,286]){
        r('#2c4d5b',x,3,19,27);r('#6fd8cf',x+2,5,15,21);o('#4caca7',x+10,17,4,6);
        r('#d1f8ea',x+3,6,2,17);r('#324e59',x-1,26,21,4);
      }
      r('#485e70',109,20,102,10);r('#c5eae0',108,19,104,3);
      for(const x of [126,177]){r('#33445a',x,8,3,11);r('#33445a',x-3,17,12,2);line('#a5e7e5',x,8,7,-5);r('#d3ece7',x+6,2,3,5);}
      for(const x of [37,282]){r('#36d2ca66',x,34,1,99);r('#68dce344',x-10,89,20,1);}
    }else{
      r('#735948',0,0,320,140);r('#854c4a',70,32,180,108);
      for(const x of [72,76,242,246])r('#ceaa72',x,32,2,108);
      for(let y=40;y<140;y+=12)for(let x=83;x<240;x+=14){r('#a56154',x,y,6,2);r('#a56154',x+2,y-2,2,6);}
      for(const x of [0,57,212,269]){
        r('#432d29',x,0,51,43);
        for(let row=0;row<2;row++)for(let i=0;i<10;i++){
          const h=9+(i*7+row)%8;
          r(['#a76856','#689087','#ba955e','#7c768a'][i%4],x+2+i*5,18+19*row-h,3,h);
        }
        r('#b18b61',x,18,51,3);r('#b18b61',x,37,51,3);
      }
      r('#4c342e',120,2,80,30);r('#be9369',123,4,74,25);
      for(let i=0;i<7;i++){const x=128+i*9,y=6+i*5%12;r('#eadaba',x,y,7,9);r('#a6514c',x+2,y,2,2);}
      for(const x of [24,296]){r('#533b34',x-17,69,34,5);prop(ctx,'desk_lamps',x,64,'#efc985');}
    }
    if(e.primary_color)r(e.primary_color+'25',0,0,320,140);
    if(e.secondary_color)r(e.secondary_color,0,138,320,2);
  }
  function drawArenaBackground(ctx,w,h,theme,{banner=false}={}){
    const e=theme.environment||{},p=theme.palette||{},layout=layoutFor(theme),station=layout==='space-station';
    const floor=station?'deck':e.floor_style||'stone',base=e.primary_color||p.floor||'#334854',
      tile=e.secondary_color||p.stripe||'#405766',accent=e.accent_color||theme.accent||'#9de4cf';
    ctx.save();ctx.scale(w/320,h/140);
    if(!station && layout!=='custom'){
      architecture(ctx,layout,e,accent);
    }else{
      rect(ctx,base,0,0,320,140);
      for(let y=0;y<140;y+=14){
        if(floor==='turf'){if(!(y%28))rect(ctx,tile,0,y,320,14);continue;}
        if(floor==='asphalt'){for(let i=0;i<50;i++)rect(ctx,tile,(i*43+y*7)%320,y+i%13,2,1);continue;}
        const step={deck:39,parquet:48,dance_tiles:17,stone:28}[floor]||28;
        for(let x=-(y%28?step/2:0),i=0;x<320;x+=step,i++){
          rect(ctx,(i+y/14)%2?tile:base,x,y,step-1,13);
          rect(ctx,'#15232a55',x,y+13,step,1);
          if(floor==='deck'){rect(ctx,'#8fa4b1',x+3,y+2,1,1);rect(ctx,'#162636',x+step-4,y+10,2,1);}
          if(floor==='dance_tiles')rect(ctx,accent+'55',x,y,step-1,1);
          if(floor==='parquet')rect(ctx,'#c9a07d44',x+4,y+5,step*.65,1);
        }
      }
      if(station){
        const height=banner?53:30;
        rect(ctx,'#627788',0,0,320,height+9);
        for(let i=0;i<3;i++)viewport(ctx,10+i*104,5,92,height-5,i===1);
        rect(ctx,'#182b40',0,height+3,320,6);rect(ctx,'#a0dfe6',0,height+4,320,1);
        for(const x of [9,295]){rect(ctx,'#112637',x,height+14,12,60);rect(ctx,x===9?'#6fe6e5':'#f8b96b',x+3,height+16,3,55);}
        for(let x=0;x<320;x+=26)rect(ctx,'#b79a66',x,132,13,3);
        prop(ctx,'consoles',38,118,accent);prop(ctx,'consoles',278,118,accent);
      }else{
        rect(ctx,'#11192588',0,0,320,22);rect(ctx,accent,0,21,320,2);
        rect(ctx,accent+'99',14,125,292,1);
      }
    }
    const props=e.props||[];
    props.filter(id=>!station||!['crates','viewport','consoles','airlock'].includes(id))
      .forEach((id,i)=>prop(ctx,id,22+(i%2)*276,46+Math.floor(i/2)*32,accent));
    ctx.restore();
  }
  function blit(ctx,image,...bounds){
    ctx.imageSmoothingEnabled=false;
    try{ctx.drawImage(image,...bounds);}finally{ctx.imageSmoothingEnabled=true;}
  }
  function backdrop(ctx,w,h,image){
    const scale=Math.max(w/image.naturalWidth,h/image.naturalHeight);
    const dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;
    blit(ctx,image,(w-dw)/2,(h-dh)/2,dw,dh);
    rect(ctx,'#09132130',0,0,w,h);
  }
  return {drawArenaBackground,layoutFor,drawAvatarIcon,backdrop,blit};
})();
if(typeof module!=='undefined')module.exports=ArcadeEnvironment;
