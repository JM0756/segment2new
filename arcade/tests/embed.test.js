const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  children=[];
  classList={add(){},remove(){}};
  style={setProperty(){}};
  get childElementCount(){return this.children.length;}
  append(node){this.children.push(node);}
  replaceChildren(){this.children=[];}
  getContext(){return this.context;}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
const solutions={neighbors:[1,2,3],reward:[1],retrieval:[0,2],threshold:[6],audit:[0,1,2]};
const base=require('node:path').resolve(__dirname,'..');
for(const dir of fs.readdirSync(base).filter(name=>fs.existsSync(base+'/'+name+'/source/game.js'))){
  const path=base+'/'+dir+'/source/';
  const generatedPath = '../../../generated/'+dir+'/test_L1.json';
  for (const configPath of ['default.json', generatedPath]) {
    test(dir+' startup and host message with '+configPath,async ()=>{
      const elements=new Map();
      const imageURLs=[], drawings=[];
      const drawing = {
        save(){},restore(){},strokeRect(){},translate(){},ellipse(){},fillText(){},
        measureText(text){return {width:text.length*5};},
        beginPath(){}, arc(){drawings.push('circle');}, fill(){},
        fillRect(){drawings.push('square');},
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
      let receive;
      const config=JSON.parse(fs.readFileSync(path+'default.json'));
      if (configPath !== 'default.json') {
        config.theme.sprites={class0_asset:'assets/first.png',class1_asset:'assets/missing.png'};
      }
      const search = configPath === 'default.json' ? '' : '?config='+encodeURIComponent(configPath);
      let requested;
      const hud=fs.readFileSync(path+'index.html','utf8').includes('arcade_hud');
      document.getElementById=key=>{const el=document.querySelector(key);el.context=drawing;return el;};
      let frame;
      const context=vm.createContext({location:{search},performance,requestAnimationFrame(fn){frame=fn;},document,parent,URLSearchParams,URL,Image,setTimeout,clearTimeout,
        window:{location:{search,href:'http://localhost/arcade/'+dir+'/source/index.html'+search},addEventListener:(type,fn)=>{if(type==='message')receive=fn;}},
        fetch:async url=>{requested=url;return {json:async ()=>config};}});

      for(const file of ['game_logic.js','sprites.js','game.js',...(hud?['../../arcade_hud.js']:[])]) vm.runInContext(fs.readFileSync(path+file,'utf8'),context);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(requested,configPath);
      assert.equal(elements.get(hud?'title':'h1').textContent,config.theme.title);
      if (configPath === 'default.json') {
        assert.deepEqual(imageURLs,[]);
        assert.ok(drawings.includes('circle'));
      } else {
        const assets='http://localhost/generated/'+dir+'/assets/';
        assert.deepEqual(imageURLs,[assets+'first.png',assets+'missing.png']);
        assert.ok(drawings.includes('image'));
      }
      assert.ok(drawings.includes('square'));
      receive({source:parent,origin:'https://host.example',data:{type:'LOAD_CONFIG',config}});
      await new Promise(resolve=>setImmediate(resolve));
      if(hud){
        const arena=elements.get('arena');arena.width=560;arena.height=144;arena.context=drawing;
        frame(performance.now());assert.equal(drawing.imageSmoothingEnabled,false);
        elements.get('actions').children[0].onclick();
        assert.ok(events.includes('start'));assert.ok(events.includes('action'));
        return;
      }
      const dialog=elements.get('dialog'), panel=elements.get('section');
      const click=(el,label)=>el.children.find(b=>b.textContent===label).onclick();
      click(dialog,config.theme.skip);
      click(panel,config.theme.hintLabel);
      click(panel,config.theme.check);
      for(const index of solutions[config.archetype]) panel.children[index+1].onclick();
      click(panel,config.theme.check);
      assert.deepEqual([...new Set(events)],['start','hint_shown','action','fail','win']);
    });
  }
}
