// Fit a decision stump to the player's labels, then test it on four field cases.
const makeFieldTest = typeof module === 'undefined' ? createFieldTest : require('../../field_cases').createFieldTest;
function createRound(config) {
  const m=config.mechanics,t=GameLogic.themeFor(config);
  const pool = GameLogic.makePool(m), rows = [], labels=t.featureLabels;
  const shortcut=m.features.find(f=>f.role==='spurious'), core=m.class_rule.feature;
  const counts=[0,0], cases=m.curveballs.map(c=>c.item);
  // Older levels supply fewer curveballs. Complete the field set with valid cue combinations.
  for(const {item} of pool.extra){
    if(cases.length>=4)break;
    if(!cases.some(other=>m.features.every(f=>item[f.name]===other[f.name])))cases.push(item);
  }
  let model, test, pruned=null, index=0, correctLabels=0, note='';
  function reliance() {
    const counter=rows.filter(row=>row.counterExample);
    const errors=counter.filter(row=>row.label!==GameLogic.label(m,row.item)).length;
    return errors?Math.max(60,Math.round(100*errors/counter.length)):0;
  }
  let weights=GameLogic.featureWeights(m.features,rows),verification=[];
  function prediction(item){
    const value=item[model.feature],side=Number(model.mapping[value]==='b');
    return {side,name:t.options[side],confidence:model.confidence[value],cue:labels[value],
      role:m.features.find(f=>f.name===model.feature).role,specimen:labels[item[core]]};
  }
  function beginTest(){
    verification=[];
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
      const item=state?.current || pool.initial[index].item;
      const failedAudit=pruned==='true';
      const weightRows=m.features.map((f,i)=>({key:f.name,name:labels[f.name],role:f.role,value:weights[i]}));
      const weightsByCue=Object.create(null);
      for(const {key,name,value} of weightRows){
        for(const alias of [name,name.toLowerCase(),GameLogic.cueKey(name),GameLogic.cueKey(key)]){
          weightsByCue[alias] ??= value;
        }
      }
      // Internal IDs win if a custom display label happens to match another cue's ID.
      for(const {key,value} of weightRows)weightsByCue[key]=value;
      return {...state,weights:weightRows,weightsByCue,
        prediction:state?prediction(item):null,verification:[...verification], auditAvailable:state?.done&&!state.success&&spuriousReliance>=50&&!pruned,
        auditChoices:[labels[core],labels[shortcut.name]], stars:state?.success?(pruned?2:3):0,
        phase:failedAudit?'Audit failed':ready?'Model ready':state?.phase||'Training',
        detail:failedAudit?'Model Audit · 0% accuracy':state?.detail,
        accuracy:failedAudit?0:state?.accuracy??100*correctLabels/(rows.length||1),
        score:counts, teamNames:t.options, metric:'Spurious Reliance',value:spuriousReliance,spuriousReliance,note:failedAudit?note:state?.note||note,
        legend:['TRUE SIGNAL · '+labels[core],'TRAP · '+labels[shortcut.name]],
        actors:[{slot:0,badge:0,label:t.options[0],station:true},{slot:2,badge:Number(item[core]===m.class_rule.class_b_value),aura:shortcut.values.indexOf(item[shortcut.name]),art:shortcut.values.indexOf(item[shortcut.name]),label:labels[item[core]]+' / '+labels[item[shortcut.name]]},{slot:1,badge:1,label:t.options[1],station:true}],
        trace:[labels[core],labels[item[core]]],traits:Object.entries(item).map(([k,v])=>[labels[k],labels[v]]),
        subject:Object.entries(item).map(([k,v])=>labels[k]+' · '+labels[v]).join(' / '),
        names:t.options,actions:t.options,submit:state?.submit||'Finish training first', training:!test,
        lanes:t.options,
        target:test?'field-'+state.completed:rows.length};
    },
    act(n) {
      if(test||![0,1].includes(n))return;
      const row=pool.initial[index++],label=n?'b':'a',correct=label===row.label;
      counts[n]++;if(correct)correctLabels++;
      rows.push({...row,label});
      weights=GameLogic.featureWeights(m.features,rows);
      note=correct?'Causal match.':'Check the core signal.';
      if(index===pool.initial.length){
        index=0;
        if(counts.every(Boolean)){model=GameLogic.train(m,rows);beginTest();note='Wave complete. Test the model.';}
        else note='Classify the next wave with examples of both classes.';
      }
      return {actor:1,destination:n,correct,text:correct?'+1':'Mislabelled!'};
    },
    submit(){
      if(!test||test.view().done)return;
      const result=prediction(test.view().current);
      test.step();
      verification.push({...result,correct:test.view().verdict.correct});
    },
    audit(role){
      if(!this.view().auditAvailable||!['true','spurious'].includes(role))return;
      pruned=role;
      if(role==='true'){
        note='Audit failed: removing '+labels[core]+' erased the reliable class signal. Accuracy 0%.';
        return;
      }
      // The audit verifies training labels against the retained causal cue.
      const verified=rows.map(row=>({...row,label:GameLogic.label(m,row.item)}));
      weights=m.features.map(f=>f.role==='true'?100:0);
      model=GameLogic.train(m,verified,m.features.filter(f=>f.role==='true'));
      beginTest();note='Shortcut pruned. Evaluate the model again (up to two stars).';
    }
  };
}
if(typeof module!=='undefined')module.exports={createRound};
