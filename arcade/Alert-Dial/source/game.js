function createRound({mechanics:m,theme:t}) {
  const stops=[...new Set(m.cutoffs)].sort((a,b)=>a-b);
  let i=0, moves=0, note='',done=false;
  function stats(index) {
    let hits=0,fp=0,miss=0;
    for(const [score,label] of m.records) {
      if(score>=stops[index]) {if(label)hits++;else fp++;}
      else if(label)miss++;
    }
    return {hits,fp,miss,cost:fp*(m.falseAlarmCost||1)+miss*(m.missCost||1)};
  }
  function tune(index){i=Math.min(stops.length-1,Math.max(0,index));moves++;done=false;note='';}
  return {
    view(){
      const {hits,fp,miss,cost}=stats(i);
      return {phase:'Checkpoint',score:[hits,fp],names:t.options,actions:['Lower cutoff','Raise cutoff'],
        subject:'Gate ≥ '+stops[i]+'   |   Scores: '+m.records.map(r=>r[0]).join(' · '),
        metric:'Alert Precision',value:Math.round(100*hits/(hits+fp||1)),range:[i,stops.length-1],
        detail:'Recall '+Math.round(100*hits/(hits+miss||1))+'% · Missed '+miss+' · Cost '+cost+
          ' (false alarm ×'+(m.falseAlarmCost||1)+', miss ×'+(m.missCost||1)+')',
        actors:m.records.map(([s,c])=>({slot:c,label:String(s)})),note,done,
        guide:moves?'Compare precision and recall; submit the lowest-cost setting.':'Move the threshold dial to change which agents trigger alerts.',
        submit:'Evaluate checkpoint'};
    },tune,act(n){tune(i+(n?1:-1));},
    submit(){const cost=stats(i).cost;done=cost===Math.min(...stops.map((_,j)=>stats(j).cost));
      note=done?'CHECKPOINT CLEAR!':stats(i).fp?'FALSE ALARM! Try a higher cutoff.':'MISSED INCIDENT! Try a lower cutoff.';}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
