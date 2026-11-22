function shuffled(values,random=Math.random){
  const deck=Array.from(values);
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}
if(typeof module!=='undefined')module.exports=shuffled;
