const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  children=[];
  classList={add(){},remove(){},toggle(){}};
  style={setProperty(){}};
  get childElementCount(){return this.children.length;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  getContext(){return this.context;}
  clientWidth=560;clientHeight=245;
  toDataURL(){return "data:image/png;base64,";}
  setAttribute(){}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
const base=require('node:path').resolve(__dirname,'..');
for(const dir of fs.readdirSync(base).filter(name=>fs.existsSync(base+'/'+name+'/source/game.js'))){
  const path=base+'/'+dir+'/source/';
  const generatedPath = '../../../generated/'+dir+'/test_L1.json';
  for (const configPath of ['default.json', generatedPath]) {
    test(dir+' startup and host message with '+configPath,async ()=>{
      const elements=new Map();
      const imageURLs=[], drawings=[];
      const drawing = {
        createLinearGradient(){return {addColorStop(){}};},roundRect(){},setTransform(){},save(){},restore(){},strokeRect(){},strokeText(){},rotate(){},scale(){},stroke(){},moveTo(){},lineTo(){},translate(){},ellipse(){},fillText(label){drawings.push(label);},
        measureText(text){return {width:text.length*5};},
        beginPath(){}, arc(){drawings.push('circle');}, fill(){},
        fillRect(){drawings.push(this.fillStyle);},
        drawImage(image,...bounds){assert.ok(bounds.every(Number.isFinite)); drawings.push('image');}
      };
      class Image {
        set src(url) {
          imageURLs.push(url);
          if (url.endsWith('missing.png')) return this.onerror();
          this.complete=true; this.width=this.naturalWidth=64; this.height=this.naturalHeight=32; this.onload();
        }
      }
      const events=[];
      const parent={postMessage:(message,origin)=>{assert.equal(origin,'https://host.example');events.push(message.event);}};
      const document={createElement:()=>Object.assign(new Element(),{context:drawing}),documentElement:{style:{setProperty(){}}},
        querySelector(key){if(!elements.has(key)) elements.set(key,new Element());return elements.get(key);}};
      let receive,keyDown,keyUp;
      const config=JSON.parse(fs.readFileSync(path+'default.json'));
      if (configPath !== 'default.json') {
        config.theme.backgroundImage='assets/scene.png';
        if(dir==='Feature-Classifier'){
          Object.assign(config.theme,{title:'Orchard',class0:{name:'Apple'},class1:{name:'Pear'},
            trueFeature:{name:'Stem',values:['Forked','Single']},spuriousFeatures:[{name:'Paint',values:['Ochre','Indigo']}]});
        }
        if(dir==='Claim-Inspector'){
          config.theme.sprites={class0_asset:'assets/first.png',class1_asset:'assets/missing.png'};
        }else{
          config.theme.class0Sprite='assets/first.png';config.theme.class1Sprite='assets/missing.png';
        }
      }
      const search = configPath === 'default.json' ? '' : '?config='+encodeURIComponent(configPath)+'&level=2';
      let requested;
      document.getElementById=key=>{const el=document.querySelector(key);el.context=drawing;return el;};
      let frame;
      const context=vm.createContext({location:{search},performance,requestAnimationFrame(fn){frame=fn;},document,parent,URLSearchParams,URL,Image,setTimeout,clearTimeout,
        window:{devicePixelRatio:2,location:{search,href:'http://localhost/arcade/'+dir+'/source/index.html'+search},addEventListener:(type,fn)=>{if(type==='message')receive=fn;if(type==='keydown')keyDown=fn;if(type==='keyup')keyUp=fn;}},
        fetch:async url=>{requested=url;return {json:async ()=>config};}});

      for(const file of ['../../tutorial.js','../../shuffle.js','game_logic.js','../../environment.js','sprites.js','../../field_cases.js','game.js','../../world_engine.js','../../world.js','../../animation.js','../../narrator.js','../../arcade_hud.js']) vm.runInContext(fs.readFileSync(path+file,'utf8'),context);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(requested,configPath);
      assert.equal(elements.get('title').textContent,config.theme.title);
      if (configPath === 'default.json') {
        assert.deepEqual(imageURLs,[]);

      } else {
        const assets='http://localhost/generated/'+dir+'/assets/';
        assert.deepEqual(imageURLs,[assets+'first.png',assets+'missing.png',assets+'scene.png']);
        assert.ok(drawings.includes('image'));
      }

      receive({source:parent,origin:'https://host.example',data:{type:'LOAD_CONFIG',config}});
      await new Promise(resolve=>setImmediate(resolve));
      const arena=elements.get('arena');arena.width=560;arena.height=144;arena.context=drawing;
      if(configPath!== 'default.json'){
        vm.runInContext(`for(const name of ['ground','foreground']){
          ArcadeEnvironment[name]=()=>{throw Error('Generated background covered by '+name)};
        }`,context);
        assert.equal(vm.runInContext('land',context),null);
        const blits=[];
        context.recordBlit=(...args)=>blits.push(args);
        vm.runInContext('const blit=ArcadeEnvironment.blit; ArcadeEnvironment.blit=(ctx,img,...args)=>{if(img===scenery)recordBlit(...args);blit(ctx,img,...args)}',context);
        frame(performance.now());
        const [x,y,w,h]=blits[0];
        assert.ok(x<=0 && y<=0 && x+w>=vm.runInContext('worldWidth',context) && y+h>=vm.runInContext('worldHeight',context));
      }
      frame(performance.now());assert.equal(drawing.imageSmoothingEnabled,true);
      assert.equal(arena.width,1120);assert.equal(arena.height,490);
      if(dir==='Feature-Classifier' && configPath==='default.json'){
        for(const [width,height,scale] of [[800,450,450/620],[1920,1080,1.25],[390,740,.68]]){
          arena.clientWidth=width;arena.clientHeight=height;frame(performance.now());
          const layout=vm.runInContext('layout',context);
          assert.equal(layout.uiScale,scale);
          assert.equal(vm.runInContext('mapWidth()*layout.uiScale',context),width);
          assert.equal(vm.runInContext('worldWidth*layout.uiScale',context),width);
          assert.equal(arena.width,width*2); // DPR changes resolution independently of layout.
        }
      }
      const read=code=>vm.runInContext(code,context);
      const press=(key,code=key)=>keyDown({key,code,preventDefault(){},target:{matches:()=>false}});
      const actions=elements.get('actions');
      assert.ok(actions.children.every(b=>!/^\[[12]\]/.test(b.textContent)));
      assert.match(actions.children[0].textContent,/Move/);
      const instruction=()=>elements.get('instruction').textContent;
      const markup=fs.readFileSync(path+'index.html','utf8');
      assert.match(markup,/<\/header><\/section>\s*<section class="console"/);
      for(const id of ['phase','objective','itemId','traits','progress','pips','actions','help'])
        assert.ok(markup.split('<section class="console"')[1].includes('id="'+id+'"'));
      assert.ok(drawings.includes('SCAN'));
      for(const prefix of ['01 · ','02 · '])assert.ok(drawings.some(label=>typeof label==='string' && label.startsWith(prefix)));
      const initialScore=read('JSON.stringify(view.score)');
      assert.match(instruction(),/Part 1 · 1\/6/);
      if(configPath!== 'default.json'){
        elements.get('skip').onclick();
        await read('start(config,configPath)');
        assert.equal(read('guideStep'),-1);
        elements.get('help').onclick();
        frame(performance.now());
      }
      let now=performance.now();
      arena.getBoundingClientRect=()=>({left:0,top:0,width:arena.clientWidth,height:arena.clientHeight});
      const click=(x,y)=>arena.onclick({clientX:x*read('mapWidth()*layout.uiScale'),
        clientY:read('floorTop()*layout.uiScale')+y*read('floorHeight()*layout.uiScale')});
      function tick(count){for(let n=0;n<count;n++){now+=30;frame(now);}}
      const center=read('world.structures.checkpoint');
      press('d');tick(3);keyUp({key:'d'});tick(8);
      assert.match(instruction(),/Part 1 · 2\/6/);
      click(center.x,center.y);tick(100);assert.match(instruction(),/Part 1 · 3\/6/);
      const clickLeader=side=>{
        const sign=read('signs()')[side];
        click(sign.x,sign.y);tick(100);
      };
      clickLeader(0);
      assert.match(instruction(),/Part 2 · 4\/6/);
      if(dir==='Feature-Classifier'&&configPath!== 'default.json'){
        for(const word of ['Apple','Pear','Forked','Single','Stem','Paint'])assert.ok(instruction().includes(word));
      }
      elements.get('continue').onclick();assert.match(instruction(),/5\/6/);
      elements.get('continue').onclick();assert.match(instruction(),/6\/6/);
      elements.get('continue').onclick();assert.equal(elements.get('guide').hidden,true);
      assert.equal(read('JSON.stringify(view.score)'),initialScore);
      click(center.x,center.y);tick(100);
      const long='Pulsing translucent bell fringed with luminous silver tentacles';
      context.longTrait=long;
      read("const originalView=round.view.bind(round); round.view=()=>({...originalView(),traits:[['Anatomy',longTrait]]});render()");
      assert.ok(elements.get('traits').children.some(cell=>cell.children[1].textContent===long));
      frame(now+=30);assert.ok(!drawings.includes(long));
      read('round.view=originalView;render()');
      frame(now+=30);
      if(dir!=='Feature-Classifier'){
        assert.equal(read('escortMode'),false);
        assert.equal(read('world.hazards.length'),0);
        assert.doesNotMatch(read("lines.join(' ')"),/tether|Feature-Classifier|Spurious Reliance/i);
        read("const choices=[];const act=round.act.bind(round);round.act=i=>{choices.push(i);return act(i)}");
        clickLeader(0);clickLeader(1);assert.deepEqual(Array.from(read('choices')),[0,1]);
        return;
      }
      press('1');press('2');assert.ok(read('pilot.tethered'));
      // Exercise actual keyboard and canvas input against each game's round adapter.
      await read('start(config,configPath)');frame(now+=30);
      read("const decisions=[]; const act=round.act.bind(round); round.act=i=>{decisions.push(i);return act(i)}");
      const moveTo=(x,y)=>{read(`pilot.walkTo({x:${x},y:${y}})`);tick(140);};
      if(configPath===generatedPath){
        const vent=read('world.hazards[0]');
        moveTo(vent.x-.052,vent.y);assert.match(elements.get('objective').textContent,/Disable vent/);
        press('e');tick(1);assert.equal(vent.active,false);
        assert.match(elements.get('objective').textContent,/Enable vent/);
        press('e');assert.equal(vent.active,true);
      }else assert.equal(read('world.hazards.length+world.obstacles.length'),0);
      moveTo(.03,.93);press('e');assert.deepEqual(Array.from(read('decisions')),[]);
      assert.equal(read('scanTime'),-Infinity);
      const emptyBay=read('signs()[0]');moveTo(emptyBay.x,emptyBay.y);press('e');
      assert.equal(read('decisions.length'),0);
      assert.deepEqual([read('pilot.specimen().x'),read('pilot.specimen().y')],[center.x,center.y]);

      const weightRows=elements.get('weights').children;
      assert.ok(weightRows.length>0);
      assert.ok(weightRows.every(row=>row.children[2].textContent==='0%'));
      for(const [side,key] of [[0,'e'],[1,'Space']]){
        moveTo(center.x,center.y);press(' ','Space');assert.ok(read('pilot.tethered'));
        press('e');assert.ok(read('pilot.traced'));
        assert.ok(elements.get('traits').children.some(cell=>cell.className==='scan-trace'));
        const target=read('signs()')[side];
        moveTo(target.x,target.y);
        assert.notEqual(read('pilot.specimen().x'),center.x);
        assert.notEqual(read('pilot.specimen().x'),read('pilot.pos().x'));
        press(key==='Space'?' ':key,key);
        assert.ok(read('decisions').includes(side));assert.equal(read('pilot.tethered'),false);
        assert.equal(read('view.training'),true);
        const state=read('view');
        state.weights.forEach(({key,name,value},i)=>{
          assert.ok(value>0);
          if(side===0)assert.equal(value,100);
          assert.equal(state.weightsByCue[key],value);
          assert.equal(state.weightsByCue[name],value);
          assert.equal(state.weightsByCue[name.toLowerCase()],value);
          assert.equal(weightRows[i].children[2].textContent,value+'%');
          assert.equal(weightRows[i].children[1].children[0].style.width,value+'%');
        });
      }
      const target=read('signs()')[0],before=read('decisions.length');
      moveTo(center.x,center.y);press('e');click(target.x,target.y);
      assert.equal(read('decisions.length'),before);tick(120);
      assert.equal(read('decisions.length'),before+1);
      await read('start(config,configPath)');frame(now+=30);
      assert.equal(read('guideStep'),-1);
      elements.get('help').onclick();assert.equal(read('guideStep'),0);
      elements.get('skip').onclick();assert.equal(read('guideStep'),-1);
      if(dir==='Feature-Classifier'||dir==='Signal-Sorter'){
        const followShortcut=dir==='Feature-Classifier';
        for(let i=0;i<(dir==='Feature-Classifier'?6:config.mechanics.samples.length);i++){
          const side=dir==='Feature-Classifier'?read(followShortcut?'view.actors[1].aura':'view.actors[1].badge'):
            config.theme.options.indexOf(elements.get('subject').textContent);
          click(center.x,center.y);tick(100);clickLeader(side);
        }
        assert.ok(read('view.field'));
        press(' ','Space');tick(16);
        const side=read('flight.side'),hit=read('hits.find(h=>!h.station).x/mapWidth()');
        assert.ok(side?hit>center.x:hit<center.x);
        assert.ok(drawings.includes(read("flight.name+' ('+flight.confidence+'%)'")));
        assert.equal(read('view.completed'),0);
        tick(20);assert.equal(read('view.completed'),1);
        assert.equal(read('flight.arrived'),true);
        assert.ok(drawings.includes(read("flight.correct?'#60d99c':'#ff726c'")));
        tick(210);
        assert.equal(elements.get('pips').children.length,4);
        assert.deepEqual(elements.get('pips').children.map(p=>p.className),
          Array.from(read('view.verification'),r=>r.correct?'verified':'missed'));
        assert.ok(drawings.includes('#ff726c'));
        assert.match(elements.get('verification').textContent,/FIELD TEST · 4\/4/);
        if(followShortcut){
          assert.ok(read('view.auditAvailable'));
          if(configPath!=='default.json'){
            elements.get('auditChoices').children.find(b=>b.textContent.startsWith('Prune True Feature')).onclick();
            assert.equal(read('passed'),false);
            await actions.children.find(b=>b.textContent==='Replay').onclick();
            assert.equal(read('guideStep'),-1);
            assert.equal(read('view.phase'),'Training');
            elements.get('help').onclick();assert.equal(read('guideStep'),0);
            elements.get('skip').onclick();assert.equal(read('view.phase'),'Training');
            return;
          }
          elements.get('auditChoices').children.find(b=>b.textContent.startsWith('Prune Spurious Cue')).onclick();
          press(' ','Space');tick(240);assert.ok(drawings.includes('#60d99c'));
        }
        assert.equal(read('view.stars'),followShortcut?2:3);
        assert.ok(actions.children.some(b=>b.textContent==='Next Level →'));
      }
    });
  }
}

test('tutorial memory survives a fresh player and distinguishes saved games of the same genre',()=>{
  const storage=new Map();
  const player=()=>{
    const ctx=vm.createContext({URL,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
    return vm.runInContext(fs.readFileSync(base+'/tutorial.js','utf8')+';ArcadeTutorial',ctx);
  };
  const first=player(),origin='http://localhost',slug='a'.repeat(32);
  const id=first.gameId('/generated/.tmp/session-one/Alert-Dial/'+slug+'/game_L1.json',origin);
  first.finish(id);
  const reload=player();
  assert.equal(reload.has(reload.gameId('/generated/Alert-Dial/'+slug+'/game_L3.json',origin)),true);
  assert.equal(reload.has(reload.gameId('/generated/Alert-Dial/other_L1.json',origin)),false);
  assert.equal(reload.gameId('level2.json',origin+'/arcade/Alert-Dial/source/index.html'),'Alert-Dial');
});
