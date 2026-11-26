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
    ['reactor-core', /reactor core/i],['observation-deck', /observation deck/i],
    ['forest-edge', /forest/i],['misty-hollow', /hollow/i],['ancient-ruins', /ruins/i],
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
  function drawAvatarIcon(target,image,{theme={},slot=0,facing=1,frame=0,stride=0,blink=false}={},size=32){
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
      const sheet=image.naturalWidth>=2*image.naturalHeight;
      const width=sheet?image.naturalHeight:image.naturalWidth;
      const scale=32/Math.max(width,image.naturalHeight);
      const w=width*scale,h=image.naturalHeight*scale;
      if(sheet)blit(ctx,image,(frame%Math.floor(image.naturalWidth/width))*width,0,width,width,0,0,32,32);
      else blit(ctx,image,(32-w)/2,(32-h)/2,w,h);
    }else{
      const layout=layoutFor(theme),android=slot===1, ink='#182637';
      const suit=theme.palette?.['team'+slot]||(android?'#e2a566':'#69ced0');
      const r=(color,x,y,w,h)=>rect(ctx,color,x,y,w,h);
      // Boots, gloves, torso and the offset eyes keep the silhouette readable at 32px.
      r(ink,8,18,15,10);r(suit,9,19,13,7);
      r(ink,6,19,4,8);r(suit,6,20,3,5);r(ink,22,19,4,7);r(suit,23,20,3,4);
      r(ink,9-stride,26-stride,5,5);r(ink,18+stride,26+stride,5,5);r('#9bacb5',9-stride,29-stride,4,1);r('#9bacb5',19+stride,29+stride,4,1);
      r(ink,6,5,20,15);r(suit,7,6,18,12);
      if(layout==='space-station'){
        r('#26465a',9,9,16,7);r(android?'#ffcf78':'#acffff',13,10,android?3:10,2);
        if(android){r(ink,18,2,2,4);r('#ffbd56',17,1,4,2);}
      }else{
        r(android?'#cc8f62':'#f1c99e',10,9,15,9);
        r(ink,16,12,2,blink?1:3);r(ink,22,12,2,blink?1:3);
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
    if(layout==='reactor-core'){
      r('#422c36',0,0,320,140);
      for(let y=36;y<140;y+=8)for(let x=0;x<320;x+=12)r('#231e2a',x,y,9,3);
      for(const x of [45,160,275]){
        r('#923b36',x-3,16,6,112);r('#ffad54',x-1,16,2,112);
        o('#632a35',x,22,24,18);o('#f2a14f',x,22,17,13);
        for(let j=0;j<8;j++){const angle=j*Math.PI/4;line('#683739',x,22,Math.round(14*Math.cos(angle)),Math.round(10*Math.sin(angle)));}
        o('#ffe28a',x,22,5,4);
      }
    }else if(layout==='observation-deck'){
      r('#162843',0,0,320,140);
      for(let y=56;y<140;y+=12)for(let x=0;x<320;x+=28)r('#233653',x,y,27,11);
      viewport(ctx,3,3,314,53,false);
      for(let i=0;i<75;i++)o(i%2?'#755786':'#52648e',12+i*4,24+12*Math.sin(i/13)+i*7%8,2+i%3,1);
      for(let i=0;i<9;i++){const x=12+i*34,y=11+(i*17)%30;o('#847886',x,y,3+i%3,2+i%2);r('#514c69',x,y,2,1);}
      for(const x of [33,283]){
        prop(ctx,'consoles',x,92,'#80effa');o('#64dbe855',x,73,14,6);
        for(let j=0;j<5;j++)r('#a2f6ff',x-9+j*4,70+j*7%6,2,1);
      }
    }else if(['forest-edge','misty-hollow','ancient-ruins'].includes(layout)){
      r(e.primary_color||'#314a41',0,0,320,140);
      for(let i=0;i<12;i++){
        const x=i*29,y=10+(i*7)%21;
        if(layout==='ancient-ruins'){
          r('#8d9080',x,y,11,25);r('#b2b39c',x-2,y,15,4);r('#737967',x-3,y+22,17,4);
        }else{prop(ctx,'trees',x,y,accent);}
      }
      if(layout==='misty-hollow')for(let i=0;i<10;i++)o('#a7d7c943',i*37,42+i*13%51,29,4);
      if(layout==='forest-edge')for(let i=0;i<22;i++)r('#a1a569',i*41%320,67+i*7%68,4,2);
    }else if(layout==='speakeasy'){
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
    props.filter(id=>typeof id==='string'&&(!station||!['crates','viewport','consoles','airlock'].includes(id)))
      .forEach((id,i)=>prop(ctx,id,22+(i%2)*276,46+Math.floor(i/2)*32,accent));
    ctx.restore();
  }
  function structureStyle(theme){
    const layout=layoutFor(theme);
    if(['forest-edge','misty-hollow','ancient-ruins'].includes(layout))return 'grove';
    if(['speakeasy','party'].includes(layout))return 'velvet';
    if(['space-station','reactor-core','observation-deck','laboratory','clinical'].includes(layout))return 'hatch';
    return 'street';
  }
  function gate(ctx,x,y,style,accent,open,scale){
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    const r=(color,x,y,w,h)=>rect(ctx,color,x,y,w,h);
    const frame={grove:'#788375',velvet:'#aa804c',hatch:'#8596a5',street:'#8a7668'}[style];
    r('#09111e55',-24,1,48,3);
    r('#17202a',-26,-39,52,41);r(frame,-26,-39,5,40);r(frame,21,-39,5,40);
    r(frame,-23,-43,46,7);
    const panel=19-15*open;
    const face={grove:'#495747',velvet:'#912e49',hatch:'#495e73',street:'#564840'}[style];
    r(face,-20,-35,panel,34);r(face,20-panel,-35,panel,34);
    if(style==='grove'){
      for(let i=0;i<5;i++)r('#98a18b',-24+i*10,-42-Math.min(i,4-i)*2,9,7);
      r('#526b49',-24,-39,3,23);r('#7a9568',-20,-35,6,4);
    }else if(style==='velvet'){
      for(let i=0;i<3;i++){r('#c45a66',-20+i*panel/3,-35,2,22-i*3);r('#bc4e61',18-i*panel/3,-35,2,22-i*3);}
      r('#72334a',-21,-40,42,6);r('#e7b963',-24,-12,5,3);r('#e7b963',19,-12,5,3);
    }else if(style==='hatch'){
      for(const dx of [-25,21])for(let i=0;i<3;i++)r('#d4a75b',dx,-9+i*4,4,2);
      r('#263746',-13,-41,26,4);
    }else{
      r('#30343a',-29,-43,58,4);r('#c1a784',-20,-31,2,25);r('#c1a784',18,-31,2,25);
    }
    r(open>.15?accent:'#526269',-8,-40,16,3);
    r('#28333b',-26,0,52,3);r(accent,-19,1,38,1);
    ctx.restore();
  }
  function fixtureMaterial(style,fallback){
    if(/wood|timber|corral|forest|rune|stone|grove|trail|ice/i.test(style))return 'grove';
    if(/velvet|rope|curtain/i.test(style))return 'velvet';
    if(/airlock|hatch|metal|plasma/i.test(style))return 'hatch';
    return fallback;
  }
  function drawFixtures(ctx,w,h,world,archetype,style,accent,activity,hover,low,now,cutoff,part){
    const {entry,checkpoint:c,leftTarget,rightTarget}=world.structures;
    const cx=c.x*w,cy=c.y*h;
    const line=(x1,y1,x2,y2,color,width)=>{
      ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    };
    ctx.save();
    if(!low && (!part || part==='entry')){
      const entryMaterial=fixtureMaterial(entry.style,style);
      const open=activity.spawn||0;
      if(entryMaterial==='grove'){
        const x=entry.x*w,y=entry.y*h,stone=/ice|stone|rune/i.test(entry.style);
        const color=stone?'#778c98':'#986b47';
        for(const offset of [-24,18])rect(ctx,color,x+offset,y-30,6,30);
        line(x-26,y-30,x,y-40,color,6);line(x,y-40,x+26,y-30,color,6);
        rect(ctx,accent,x-5,y-39,10,3);
        for(const dir of [-1,1])line(x+dir*19,y-10,x+dir*(2+16*open),y-10,color,4);
      }else gate(ctx,entry.x*w,entry.y*h,entryMaterial,accent,open,1);
      ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.strokeStyle='#162331';ctx.lineWidth=3;
      ctx.strokeText(entry.label,entry.x*w,entry.y*h+14,w*.22);ctx.fillText(entry.label,entry.x*w,entry.y*h+14,w*.22);
    }
    if(!part || part==='floor'){
      if(archetype==='sorter'){
        for(const z of [leftTarget,rightTarget]){
          line(cx,cy,z.x*w,z.y*h,'#273b46',7);line(cx,cy,z.x*w,z.y*h,accent,2);
        }
      }else if(archetype==='threshold'){
        const y=cy+(cutoff-.5)*h*.13;
        line(w*.13,y,w*.87,y,'#471a27',5);line(w*.13,y,w*.87,y,'#ffb95a',2);
        for(const x of [.13,.87]){rect(ctx,'#253544',w*x-4,y-9,8,14);oval(ctx,accent,w*x,y-10,5,3);}
      }
    }
    if(!part || part==='checkpoint'){
      const radius=c.radius*Math.min(w,h);
      if(!low){
        if(archetype==='audit'||/desk|stamp/i.test(c.style)){
          rect(ctx,'#775b43',cx-radius,cy-9,radius*1.45,7);
          rect(ctx,'#eee2b5',cx-radius*.7,cy-11,14,4);
          rect(ctx,'#344451',cx-radius,cy-22,5,13);rect(ctx,'#566979',cx-radius,cy-23,16,4);
        }else if(archetype==='threshold'||/beacon/i.test(c.style)){
          rect(ctx,'#344753',cx-radius,cy-14,7,15);oval(ctx,accent,cx-radius+3,cy-16,5,4);
        }else{
          rect(ctx,'#42565b',cx-radius-8,cy-8,12,9);rect(ctx,accent,cx-radius-9,cy-10,14,3);
        }
      }
      if(activity.scan){
        const pulse=1-activity.scan;
        ctx.strokeStyle=accent;ctx.lineWidth=2;
        if(c.reaction==='stamp_press'){
          rect(ctx,'#a24138',cx-radius+8,cy-20+Math.sin(pulse*Math.PI)*11,10,5);
        }else{
          if(c.reaction==='scan_ring')rect(ctx,accent,cx-17,cy-pulse*42,34,2);
          else for(let i=0;i<6;i++)rect(ctx,accent,cx+radius*Math.cos(i*Math.PI/3+now/800),cy+8*Math.sin(i*Math.PI/3+now/800),3,3);
        }
      }
    }
    [leftTarget,rightTarget].forEach((z,i)=>{
      if(part && part!==(i?'rightTarget':'leftTarget'))return;
      const x=w*z.x,y=h*z.y,hw=w*z.width/2,hh=h*z.height/2,light=activity.gates[i];
      const color=hover===i?'#fff4aa':accent;
      const opening=z.reaction==='gate_open'?light:0,material=fixtureMaterial(z.style,style);
      if(!low){
        if(archetype==='classifier' && material==='hatch')gate(ctx,x,y,material,color,opening,.85);
        else if(/receiver|beacon/i.test(z.style)){
          rect(ctx,'#345766',x-11,y-10,22,12);rect(ctx,color,x-8,y-9,16,3);
        }else if(/tray/i.test(z.style)){
          rect(ctx,'#786049',x-hw*.6,y-3,hw*1.2,6);rect(ctx,'#f0d69b',x-9,y-5,18,3);
        }else if(/rune|circle/i.test(z.style)){
          rect(ctx,'#536653',x-9,y-15,18,17);rect(ctx,color,x-2,y-12,3,8);
        }else{
          const wood=material==='grove'?'#8f693f':material==='velvet'?'#953e53':'#5b7882';
          for(const dir of [-1,1]){
            rect(ctx,wood,x+dir*hw-3,y-hh*.5,6,hh*.65);
            line(x+dir*hw,y-4,x+dir*hw*(.25+.65*opening),y-4,wood,4);
          }
        }
      }
      if(light>0){
        const t=1-light;
        ctx.save();ctx.globalAlpha=light;ctx.strokeStyle=color;
        for(let k=0;k<8;k++)rect(ctx,color,x+Math.cos(k*.785)*hw*t,y+Math.sin(k*.785)*hh*t-12*t,3,3);
        if(z.reaction==='gate_open' && /receiver|beacon|tray|rune|circle/i.test(z.style)){
          for(const dir of [-1,1])line(x+dir*hw*.7,y+2,x+dir*hw*(.1+opening*.6),y+2,color,3);
        }
        if(z.reaction==='net_ripple')for(let k=-2;k<=2;k++)line(x+k*hw*.3,y-hh*.4,x+k*hw*.3+Math.sin(t*9+k)*4,y+hh*.35,color,1);
        if(z.reaction==='beacon_flash')oval(ctx,'#fff5bf',x,y-9,7*light+1,7*light+1);
        if(archetype==='audit'){
          const stamp=i===0?'VERIFIED':'FLAGGED';
          rect(ctx,i===0?'#176046':'#953b35',x-27,y-15,54,12);
          ctx.fillStyle='#fff4ce';ctx.font='bold 10px sans-serif';ctx.fillText(stamp,x,y-5);
        }
        ctx.restore();
      }
    });
    ctx.restore();
  }
  function solid(ctx,o,w,h,accent,style){
    const x=o.x*w,y=o.y*h,sw=o.w*w,sh=o.h*h;
    ctx.save();ctx.translate(x,y);ctx.scale(sw/30,sh/18);
    if(o.sceneryProp){
      prop(ctx,o.sceneryProp,0,0,accent);
    }else if(style==='street' && o.kind==='boulder'){
      rect(ctx,'#352c29',-9,-11,18,17);rect(ctx,'#986f49',-8,-13,16,17);
      rect(ctx,'#c99b68',-7,-13,14,3);rect(ctx,'#4b4945',-9,-8,18,2);rect(ctx,'#4b4945',-9,1,18,2);
    }else if(style==='hatch' && o.kind==='crate'){
      rect(ctx,'#273743',-13,-13,26,20);rect(ctx,'#58707d',-11,-11,22,16);
      rect(ctx,'#8197a0',-12,-13,24,4);rect(ctx,'#344857',-8,-9,3,14);
      rect(ctx,'#344857',5,-9,3,14);rect(ctx,accent,-3,-6,6,3);
    }else if(o.kind==='pillar'){
      rect(ctx,'#454a52',-13,-19,26,24);rect(ctx,'#92959a',-10,-22,8,25);
      rect(ctx,'#bec1c0',-15,-24,30,4);rect(ctx,'#656973',-15,3,30,4);
    }else if(o.kind==='desk'){
      rect(ctx,'#523f33',-12,-2,4,10);rect(ctx,'#523f33',8,-2,4,10);
      rect(ctx,'#906d50',-15,-9,30,10);rect(ctx,'#c7a57c',-15,-10,30,3);
      rect(ctx,'#e3d8ba',-6,-10,12,4);
    }else if(o.kind==='boulder'){
      rect(ctx,'#39483e',-12,-5,24,11);rect(ctx,'#5f6d5c',-9,-10,18,13);
      rect(ctx,'#92a56b',-7,-11,10,4);rect(ctx,'#798669',-11,-6,6,3);
    }else if(o.kind==='tree'){
      rect(ctx,'#73523a',-2,-6,5,14);
      for(let i=0;i<4;i++){const span=3+i*3;rect(ctx,i%2?'#406c4d':'#31573e',-span,-23+i*5,span*2,6);}
    }
    else prop(ctx,'crates',0,0,accent);
    ctx.restore();
  }
  function drawTrail(ctx,marks,surface,w,h){
    ctx.save();ctx.fillStyle=surface.trailColor;
    for(const m of marks){
      const x=m.x*w,y=m.y*h;ctx.globalAlpha=m.alpha*.72;
      if(surface.trailStyle==='pixel_tiles')ctx.fillRect(x-4,y-2,8,4);
      else if(surface.trailStyle==='footprints')ctx.fillRect(x+(m.step%2?2:-4),y,3,5);
      else if(surface.trailStyle==='sparks'){ctx.fillRect(x-3,y,7,1);ctx.fillRect(x,y-3,1,7);}
      else oval(ctx,surface.trailColor,x,y,3+(1-m.alpha)*3,2);
    }
    ctx.restore();
  }
  function groundKind(theme){
    const layout=layoutFor(theme);
    if(layout==='wasteland')return 'sand';
    return structureStyle(theme);
  }
  function ground(ctx,w,h,theme){
    const kind=groundKind(theme);
    const [base,seam,light]={
      grove:['#56764c','#425f3e','#85a65e'],hatch:['#394d5b','#233542','#70838b'],
      velvet:['#765445','#49352f','#ad8061'],sand:['#b69768','#92794e','#d3b581'],
      street:['#655f60','#48464b','#898184']
    }[kind];
    const horizon=h*.42;
    ctx.save();
    // Increasing course height and tile width carry the perspective toward the viewer.
    let row=0;
    for(let y=horizon;y<h;row++){
      const depth=(y-horizon)/(h-horizon),rh=Math.max(2,Math.round(h*(.012+depth*.064)));
      const tw=Math.round(w*(.033+depth*.081));
      ctx.globalAlpha=Math.min(1,(y-horizon)/(h*.06));
      rect(ctx,base,0,y,w,rh);
      for(let x=-(row%2)*tw/2,i=0;x<w;x+=tw,i++){
        if(kind==='grove'||kind==='sand'){
          if(kind==='grove'&&Math.abs(x+tw/2-w*(.53+.08*Math.sin(depth*4)))<w*(.04+.13*depth))
            rect(ctx,'#9c845f',x,y,tw,rh);
          rect(ctx,(row+i)%2?light:seam,x+tw*.4,y+rh*.54,Math.max(2,tw*.11),2);
        }else{
          rect(ctx,seam,x,y,tw,1);rect(ctx,seam,x,y,1,rh);
          rect(ctx,light,x+2,y+1,tw*.65,1);
          if(kind==='hatch')rect(ctx,light,x+3,y+3,2,2);
          if(kind==='velvet'&&x>w*.25&&x<w*.7){
            rect(ctx,'#884751',x,y,tw,rh);rect(ctx,'#bc9466',x+tw*.5,y+rh*.45,4,2);
          }
        }
      }
      y+=rh;
    }
    ctx.restore();
  }
  function foreground(ctx,w,h,theme){
    const kind=groundKind(theme),base=h*.975;
    ctx.save();
    if(kind==='hatch'||kind==='street'||kind==='velvet'){
      const color=kind==='hatch'?'#374d5b':kind==='velvet'?'#765744':'#787275';
      rect(ctx,color,0,base,w,h-base);rect(ctx,'#b5a99a',0,base,w,2);
      for(let x=5;x<w;x+=w/12){
        rect(ctx,'#343c40',x,base-3,4,h*.04);
        if(kind==='hatch')rect(ctx,color,x,base-h*.025,4,h*.03);
      }
      if(kind==='hatch')rect(ctx,color,0,base-h*.025,w,3);
    }else{
      for(let i=0;i<32;i++){
        const x=(i*53%97)*w/97,y=h*(.945+(i%5)*.011);
        rect(ctx,kind==='sand'?'#836949':'#354f37',x,y,9,4);
        rect(ctx,kind==='sand'?'#c6a878':'#6e9157',x+3,y-3,3,5);
      }
    }
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
  return {ground,structureStyle,drawFixtures,solid,drawTrail,foreground,drawArenaBackground,layoutFor,drawAvatarIcon,backdrop,blit};
})();
if(typeof module!=='undefined')module.exports=ArcadeEnvironment;
