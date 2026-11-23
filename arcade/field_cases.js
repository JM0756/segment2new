// Four deliberate submissions, scored independently of training accuracy.
function createFieldTest(cases, evaluate) {
  if (!cases.length) throw new Error('A field test needs cases.');
  const total = 4;
  let completed = 0, correct = 0, last = null;
  function current() {
    const i = Math.min(completed, total - 1);
    return cases[cases.length >= total ? Math.floor(i * cases.length / total) : i % cases.length];
  }
  return {
    view() {
      const number = Math.min(completed + 1, total), done = completed === total;
      return {field:true, locked:true, instant:false, fieldNumber:number, completed, verdict:last,
        phase:done?'Results':'Field test', submit:'Test Case '+number+'/'+total,
        detail:correct+' / '+completed+' field cases accurate', accuracy:completed?100*correct/completed:0,
        done, success:done && correct>=3, note:last?.text || '', current:current()};
    },
    step() {
      if (completed === total) return;
      const item = current();
      last = {...evaluate(item), item};
      last.text = 'Case '+(completed+1)+'/4 · '+last.text;
      if (last.correct) correct++;
      completed++;
    }
  };
}

// Task-specific rounds supply evidence collected during play to review in the field.
function withFieldTest(round) {
  if (!round.fieldCases) return round;
  let test,pruned=null;
  function begin(){test=createFieldTest(round.fieldCases(), item=>item.evaluate());}
  const wrapped = {...round, view() {
    const base = round.view();
    if (!test) return base;
    const state = test.view();
    const shown=state.verdict?.item || state.current;
    const auditAvailable=Boolean(round.prune && !pruned && state.done && !state.success && base.spuriousReliance>=50);
    return {...base,...state, auditAvailable, stars:state.success?(pruned?2:3):0,
      accuracy:pruned==="true"?0:state.accuracy,note:pruned==="true"?"Audit failed: removing sample integrity erased the reliable signal. Accuracy 0%.":state.note, range:null,sources:null, subject:shown.subject,
      actors:shown.actors || base.actors, target:'field-'+state.completed};
  }};
  for (const name of ['act','submit','inspect','tune']) {
    if (!round[name]) continue;
    wrapped[name] = (...args) => {
      if (test) {
        if (name === 'submit') test.step();
        return;
      }
      const result = round[name](...args);
      if (round.view().done) begin();
      return result;
    };
  }
  if(round.prune){
    wrapped.audit=role=>{
      if(!wrapped.view().auditAvailable || !['true','spurious'].includes(role))return;
      pruned=role;
      if(role==='spurious'){round.prune();begin();}
    };
  }
  return wrapped;
}
if(typeof module!=='undefined')module.exports={createFieldTest,withFieldTest};
