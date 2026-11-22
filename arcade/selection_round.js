// Selection games share the arena view and keep their standalone scoring functions.
function createRound({archetype,mechanics:m,theme:t}) {
  let picks=[],attempts=0,done=false,note='';
  const neighbors=archetype==='neighbors',reward=archetype==='reward';
  const names=t.options||Object.values(t.classLabels);
  const choices=neighbors?m.positions.map((x,i)=>x+' · '+t.classLabels[m.classes[i]]):
    reward?m.weights.map(weights=>weights.join(' / ')):names;
  const order=shuffled(choices.keys());
  const actions=order.map(index=>choices[index]);
  const actors=shuffled(names.slice(0,2).map((label,slot)=>({label,slot,badge:slot})));
  const subject=neighbors?t.setting+' · '+m.target:reward?t.axes+' · Goal: '+names[m.goal]:t.setting;
  const detail=reward?m.routes.map((route,i)=>names[i]+' '+route.join('/')).join(' · '):t.hint;
  return {
    view(){return {phase:'Selection',actions,names,score:[Number(done),attempts-Number(done)],
      teamNames:['Solved','Misses'],metric:'Accuracy',value:done?Math.round(100/attempts):0,accuracy:done?100/attempts:0,
      subject,detail,note,done,submit:t.check,picks:picks.map(i=>order.indexOf(i)),actors};},
    fieldCases(){
      if(neighbors){
        const distances=m.positions.map(x=>Math.abs(x-m.target));
        const nearest=distances.map((_,i)=>i).sort((a,b)=>distances[a]-distances[b]).slice(0,m.k);
        return m.positions.map((x,i)=>({subject:choices[i],evaluate:()=>({correct:picks.includes(i)===nearest.includes(i),
          text:'Distance '+distances[i]+' from '+m.target+' → '+(nearest.includes(i)?'nearest neighbor':'outside the nearest group')})}));
      }
      if(reward){
        const weights=m.weights[picks[0]],scores=m.routes.map(route=>route.reduce((sum,v,i)=>sum+v*weights[i],0));
        return scores.map((score,i)=>({subject:names[i],evaluate:()=>({correct:i===m.goal?score===Math.max(...scores):score<scores[m.goal],
          text:names[i]+' scores '+score+' with weights '+weights.join(' / ')+' · goal scores '+scores[m.goal]})}));
      }
      return names.map((name,i)=>{
        const actual=picks.indexOf(i),expected=m.order.indexOf(i);
        return {subject:name,evaluate:()=>({correct:actual===expected,text:name+' → '+(actual<0?'excluded':'rank '+(actual+1))+
          ' · expected '+(expected<0?'excluded':'rank '+(expected+1))})};
      });
    },
    act(n){
      if(done||n>=choices.length)return;
      n=order[n];
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
