// Fit a decision stump to the player's labels, then test it on four field cases.
const makeFieldTest = typeof module === 'undefined' ? createFieldTest : require('../../field_cases').createFieldTest;
function createRound({mechanics:m,theme:t}) {
  const pool = GameLogic.makePool(m), rows = [], labels=t.featureLabels;
  const shortcut=m.features.find(f=>f.role==='spurious'), core=m.class_rule.feature;
  const counts=[0,0], cases=m.curveballs.map(c=>c.item);
  // Older levels supply fewer curveballs. Complete the field set with valid cue combinations.
  for(const {item} of pool.extra){
    if(cases.length>=4)break;
    if(!cases.some(other=>m.features.every(f=>item[f.name]===other[f.name])))cases.push(item);
  }
  let model, test, balanced=false, index=0, correctLabels=0, note='';
  function reliance() {
    if(!rows.length)return 0;
    const agree=rows.filter(r=>r.label===(r.item[shortcut.name]===shortcut.values[0]?'a':'b')).length;
    return Math.round(100*Math.abs(2*agree-rows.length)/rows.length);
  }
  function beginTest(){
    test=makeFieldTest(cases,item=>{
      const feature=m.features.find(f=>f.name===model.feature);
      const {passed:correct}=GameLogic.evaluateCase(m,model,item);
      const cue={true:'True Signal',spurious:'Spurious Cue',noise:'Noise'}[feature.role];
      return {correct,text:'Model used '+cue+' ('+labels[item[feature.name]]+') → '+(correct?'ACCURATE':'MISCLASSIFIED'),
        item};
    });
  }
  return {
    view() {
      const state=test?.view(), ready=state?.completed===0, spuriousReliance=reliance();
      const item=state?.verdict?.item || state?.current || pool.initial[index].item;
      return {...state, phase:ready?'Model ready':state?.phase||'Training', accuracy:state?.accuracy??100*correctLabels/(rows.length||1),
        score:counts, teamNames:t.options, metric:'Spurious Reliance',value:spuriousReliance,spuriousReliance,note:state?.note||note,
        legend:['TRUE SIGNAL · '+labels[core],'TRAP · '+labels[shortcut.name]],
        actors:[{slot:0,badge:0,label:t.options[0],station:true},{slot:2,badge:Number(item[core]===m.class_rule.class_b_value),aura:shortcut.values.indexOf(item[shortcut.name]),art:shortcut.values.indexOf(item[shortcut.name]),label:labels[item[core]]+' / '+labels[item[shortcut.name]]},{slot:1,badge:1,label:t.options[1],station:true}],
        subject:Object.entries(item).map(([k,v])=>labels[k]+' · '+labels[v]).join(' / '),
        names:t.options,actions:t.options,submit:state?.submit||'Finish training first', training:!test,
        lanes:t.options,canRetrain:Boolean(test && (balanced || spuriousReliance>=50) && (!state.success || balanced)),balanced,
        target:test?'field-'+state.completed:rows.length};
    },
    act(n) {
      if(test||![0,1].includes(n))return;
      const row=pool.initial[index++],label=n?'b':'a',correct=label===row.label;
      counts[n]++;if(correct)correctLabels++;
      rows.push({...row,label});
      note=correct?'Causal match.':'Check the core signal.';
      if(index===pool.initial.length){
        index=0;
        if(counts.every(Boolean)){model=GameLogic.train(m,rows);beginTest();note='Wave complete. Test the model.';}
        else note='Classify the next wave with examples of both classes.';
      }
      return {actor:1,destination:n,correct,text:correct?'+1':'Mislabelled!'};
    },
    submit(){test?.step();},
    retrain(){
      if(!test||balanced||reliance()<50||test.view().success)return;
      rows.push(...pool.extra,...pool.extra);
      model=GameLogic.train(m,rows);balanced=true;beginTest();
      note='Balanced training applied. Test the new model on the same four cases.';
    }
  };
}
if(typeof module!=='undefined')module.exports={createRound};
