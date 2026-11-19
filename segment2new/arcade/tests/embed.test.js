const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  children=[];
  append(node){this.children.push(node);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
const solutions={orbit:Array.from({length:10},(_,i)=>i),neighbors:[1,2,3],reward:[1],retrieval:[0,2],threshold:[6],audit:[0,1,2]};
for(const dir of fs.readdirSync('.').filter(name=>fs.existsSync(name+'/source/game.js'))){
  const path=dir+'/source/';
  test(dir+' host message round trip',()=>{
    const elements=new Map();
    const events=[];
    const parent={postMessage:(message,origin)=>{assert.equal(origin,'https://host.example');events.push(message.event);}};
    const document={createElement:()=>new Element(),documentElement:{style:{setProperty(){}}},
      querySelector(key){if(!elements.has(key)) elements.set(key,new Element());return elements.get(key);}};
    let receive;
    const context=vm.createContext({document,parent,window:{addEventListener:(_,fn)=>receive=fn},fetch:()=>new Promise(()=>{})});
    for(const file of ['game_logic.js','game.js']) vm.runInContext(fs.readFileSync(path+file,'utf8'),context);
    const config=JSON.parse(fs.readFileSync(path+'default.json'));
    receive({source:parent,origin:'https://host.example',data:{type:'LOAD_CONFIG',config}});
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
