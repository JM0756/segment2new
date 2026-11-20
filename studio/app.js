const $=id=>document.getElementById(id);
let items=[],active,path,busy=false;
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;return b;}
function play(item,file){
  active=item;path=file;
  const url=new URL('/arcade/'+item.game+'/source/index.html',location.origin);
  url.searchParams.set('config',file);
  if(item.levels[2])url.searchParams.set('next',item.levels[2]);
  if(file===item.levels[2])url.searchParams.set('advanced','1');
  $('stage').src=url;$('game').value=item.game;
  $('levels').replaceChildren(...Object.entries(item.levels).map(([n,f])=>{
    const b=button('L'+n,()=>play(item,f));b.setAttribute('aria-pressed',String(f===file));return b;
  }));
  [...$('catalog').children].forEach((b,i)=>b.setAttribute('aria-pressed',String(items[i]===item)));
}
async function refresh(selected){
  items=await (await fetch('/api/catalog')).json();
  const games=[...new Set(items.map(i=>i.game))];$('game').replaceChildren(...games.map(g=>new Option(g,g)));
  $('catalog').replaceChildren(...items.map(item=>{
    const first=Object.values(item.levels)[0];
    const b=button(item.title,()=>play(item,first)),type=document.createElement('small');type.textContent=item.game;b.prepend(type);
    if(item.thumbnail){const img=new Image();img.alt='';img.src=new URL(item.thumbnail,new URL(first,location.href));b.prepend(img);}
    return b;
  }));
  const item=items.find(i=>Object.values(i.levels).includes(selected))||items[0];play(item,selected||Object.values(item.levels)[0]);
}
function tab(chat){$('chat').hidden=!chat;$('generate').hidden=chat;$('chatTab').setAttribute('aria-pressed',chat);$('genTab').setAttribute('aria-pressed',!chat);}
$('genTab').onclick=()=>tab(false);$('chatTab').onclick=()=>tab(true);
async function send(e,chat){
  e.preventDefault();if(busy)return;busy=true;
  document.querySelectorAll('.primary').forEach(b=>b.disabled=true);
  $('status').textContent=chat?'Validating your revision…':'Generating activity…';
  const data=chat?{game:active.game,path,message:$('message').value}:{game:$('game').value,topic:$('topic').value,theme:$('theme').value,pair:$('difficulty').selectedIndex===1,sprites:$('sprites').checked};
  try{
    const r=await fetch('/api/'+(chat?'chat-refine':'generate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await r.json();if(!r.ok)throw Error(result.error);
    await refresh(result.path);$('status').textContent=result.message||'Saved and loaded.';
    if(chat){const line=document.createElement('p');line.textContent=data.message+' → '+active.title;$('history').append(line);$('message').value='';}
  }catch(err){$('status').textContent=err.message;}
  finally{busy=false;document.querySelectorAll('.primary').forEach(b=>b.disabled=false);}
}
$('generate').onsubmit=e=>send(e,false);$('chat').onsubmit=e=>send(e,true);
tab(false);refresh().catch(e=>{$('status').textContent=e.message;});

$('stage').addEventListener('load',()=>{
  const file=new URL($('stage').contentWindow.location.href).searchParams.get('config');
  if(file && file!==path){
    const absolute=new URL(file,$('stage').contentWindow.location.href).pathname;
    const item=items.find(i=>Object.values(i.levels).includes(absolute));
    if(item)play(item,absolute);
  }
});
