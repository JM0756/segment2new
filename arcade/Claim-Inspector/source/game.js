function createRound({mechanics:m,theme:t}) {
  let i=0,pick=null,correct=0,done=false,note='',inspected=false;
  return {
    view(){return {phase:'Evidence desk',accuracy:100*correct/(i||1),score:[correct,i-correct],subject:t.claims[Math.min(i,m.answers.length-1)],
      actors:[{slot:i%2,label:'Messenger '+(Math.min(i,m.answers.length-1)+1)}],
      actions:t.options,names:t.options.slice(0,2),sources:t.sources||[t.setting],selected:pick,
      spotlight:inspected?'actions':'sources',success:correct===m.answers.length,metric:'Source Trust',value:i?Math.round(100*correct/i):0,done,note,
      legend:['CLAIM · messenger statement','EVIDENCE · source record'],
      guide:!inspected?'Step 1/3 · Read the evidence [Source].':pick===null?'Step 2/3 · Choose the verdict that fits the evidence [1–3].':'Step 3/3 · Submit your verdict [SPACE].',
      submit:'Verify claim',target:i};},
    inspect(){inspected=true;},act(n){if(!done&&n<t.options.length)pick=n;},
    submit(){if(done)return;if(pick===null||!inspected){note='Inspect the evidence and select a verdict.';return;}
      const answer=m.answers[i++];
      note=pick===answer?'VERIFIED!':'CHECK SOURCES! Correct verdict: '+t.options[answer];
      const matched=pick===answer;
      if(matched)correct++;pick=null;inspected=false;done=i===m.answers.length;
      return {actor:0,correct:matched,text:matched?'+100 MATCH!':'WRONG! Actual: '+t.options[answer]};}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
