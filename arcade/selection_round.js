// Selection games share the arena view and keep their standalone scoring functions.
function createRound({archetype,mechanics:m,theme:t}) {
  let picks=[],attempts=0,done=false,note='';
  const neighbors=archetype==='neighbors',reward=archetype==='reward';
  const names=t.options||Object.values(t.classLabels);
  const choices=neighbors?m.positions.map((x,i)=>x+' · '+t.classLabels[m.classes[i]]):
    reward?m.weights.map(weights=>weights.join(' / ')):names;
  const subject=neighbors?t.setting+' · '+m.target:reward?t.axes+' · Goal: '+names[m.goal]:t.setting;
  const detail=reward?m.routes.map((route,i)=>names[i]+' '+route.join('/')).join(' · '):t.hint;
  return {
    view(){return {phase:'Selection',actions:choices,names,score:[Number(done),attempts-Number(done)],
      teamNames:['Solved','Misses'],metric:'Accuracy',value:done?Math.round(100/attempts):0,accuracy:done?100/attempts:0,
      subject,detail,note,done,submit:t.check,picks,actors:names.slice(0,2).map((label,slot)=>({label,slot}))};},
    act(n){
      if(done||n>=choices.length)return;
      picks=reward?[n]:picks.includes(n)?picks.filter(i=>i!==n):[...picks,n];
      note=picks.map(i=>choices[i]).join(' → ');
    },
    submit(){
      if(done)return;
      attempts++;done=evaluateSelection(m,picks);note=done?t.success:t.failure;
      if(done&&neighbors)note+=' '+t.prediction+' '+t.classLabels[majority(m,picks)];
      return {actor:0,correct:done,text:done?'MATCH':'TRY AGAIN'};
    }
  };
}
