// Train a decision stump on the labels the player actually supplies.
function createRound({mechanics:m,theme:t}) {
  const pool = GameLogic.makePool(m), rows = [], labels=t.featureLabels;
  const shortcut=m.features.find(f=>f.role==='spurious'), core=m.class_rule.feature;
  let teamCounts=[0,0];
  let tests=[], model, phase='Training', index=0, note='', balanced=false;
  function fit() {
    if(new Set(rows.map(r=>r.label)).size===2) model=GameLogic.train(m,rows);
  }
  function reliance() {
    if(!rows.length) return 0;
    const agree=rows.filter(r=>r.label===(r.item[shortcut.name]===shortcut.values[0]?'a':'b')).length;
    return Math.round(100*Math.abs(2*agree-rows.length)/(rows.length+1));
  }
  function field() {
    if(!model) {note='Supply examples of both classes before testing.';return;}
    tests=GameLogic.evaluate(m,model);index=0;phase='Field test';
    reveal();
  }
  function reveal() {
    const test=tests[index];
    note=(test.passed?'CAUSAL MATCH! ':'OVERFIT! ')+
      'Model used '+labels[model.feature]+' and predicted '+t.options[Number(test.predicted==='b')]+
      '. '+labels[core]+' determines '+t.options[Number(test.expected==='b')]+'.';
  }
  return {
    view() {
      const item=phase==='Training'?pool.initial[index%pool.initial.length].item:tests[index].item;
      return {phase, score:teamCounts, teamNames:t.options, metric:'Spurious Reliance',value:reliance(),note,
        actors:[{slot:0,label:t.options[0],station:true},{slot:2,label:labels[item[core]]+' / '+labels[item[shortcut.name]]},{slot:1,label:t.options[1],station:true}],
        subject:Object.entries(item).map(([k,v])=>labels[k]+' · '+labels[v]).join(' / '),
        names:t.options,actions:t.options,submit:phase==='Training'?'Launch field test':'Next case',
        spotlight:rows.length<3?'actions':rows.length===3?'meter':'actions',
        guide:rows.length<3?'Step 1 · Classify 3 incoming characters ('+rows.length+'/3).':
          rows.length===3?'Step 2 · Observe Spurious Reliance. Classify one more sample or press SPACE to test.':'Step 3 · Press SPACE to launch the field test.',
        success:tests.every(test=>test.passed),field:phase!=='Training',done:phase==='Results',target:phase==='Training'?index:tests[index].id};
    },
    act(n) {
      if(phase!=='Training'||n>1)return;
      if(index===pool.initial.length){if(model)return;index=0;}
      teamCounts[n]++;
      const row=pool.initial[index++];rows.push({...row,label:n?'b':'a'});fit();
      note=rows.at(-1).label===row.label?'CAUSAL MATCH!':'Check the core signal.';
      if(index===pool.initial.length)note+=model?' Wave complete. Press SPACE.':' Classify the next wave with examples of both types.';
    },
    submit() {
      if(phase==='Training') {if(rows.length>=3)field();else note='Classify at least three samples.';}
      else if(phase==='Field test' && index+1<tests.length){index++;reveal();}
      else phase='Results';
    },
    retrain(){if(!balanced){rows.push(...pool.extra,...pool.extra);balanced=true;}fit();field();}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
