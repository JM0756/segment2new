const shuffleDeck=typeof module==='undefined'?shuffled:require('../../shuffle.js');
function createRound({mechanics:m,theme:t}) {
  const records=shuffleDeck(m.records);
  const auras=records.map(()=>Number(Math.random()<0.5));
  const stops=[...new Set(m.cutoffs)].sort((a,b)=>a-b);
  let i=0, moves=0, note='',done=false;
  function stats(index) {
    let hits=0,fp=0,miss=0;
    for(const [score,label] of records) {
      if(score>=stops[index]) {if(label)hits++;else fp++;}
      else if(label)miss++;
    }
    return {hits,fp,miss,cost:fp*(m.falseAlarmCost||1)+miss*(m.missCost||1)};
  }
  function tune(index){i=Math.min(stops.length-1,Math.max(0,index));moves++;done=false;note='';}
  return {
    view(){
      const {hits,fp,miss,cost}=stats(i);
      return {phase:'Checkpoint',readyToSubmit:moves>0,accuracy:100*(records.length-fp-miss)/records.length,score:[hits,fp],names:t.options,actions:['Lower cutoff','Raise cutoff'],
        subject:'Gate ≥ '+stops[i]+'   |   Scores: '+records.map(r=>r[0]).join(' · '),
        metric:'Alert Precision',value:Math.round(100*hits/(hits+fp||1)),range:[i,stops.length-1],
        detail:'Recall '+Math.round(100*hits/(hits+miss||1))+'% · Missed '+miss+' · Cost '+cost+
          ' (false alarm ×'+(m.falseAlarmCost||1)+', miss ×'+(m.missCost||1)+')',
        actors:records.map(([s,c],n)=>({slot:c,badge:c,aura:auras[n],label:t.options[c]+' · '+s})),note,done,
        legend:['RISK · score carried by each agent','CUTOFF · scores at or above it trigger an alert'],
        guide:moves?'Step 2/2 · Submit the cutoff with the lowest error cost [SPACE].':'Step 1/2 · Use E at the left or right sensor to adjust the cutoff.',
        submit:'Evaluate checkpoint'};
    },
    fieldCases(){return records.map(([score,label])=>{
      const alert=score>=stops[i],correct=alert===Boolean(label);
      return {subject:t.options[label]+' · '+score,actors:[{slot:label,badge:label,label:t.options[label]}],
        evaluate:()=>({correct,text:'Score '+score+(alert?' ≥ ':' < ')+stops[i]+' → '+(alert?'alert':'clear')+' · '+(correct?'ACCURATE':'MISCLASSIFIED')})};
    });},tune,act(n){tune(i+(n?1:-1));},
    submit(){if(!moves){note='Set a cutoff before evaluating the checkpoint.';return;}
      const cost=stats(i).cost;done=cost===Math.min(...stops.map((_,j)=>stats(j).cost));
      note=done?'CHECKPOINT CLEAR!':stats(i).fp?'FALSE ALARM! Try a higher cutoff.':'MISSED INCIDENT! Try a lower cutoff.';
      const actor=Math.max(0,records.findIndex(([score,c])=>((score>=stops[i])!==Boolean(c))===!done));
      return {actor,correct:done,text:done?'+100 MATCH!':'WRONG! Actual: '+t.options[records[actor][1]]};}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
