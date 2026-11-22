const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  children=[];
  classList={add(){},remove(){},toggle(){}};
  style={setProperty(){}};
  get childElementCount(){return this.children.length;}
  append(node){this.children.push(node);}
  replaceChildren(){this.children=[];}
  getContext(){return this.context;}
  clientWidth=560;clientHeight=245;
  toDataURL(){return "data:image/png;base64,";}
  setAttribute(){}
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
        roundRect(){},setTransform(){},save(){},restore(){},strokeRect(){},strokeText(){},rotate(){},scale(){},stroke(){},moveTo(){},lineTo(){},translate(){},ellipse(){},fillText(){},
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
      let receive,keyDown;
      const config=JSON.parse(fs.readFileSync(path+'default.json'));
      if (configPath !== 'default.json') {
        config.theme.backgroundSprite='assets/scene.png';
        if(dir==='Claim-Inspector'){
          config.theme.sprites={class0_asset:'assets/first.png',class1_asset:'assets/missing.png'};
        }else{
          config.theme.class0Sprite='assets/first.png';config.theme.class1Sprite='assets/missing.png';
        }
      }
      const search = configPath === 'default.json' ? '' : '?config='+encodeURIComponent(configPath);
      let requested;
      document.getElementById=key=>{const el=document.querySelector(key);el.context=drawing;return el;};
      let frame;
      const context=vm.createContext({location:{search},performance,requestAnimationFrame(fn){frame=fn;},document,parent,URLSearchParams,URL,Image,setTimeout,clearTimeout,
        window:{devicePixelRatio:2,location:{search,href:'http://localhost/arcade/'+dir+'/source/index.html'+search},addEventListener:(type,fn)=>{if(type==='message')receive=fn;if(type==='keydown')keyDown=fn;}},
        fetch:async url=>{requested=url;return {json:async ()=>config};}});

      for(const file of ['../../shuffle.js','game_logic.js','../../environment.js','sprites.js','../../field_cases.js','game.js','../../animation.js','../../narrator.js','../../arcade_hud.js']) vm.runInContext(fs.readFileSync(path+file,'utf8'),context);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(requested,configPath);
      assert.equal(elements.get('title').textContent,config.theme.title);
      if (configPath === 'default.json') {
        assert.deepEqual(imageURLs,[]);
        assert.ok(drawings.includes('#182637')); // Character outline and boots
        assert.ok(!drawings.includes('circle'));
      } else {
        const assets='http://localhost/generated/'+dir+'/assets/';
        assert.deepEqual(imageURLs,[assets+'first.png',assets+'missing.png',assets+'scene.png']);
        assert.ok(drawings.includes('image'));
      }
      assert.ok(drawings.includes('#fbe2a9')); // Badge painted by the procedural icon
      receive({source:parent,origin:'https://host.example',data:{type:'LOAD_CONFIG',config}});
      await new Promise(resolve=>setImmediate(resolve));
      const arena=elements.get('arena');arena.width=560;arena.height=144;arena.context=drawing;
      frame(performance.now());assert.equal(drawing.imageSmoothingEnabled,true);
      assert.equal(arena.width,1120);assert.equal(arena.height,490);
      elements.get('continue').onclick();
      const initial=elements.get('instruction').textContent;
      elements.get('actions').children[1].onclick();
      assert.equal(elements.get('instruction').textContent,initial);
      elements.get('actions').children[0].onclick();
      assert.match(elements.get('instruction').textContent,/^\[2\]/);
      elements.get('actions').children[1].onclick();
      assert.equal(elements.get('continue').textContent,'PLAY THE GAME ▶');
      elements.get('continue').onclick();
      assert.equal(elements.get('guide').hidden,true);
      const initialChoice=dir==='Signal-Sorter'?config.theme.options.indexOf(elements.get('subject').textContent):0;
      elements.get('actions').children[initialChoice].onclick();
      assert.ok(events.includes('start'));assert.ok(events.includes('action'));
      if(dir==='Feature-Classifier'){
        const actions=elements.get('actions');
        for(let i=1;i<config.mechanics.training_pool.size;i++)actions.children[i%2].onclick();
        const press=(key,code)=>keyDown({key,code,preventDefault(){},target:{matches:()=>false}});
        for(const phase of ['Model ready','Field test']){
          assert.ok(elements.get('phase').textContent.includes(phase));
          assert.ok(actions.children[0].disabled&&actions.children[1].disabled);
          assert.equal(actions.children[2].className,'field-trigger');
          const count=events.length;press('1','Digit1');press('2','Digit2');
          assert.equal(events.length,count);press(' ','Space');
        }
      }
      if(dir==='Signal-Sorter'){
        const actions=elements.get('actions'),next=()=>actions.children.some(b=>b.textContent==='Next Level →');
        for(const _ of config.mechanics.samples.slice(1)){assert.equal(next(),false);actions.children[config.theme.options.indexOf(elements.get('subject').textContent)].onclick();}
        const field=()=>actions.children.find(b=>b.textContent.startsWith('[SPACE]'));
        for(let i=1;i<=4;i++){
          assert.equal(next(),false);assert.equal(field().textContent,'[SPACE] Test Case '+i+'/4');
          field().onclick();
        }
        assert.equal(next(),true);
        actions.children.find(b=>b.textContent==='Replay').onclick();
        await new Promise(resolve=>setImmediate(resolve));elements.get('skip').onclick();
        for(const _ of config.mechanics.samples)actions.children[1-config.theme.options.indexOf(elements.get('subject').textContent)].onclick();
        for(let i=1;i<=4;i++)field().onclick();
        assert.equal(next(),false);
      }
    });
  }
}
