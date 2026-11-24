const shuffleDeck=typeof module==='undefined'?shuffled:require('../../shuffle.js');
function createRound({mechanics:m,theme:t}) {
  const order=shuffleDeck(m.answers.keys());
  const decisions=[];
  const auras=order.map(()=>Number(Math.random()<0.5));
  let i=0,pick=null,correct=0,done=false,note='',inspected=false;
  return {
    view(){return {phase:'Evidence desk',readyToSubmit:inspected && pick!==null,lanes:t.options,accuracy:100*correct/(i||1),score:[correct,i-correct],subject:t.claims[order[Math.min(i,order.length-1)]],
      actors:[{slot:order[Math.min(i,order.length-1)]%2,aura:auras[Math.min(i,order.length-1)],verified:inspected,label:t.claims[order[Math.min(i,order.length-1)]]}],
      actions:t.options,names:t.options.slice(0,2),sources:t.sources||[t.setting],selected:pick,
      spotlight:inspected?'actions':'sources',success:correct===m.answers.length,metric:'Source Trust',value:i?Math.round(100*correct/i):0,done,note,
      legend:['CLAIM · messenger statement','EVIDENCE · source record'],
      guide:!inspected?'Step 1/3 · Read the evidence [Source].':pick===null?'Step 2/3 · Walk to the matching verdict and press E.':'Step 3/3 · Submit your verdict [SPACE].',
      submit:'Verify claim',target:i};},
    inspect(){inspected=true;},act(n){if(!done&&n<t.options.length)pick=n;},
    submit(){if(done)return;if(pick===null||!inspected){note='Inspect the evidence and select a verdict.';return;}
      const answer=m.answers[order[i++]];
      note=pick===answer?'VERIFIED!':'CHECK SOURCES! Correct verdict: '+t.options[answer];
      const matched=pick===answer, destination=pick;
      decisions.push({subject:t.claims[order[i-1]],actors:[{slot:order[i-1]%2,verified:true,label:t.options[answer]}],
        evaluate:()=>({correct:matched,text:'Evidence supports '+t.options[answer]+' · '+(matched?'ACCURATE':'MISCLASSIFIED')})});
      if(matched)correct++;pick=null;inspected=false;done=i===m.answers.length;
      return {actor:0,destination,correct:matched,text:matched?'+100 MATCH!':'WRONG! Actual: '+t.options[answer]};},
    fieldCases(){return decisions;}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
