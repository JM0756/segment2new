function createRound({mechanics:m,theme:t}) {
  let i=0,pick=null,correct=0,done=false,note='',inspected=false;
  return {
    view(){return {phase:'Evidence desk',score:[correct,i-correct],subject:t.claims[Math.min(i,m.answers.length-1)],
      actors:[{slot:i%2,label:'Messenger '+(Math.min(i,m.answers.length-1)+1)}],
      actions:t.options,names:t.options.slice(0,2),sources:t.sources||[t.setting],selected:pick,
      spotlight:inspected?'actions':'sources',success:correct===m.answers.length,metric:'Source Trust',value:i?Math.round(100*correct/i):0,done,note,
      guide:!inspected?'Inspect a source card.':pick===null?'Select a verdict for the claim.':'Press SPACE to verify your verdict.',
      submit:'Verify claim',target:i};},
    inspect(){inspected=true;},act(n){if(!done&&n<t.options.length)pick=n;},
    submit(){if(done)return;if(pick===null||!inspected){note='Inspect the evidence and select a verdict.';return;}
      const answer=m.answers[i++];
      note=pick===answer?'VERIFIED!':'CHECK SOURCES! Correct verdict: '+t.options[answer];
      if(pick===answer)correct++;pick=null;inspected=false;done=i===m.answers.length;}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
