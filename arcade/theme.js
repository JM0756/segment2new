// Shared allowlisted cosmetics. Website chat calls applyGameTheme with a partial patch.
const catalog = {
  environment: {space:['Orbital station','✦','☾','#1c2546','#655783'],ocean:['Deep-sea observatory','≈','🪸','#15495f','#287b80'],forest:['Woodland outpost','♠','🌲','#244937','#617745'],city:['Night city','▥','🏙️','#32234a','#745185']},
  character: {astronaut:'🧑‍🚀',robot:'🤖',fox:'🦊',diver:'🤿',cat:'🐈',owl:'🦉'},
  palette: {mint:['#eaf5ef','#15382e','#176048'],violet:['#f0ebfa','#30233e','#69368c'],amber:['#fff3d9','#403116','#85521a'],blue:['#e8f1ff','#182c47','#285e95']}
};
let theme={environment:'space',character:'astronaut',palette:'mint'};
const player=document.getElementById('player');
function applyGameTheme(patch){
  if(!patch || typeof patch!=='object'||Array.isArray(patch))throw Error('Expected a theme object.');
  for(const [key,value] of Object.entries(patch))if(!Object.hasOwn(catalog,key)||typeof value!=='string'||!Object.hasOwn(catalog[key],value))throw Error('Unsupported theme option: '+key);
  theme={...theme,...patch};paint(player.contentDocument);return {...theme};
}
window.applyGameTheme=applyGameTheme;
window.getGameThemeOptions=()=>Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,Object.keys(v)]));
function paint(doc){
  if(!doc?.body)return;
  const [paper,ink,accent]=catalog.palette[theme.palette];
  const [place,pattern,landmark,sky,ground]=catalog.environment[theme.environment];
  const actor=catalog.character[theme.character];
  for(const [key,value] of Object.entries({paper,ink,accent,sky,ground}))doc.documentElement.style.setProperty('--'+key,value);
  let scene=doc.getElementById('theme-scene');
  if(!scene){
    const css=doc.createElement('style');css.textContent=themeCSS;doc.head.append(css);
    scene=doc.createElement('div');scene.id='theme-scene';doc.body.prepend(scene);
  }
  scene.textContent=actor+'   '+theme.character.toUpperCase()+'   /   '+place+'     '+landmark+'  '+pattern;
  doc.body.dataset.environment=theme.environment;
  doc.documentElement.style.setProperty('--actor',JSON.stringify(actor));
  doc.documentElement.style.setProperty('--landmark',JSON.stringify(landmark+'   '+pattern+'   '+landmark));
  const feed=doc.querySelector('#port small');if(feed)feed.textContent='● LIVE FEED / '+place.toUpperCase();
  const header=doc.querySelector('header');if(header)header.style.color='var(--ink)';
}
const themeCSS=`
body{background:var(--paper);color:var(--ink)}
#theme-scene{background:linear-gradient(120deg,var(--sky),var(--ground));color:white;font:700 14px system-ui;letter-spacing:.06em;padding:20px max(4vw,20px);border-bottom:4px solid var(--accent)}
article,#feedback{background:white;color:var(--ink);border:1px solid var(--accent)}
button,select,.card{color:var(--ink);background:white;border-color:var(--accent)}
button:hover,button[aria-pressed=true],#actions button:first-child{background:var(--accent);color:white}
small,button small,.card small,p,h1 span{color:var(--ink)}
button[aria-pressed=true] small{color:white}input{accent-color:var(--accent)}
#port{background:radial-gradient(circle at 2px 2px,#ffffff55 1px,transparent 2px) 0 0/53px 47px,linear-gradient(165deg,var(--sky),var(--ground))}
#port small{color:white}
body:not([data-environment=space]) .planet{background:none;box-shadow:none;width:auto;height:auto;border:0;font:54px system-ui}
body:not([data-environment=space]) .planet:after{content:var(--landmark);position:static;display:block;transform:none;border:0}
.sprite:after{content:var(--actor);position:absolute;font:12px system-ui;bottom:4px;left:40%}.sprite{position:relative}
`;
