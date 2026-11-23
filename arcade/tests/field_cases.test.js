const test=require('node:test');
const assert=require('node:assert/strict');
const {createFieldTest}=require('../field_cases');
require('../Feature-Classifier/source/game_logic');
const {createRound}=require('../Feature-Classifier/source/game');
const config=require('../Feature-Classifier/source/default.json');

test('one submission evaluates one case and exactly three successes unlock the level',()=>{
  for(const correct of [0,2,3,4]){
    let evaluations=0;
    const field=createFieldTest([1,2,3,4],number=>{evaluations++;return {correct:number<=correct,text:'prediction'};});
    for(let i=1;i<=4;i++){
      assert.equal(field.view().submit,'Test Case '+i+'/4');
      assert.equal(field.view().success,false);assert.equal(evaluations,i-1);
      field.step();
    }
    field.step();
    assert.equal(evaluations,4);
    assert.equal(field.view().done,true);
    assert.equal(field.view().accuracy,25*correct);
    assert.equal(field.view().success,correct>=3);
  }
});

test('counter-examples reward causal training; a failed shortcut model allows one audit',()=>{
  for(const role of ['true','spurious']){
    const round=createRound(config);
    let aligned=0,inverted=0;
    for(let i=0;i<6;i++){
      const actor=round.view().actors[1];
      if(actor.badge===actor.aura)aligned++;else inverted++;
      round.act(actor.aura);
    }
    assert.deepEqual([aligned,inverted],[4,2]);
    assert.ok(round.view().spuriousReliance>=60);
    round.audit(role);assert.equal(round.view().completed,0);
    for(let i=0;i<4;i++)round.submit();
    assert.equal(round.view().success,false);assert.equal(round.view().auditAvailable,true);
    round.audit(role);
    if(role==='spurious'){
      for(let i=0;i<4;i++)round.submit();
      assert.equal(round.view().accuracy,100);assert.equal(round.view().stars,2);
      assert.equal(round.view().success,true);
    }else{
      round.audit('spurious');
      assert.equal(round.view().done,true);assert.equal(round.view().accuracy,0);
      assert.match(round.view().note,/reliable class signal/);
    }
  }
});

test('each decision game locks its controls and scores four domain-specific cases',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  for(const game of ['Alert-Dial','Claim-Inspector','Neighborhood-Vote','Reward-Workshop','Search-Desk']){
    const dir=path.resolve(__dirname,'..',game,'source'),config=require(dir+'/default.json');
    const ctx=vm.createContext({config});
    for(const file of ['../../shuffle.js','game_logic.js','../../field_cases.js','game.js']){
      vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),ctx);
    }
    const r=vm.runInContext('withFieldTest(createRound(config))',ctx);
    const {mechanics:m,theme:t}=config;
    const select=label=>r.act(r.view().actions.indexOf(label));
    if(game==='Claim-Inspector'){
      for(const _ of m.answers){r.inspect();r.act(m.answers[t.claims.indexOf(r.view().subject)]);r.submit();}
    }else if(game==='Alert-Dial'){
      for(let i=0;i<m.cutoffs.length&&!r.view().field;i++){r.tune(i);r.submit();}
    }else{
      if(game==='Reward-Workshop')select(m.weights[1].join(' / '));
      if(game==='Search-Desk')for(const i of m.order)select(t.options[i]);
      if(game==='Neighborhood-Vote')for(const i of [1,2,3])select(m.positions[i]+' · '+t.classLabels[m.classes[i]]);
      r.submit();
    }
    for(let i=1;i<=4;i++){
      assert.equal(r.view().submit,'Test Case '+i+'/4',game);
      r.act(1);assert.equal(r.view().completed,i-1);
      assert.equal(r.view().done,false);r.submit();
      assert.match(r.view().note,new RegExp('Case '+i+'/4'));
    }
    assert.equal(r.view().done,true,game);
    assert.equal(r.view().success,r.view().accuracy>=75,game);
    assert.equal(r.view().auditAvailable,false);
  }
});
