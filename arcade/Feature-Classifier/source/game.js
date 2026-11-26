// Fit a decision stump to the player's labels, then test it on four field cases.
const makeFieldTest = typeof module === 'undefined' ? createFieldTest : require('../../field_cases').createFieldTest;
function displayTheme(config){
  const theme=GameLogic.themeFor(config);
  const featureLabels=Object.fromEntries(Object.entries(theme.featureLabels).map(([key,value])=>{
    const phrase=value.replace(/\s*\([^()]*\)/g,'').split(/[,;:.!?()—–]|\s+-\s+|\s+(?:which|that|because|while|whereas|when|with)\b/i)[0];
    return [key,(phrase.trim()||value).split(/\s+/).slice(0,3).join(' ')];
  }));
  return {...theme,featureLabels};
}
// Older saved levels describe their scenery and class identity inside theme.
function classifierPresentation(config){
  const theme=displayTheme(config),room=theme.environment||{},palette=theme.palette||{};
  const profiles=[
    [/noir|detective|precinct|speakeasy/i,'rain','sun_rays','cobblestone','brass_trim','noir_serif','noir_brass','Investigations Bureau'],
    [/ocean|reef|abyssal|underwater|jellyfish|marine/i,'bubbles','spores','steel_grating','neon_bevel','cyber_mono','abyssal_neon','Marine Research'],
    [/alpine|snow|arctic|summit|glacier/i,'snow','clouds','stone_slate','stone_curb','field_stencil','alpine_console','Summit Survey'],
    [/forest|orchard|garden|botanical/i,'dust','spores','wood_deck','wood_trim','storybook_bold','botanical_parchment','Field Research']
  ];
  const clues=[theme.title,(theme.options||[]).join(' '),theme.setting,theme.subtitle,room.setting_name,room.layout];
  let match;
  for(const clue of clues){
    match=profiles.find(([pattern])=>pattern.test(clue||''));
    if(match)break;
  }
  const [,weather,particles,material,borderStyle,fontStyle,artStyle,badge]=match||
    [null,'dust','neon_glints','lab_tile','bolted_frame','pixel_arcade','industrial_steel','Research Division'];
  const env=config.environment||{},tint=room.accent_color||theme.accent||'#8acbc8';
  return {...config,theme,environment:{...env,
    weather:{type:weather,intensity:.45,angle:12,tint,...env.weather},
    particles:{type:particles,density:.35,tint,...env.particles},
    platform:{material:typeof room.floor_style==='object'?room.floor_style:material,borderStyle,sceneryLayout:'balanced',deckFill:room.primary_color||palette.floor||'#27383d',
      gridLine:room.secondary_color||palette.stripe||'#405357',borderAccent:tint,
      bayLeftAccent:palette.team0||'#77d6cc',bayRightAccent:palette.team1||'#f2ab79',...env.platform}},
    titleScreen:{catchyTitle:theme.title||'Classification Lab',divisionBadge:badge.toUpperCase(),
      tagline:theme.subtitle||theme.hint||'Find the reliable signal and train your classifier.',fontStyle,artStyle,...config.titleScreen}};
}
function createRound(config) {
  const m=config.mechanics,t=displayTheme(config);
  const pool = GameLogic.makePool(m), rows = [], labels=t.featureLabels;
  const shortcut=m.features.find(f=>f.role==='spurious'), core=m.class_rule.feature;
  const counts=[0,0], cases=m.curveballs.map(c=>c.item);
  // Older levels supply fewer curveballs. Complete the field set with valid cue combinations.
  for(const {item} of pool.extra){
    if(cases.length>=4)break;
    if(!cases.some(other=>m.features.every(f=>item[f.name]===other[f.name])))cases.push(item);
  }
  let model, test, index=0, correctLabels=0, note='';
  const removed=new Set();
  let points=0, bonusPoints=0, auditResult=null;
  function isCurveball(item){
    const actual=Number(GameLogic.label(m,item)==='b');
    return shortcut.values.indexOf(item[shortcut.name])===1-actual;
  }
  function reward(correct,item,base){
    if(!correct)return;
    points+=base;
    if(isCurveball(item)){
      bonusPoints+=25;
      points+=25;
    }
  }
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
      const auditAvailable=Boolean(state?.done&&!state.success&&model.feature!==core&&!auditResult);
      const preview=auditAvailable?GameLogic.validatePruning(m,rows,verification,removed):auditResult;
      const success=auditResult?.success??state?.success;
      const stars=success?(auditResult?2:state.accuracy===100&&model.feature===core?3:1):0;
      const weightRows=m.features.map((f,i)=>({key:f.name,name:labels[f.name],role:f.role,value:removed.has(f.name)?0:weights[i]}));
      const weightsByCue=Object.create(null);
      for(const {key,name,value} of weightRows){
        for(const alias of [name,name.toLowerCase(),GameLogic.cueKey(name),GameLogic.cueKey(key)]){
          weightsByCue[alias] ??= value;
        }
      }
      // Internal IDs win if a custom display label happens to match another cue's ID.
      for(const {key,value} of weightRows)weightsByCue[key]=value;
      return {...state,weights:weightRows,weightsByCue,
        prediction:state?prediction(item):null,verification:[...verification], auditAvailable,points,bonusPoints,success,learnedRule:model&&GameLogic.ruleFormula(model,t),
        projectedAccuracy:preview?.accuracy,auditResults:auditResult?.results,removed:[...removed],
        stars,
        phase:auditResult?(success?'Audit Win':'Audit failed'):ready?'Model ready':state?.phase||'Training',
        detail:auditResult?'Model Audit · '+auditResult.accuracy+'% accuracy':state?.detail,
        accuracy:auditResult?.accuracy??state?.accuracy??100*correctLabels/(rows.length||1),
        score:counts, teamNames:t.options, metric:'Spurious Reliance',value:spuriousReliance,spuriousReliance,note:auditResult?note:state?.note||note,
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
      reward(correct,row.item,10);
      counts[n]++;if(correct)correctLabels++;
      rows.push({...row,label});
      weights=GameLogic.featureWeights(m.features,rows);
      note=correct?'Causal match.':'Check the core signal.';
      if(index===pool.initial.length){
        index=0;
        if(counts.every(Boolean)){model=GameLogic.train(m,rows);beginTest();note='Wave complete. Test the model.';}
        else note='Classify the next wave with examples of both classes.';
      }
      return {actor:1,destination:n,correct,text:correct?(row.counterExample?'+35 Curveball':'+10'):'Mislabelled!'};
    },
    submit(){
      if(!test||test.view().done)return;
      const item=test.view().current,result=prediction(item);
      const id=m.curveballs.find(c=>c.item===item)?.id || 'field-'+(test.view().completed+1);
      test.step();
      const correct=test.view().verdict.correct;
      verification.push({...result,id,item,curveball:isCurveball(item),actual:t.options[Number(GameLogic.label(m,item)==='b')],correct});
      reward(correct,item,20);
    },
    toggleFeature(key){
      if(!this.view().auditAvailable||!m.features.some(f=>f.name===key))return;
      if(removed.has(key))removed.delete(key);
      else removed.add(key);
    },
    validateAudit(){
      if(!this.view().auditAvailable||!removed.size)return;
      auditResult=GameLogic.validatePruning(m,rows,verification,removed);
      note=removed.has(core)?'Removing '+labels[core]+' erased the reliable class signal.':
        auditResult.success?'Audit Win · Shortcut pruned.':'The retained rule still misses too many field cases.';
    }
  };
}
if(typeof module!=='undefined')module.exports={createRound};
