const test=require('node:test'),assert=require('node:assert/strict');
const {conduitWave}=require('../Signal-Sorter/source/game_logic');

test('switch choices latch on crossing and dirty carriers need FLT',()=>{
  function first(stage,settings){
    const wave=conduitWave(stage,[1],1),s=wave.state;
    for(const [node,count] of Object.entries(settings))for(let i=0;i<count;i++)wave.toggle(node);
    wave.tick(1);
    s.pulses[0].dirty=true;
    wave.tick(3*wave.hop+.01);
    const branch=s.pulses[0]?.from;
    wave.tick(wave.hop);
    return {s,branch};
  }
  const left=first(1,{B:1,FLT:1});
  assert.equal(left.branch,'B');assert.equal(left.s.score,100);assert.equal(left.s.buffers[1],1);
  const right=first(2,{A:1,FLT:1});assert.equal(right.branch,'C');assert.equal(right.s.score,100);
  const dirty=first(2,{A:1});assert.equal(dirty.s.event.text,'STATIC NOISE!');assert.equal(dirty.s.heat[1],1);
  const wasted=first(1,{A:2});assert.equal(wasted.s.event.text,'WASTED SIGNAL');
});

test('five misses overload a core and the stage-three inverter restores shifted carriers',()=>{
  const overload=conduitWave(1,[1],1);
  while(!overload.state.done)overload.tick(.1);
  assert.equal(overload.state.heat[0],5);assert.equal(overload.state.stars,0);
  function lowWave(correctShift){
    const wave=conduitWave(3,[0],1),s=wave.state;
    wave.toggle('FLT');
    let corrected=false;
    while(!s.done){
      // Engage INV after the last unshifted packet has passed the hardware.
      if(correctShift&&!corrected&&s.pulses.some(p=>p.shifted&&p.to==='INV')){
        wave.toggle('INV');corrected=true;
      }
      wave.tick(.05);
    }
    return s;
  }
  const good=lowWave(true),bad=lowWave(false);
  assert.ok(good.shift);assert.equal(good.resolved,good.total);
  assert.ok(good.stars>=1&&good.stars<=3);assert.ok(good.snr>bad.snr&&good.score>bad.score);
});

test('a clean wave sends each carrier to its core and pure noise into ground for three stars',()=>{
  const wave=conduitWave(1,[0,1],1),s=wave.state;
  wave.toggle('FLT');
  while(!s.done){
    const approaching=s.pulses.find(p=>p.to==='A');
    if(approaching)while(s.switches.A!==approaching.band)wave.toggle('A');
    wave.tick(.05);
  }
  assert.equal(s.stars,3);assert.equal(s.snr,100);assert.deepEqual(s.heat,[0,0]);
  assert.equal(s.score,(s.buffers[0]+s.buffers[1])*100);
});

test('the lookahead follows a live carrier through the filter and inverter',()=>{
  const wave=conduitWave(3,[0,1],1);
  wave.toggle('FLT');
  wave.tick(1);
  const carrier=wave.state.pulses[0];
  carrier.dirty=true;
  carrier.inverted=true;
  assert.deepEqual(wave.lookahead().map(p=>[p.band,p.dirty]),[[1,true],[1,false]]);
  wave.tick(wave.hop+.01);
  assert.equal(wave.lookahead()[0].dirty,false);
  wave.toggle('INV');
  wave.tick(wave.hop);
  assert.equal(wave.lookahead()[0].band,0);
});
