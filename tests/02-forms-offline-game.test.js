const fs=require('fs'),{JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const path=require('path');
const {waitFor,trackErrors,finish,crash}=require('./harness');
const dir=path.resolve(__dirname,'..');
const html=fs.readFileSync(dir+'/index.html','utf8');
const appjs=fs.readFileSync(dir+'/app.js','utf8');

let netCalls=0;
const TY=['fire','water','grass','electric','flying','steel','ghost','dragon'];
const mkPoke=(id,name,types)=>({id,name,height:10,weight:100,base_experience:60,
  species:{url:'/pokemon-species/'+(id>10000?26:id)+'/'},
  types:types.map(t=>({type:{name:t}})),
  stats:[['hp',60,1],['attack',80,2],['defense',70,0],['special-attack',90,0],['special-defense',75,0],['speed',100,0]]
    .map(([n,v,e])=>({base_stat:v,effort:e,stat:{name:n}})),
  abilities:[{ability:{name:'blaze'},is_hidden:false}],
  moves:[{move:{name:'ember'},version_group_details:[{level_learned_at:7,move_learn_method:{name:'level-up'}}]}],
  sprites:{other:{'official-artwork':{front_default:'x.png',front_shiny:'s.png'}}},cries:{latest:'c.ogg'}});

global.fetch=async(url)=>{
  netCalls++;
  let data;
  if(url.includes('pokemon-species?')) data={results:Array.from({length:60},(_,i)=>({name:'mon'+(i+1),url:'/pokemon-species/'+(i+1)+'/'}))};
  else if(url.includes('/pokemon-species/')){
    const sid=+url.match(/pokemon-species\/(\d+)/)[1];
    // species 26 (raichu) gets three varieties to exercise the form selector
    const varieties = sid===26
      ? [{is_default:true,pokemon:{name:'raichu',url:'/pokemon/26/'}},
         {is_default:false,pokemon:{name:'raichu-alola',url:'/pokemon/10100/'}}]
      : [{is_default:true,pokemon:{name:'mon'+sid,url:'/pokemon/'+sid+'/'}}];
    data={name:sid===26?'raichu':'mon'+sid,id:sid,gender_rate:4,capture_rate:45,hatch_counter:20,base_happiness:50,
      egg_groups:[{name:'monster'}],growth_rate:{name:'medium-slow'},habitat:{name:'forest'},shape:{name:'upright'},
      varieties,is_legendary:false,is_mythical:false,is_baby:false,
      flavor_text_entries:[{language:{name:'en'},flavor_text:'A test mon.'}],
      genera:[{language:{name:'en'},genus:'Test Pokémon'}],evolution_chain:{url:'/evolution-chain/1/'}};
  }
  else if(url.includes('/evolution-chain/')) data={chain:{species:{name:'mon1',url:'/pokemon-species/1/'},evolves_to:[]}};
  else if(url.includes('/move/')) data={name:'ember',power:40,accuracy:100,pp:25,type:{name:'fire'},damage_class:{name:'special'}};
  else if(url.includes('/ability/')) data={effect_entries:[{language:{name:'en'},short_effect:'Powers up Fire moves.'}]};
  else if(url.match(/\/pokemon\/(\d+)/)){
    const id=+url.match(/\/pokemon\/(\d+)/)[1];
    if(id===10100) data=mkPoke(10100,'raichu-alola',['electric','psychic']);   // Alolan: different types
    else if(id===26) data=mkPoke(26,'raichu',['electric']);
    else data=mkPoke(id,'mon'+id,[TY[id%TY.length],TY[(id+3)%TY.length]]);
  }
  else data={};
  return {ok:true,json:async()=>data};
};

const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.test/',pretendToBeVisual:true});
const w=dom.window;
w.fetch=global.fetch; w.indexedDB=indexedDB; w.IDBKeyRange=IDBKeyRange;
w.Audio=function(){return{play:async()=>{}}};
w.confirm=()=>true;
w.CSS={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
w.navigator.storage={estimate:async()=>({usage:5e7,quota:2e9}),persist:async()=>true};
let copied=null;
w.navigator.clipboard={writeText:async t=>{copied=t}};
w.localStorage.clear();
const errs=trackErrors(w);
w.eval(appjs);
const d=w.document,$=id=>d.getElementById(id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

(async()=>{
 let fail=0;const ok=(l,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+l);if(!c)fail++};
 await waitFor(()=>d.querySelectorAll('.poke-card').length>0);
 console.log('\n--- ALTERNATE FORMS ---');
 // names of the types listed in the "Weak to" block of the matchups tab (null when there is no such block)
 const weakBlock=()=>{
   const b=[...d.querySelectorAll('.mu-block')].find(x=>/^Weak to/.test(x.querySelector('h4').textContent.trim()));
   return b?[...b.querySelectorAll('.type')].map(e=>e.textContent.trim()).sort():null;
 };
 // species 26 = raichu with an Alolan variety
 w.location.hash='#/pokemon/26'; await waitFor(()=>d.querySelectorAll('.formchip').length===2);
 ok('modal open on species 26', !$('overlay').hidden);
 ok('form selector shown', d.querySelectorAll('.formchip').length===2);
 ok('default form active', d.querySelector('.formchip.on').textContent.trim()==='Default');
 ok('default typing is Electric only', d.querySelectorAll('.detail-hero .type').length===1);

 click(d.querySelector('[data-tab="matchups"]')); await waitFor(()=>weakBlock()!==null);
 const beforeGround=$('modalContent').innerHTML.includes('Ground');
 ok('base form matchups rendered', beforeGround);
 // pure Electric is weak only to Ground, so the base form's 2x block is exactly that
 ok('base form weak block is exactly [Ground]', JSON.stringify(weakBlock())===JSON.stringify(['Ground']));

 // switch to Alolan form
 const alola=[...d.querySelectorAll('.formchip')].find(b=>b.textContent.trim()==='Alola');
 click(alola); await waitFor(()=>d.querySelector('.formchip.on')&&d.querySelector('.formchip.on').textContent.trim()==='Alola');
 ok('Alolan form selected', d.querySelector('.formchip.on').textContent.trim()==='Alola');
 ok('title shows the form', $('modalContent').innerHTML.includes('Raichu · Alola'));
 click(d.querySelector('[data-tab="matchups"]')); await waitFor(()=>weakBlock()!==null);
 const html2=$('modalContent').innerHTML;
 ok('Alolan gains Psychic typing', html2.includes('Psychic'));
 // Electric/Psychic takes 2x from Bug, Dark, Ghost and Ground; Electric is resisted (Electric 0.5 x Psychic 1)
 const weak2=weakBlock();
 ok('matchups recomputed for form: Dark and Ground in the 2x block', !!weak2&&weak2.includes('Dark')&&weak2.includes('Ground'));
 ok('Electric is not in the 2x block', !!weak2&&!weak2.includes('Electric'));
 ok('2x block is exactly Bug, Dark, Ghost, Ground', JSON.stringify(weak2)===JSON.stringify(['Bug','Dark','Ghost','Ground']));
 ok('Dark cell in the full chart reads 2x', [...d.querySelectorAll('.mu-cell')].some(c=>c.querySelector('span').textContent==='Dark'&&c.querySelector('b').textContent==='2×'));

 click(d.querySelector('[data-tab="stats"]')); await waitFor(()=>$('modalContent').innerHTML.includes('Base statistics'));
 ok('stats tab works on form', $('modalContent').innerHTML.includes('Base statistics'));

 // add the FORM to the team
 click(d.querySelector('[data-tab="overview"]')); await waitFor(()=>!!$('modalContent').querySelector('[data-team]'));
 click($('modalContent').querySelector('[data-team]')); await waitFor(()=>$('teamCount').textContent==='1');
 ok('form added to team', $('teamCount').textContent==='1');
 $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await wait(100);
 w.location.hash='#/team'; await waitFor(()=>$('panel').innerHTML.includes('Coverage heatmap'));
 ok('team view names the form', $('panel').innerHTML.toLowerCase().includes('raichu alola'));
 ok('team analysis ran on form', $('panel').innerHTML.includes('Coverage heatmap'));

 console.log('\n--- OFFLINE DEX ---');
 w.location.hash='#/offline'; await waitFor(()=>$('panel').innerHTML.includes('Offline Dex'));
 ok('offline view rendered', $('panel').innerHTML.includes('Offline Dex'));
 ok('storage reported', $('panel').innerHTML.includes('MB'));
 const before=netCalls;
 click(d.querySelector('[data-dlstart]'));
 await waitFor(()=>$('dlLabel')&&/\d+ \/ 120/.test($('dlLabel').textContent)&&netCalls>before+10,6000);
 const entriesTxt=$('dlLabel')?$('dlLabel').textContent:'';
 ok('download made progress', /\d+ \/ 120/.test(entriesTxt));
 ok('download used the network', netCalls>before);
 // the cache-first check below only means something once every record is stored
 await waitFor(()=>$('panel').innerHTML.includes('FULLY AVAILABLE OFFLINE'),20000);
 ok('download finished: the view reports the dex as fully available offline', $('panel').innerHTML.includes('FULLY AVAILABLE OFFLINE'));
 // cache-first: re-requesting should not hit network
 const n2=netCalls;
 w.location.hash='#/'; await wait(300);
 w.location.hash='#/pokemon/5'; await waitFor(()=>!$('overlay').hidden&&$('modalContent').innerHTML.includes('About'));
 ok('cached data served without network', netCalls===n2);
 $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await wait(100);

 console.log('\n--- WHO\'S THAT POKEMON ---');
 w.location.hash='#/game'; await wait(300);
 ok('game menu rendered', $('panel').innerHTML.includes("Who's That Pok"));
 ok('two game modes offered', d.querySelectorAll('.gamecard').length===2);
 click(d.querySelector('[data-game="daily"]')); await wait(200);
 ok('question rendered', !!d.querySelector('.silhouette'));
 ok('4 options shown', d.querySelectorAll('.guessbtn').length===4);
 ok('silhouette hidden initially', !d.querySelector('.silhouette').classList.contains('revealed'));

 // capture the daily questions to verify determinism later
 const firstRun=[...d.querySelectorAll('.guessbtn')].map(b=>b.textContent.trim()).join(',');

 for(let i=0;i<5;i++){
   const btns=[...d.querySelectorAll('.guessbtn')];
   if(!btns.length) break;
   click(btns[0]); await wait(150);
   if(i===0) ok('silhouette revealed after answer', d.querySelector('.silhouette').classList.contains('revealed'));
   const nxt=d.querySelector('[data-gamenext]');
   if(nxt){click(nxt);await wait(200)}
 }
 ok('results screen shown', $('panel').innerHTML.includes('/5'));
 ok('share grid rendered', /[🟩🟥]/.test($('panel').innerHTML));
 ok('streak recorded', +$('streakCount').textContent>=1);
 click(d.querySelector('[data-share]')); await wait(150);
 ok('share copies to clipboard', !!copied && copied.includes("Who's That"));
 ok('share text has score', /\d\/5/.test(copied));

 // determinism: replay daily should give identical questions
 click(d.querySelector('[data-gamemenu]')); await wait(150);
 click(d.querySelector('[data-game="daily"]')); await wait(250);
 const secondRun=[...d.querySelectorAll('.guessbtn')].map(b=>b.textContent.trim()).join(',');
 ok('daily challenge is deterministic', firstRun===secondRun);

 click(d.querySelector('[data-gamemenu]')); await wait(150);
 click(d.querySelector('[data-gamegen="1"]')); await wait(150);
 ok('generation filter selectable', !!d.querySelector('[data-gamegen="1"].on'));
 click(d.querySelector('[data-game="endless"]')); await wait(250);
 ok('endless mode starts', d.querySelectorAll('.guessbtn').length===4);

 console.log('\n--- REGRESSION ---');
 w.location.hash='#/'; await wait(300);
 ok('grid still renders', d.querySelectorAll('.poke-card').length>0);
 w.location.hash='#/progress'; await wait(250);
 ok('living dex still renders', d.querySelectorAll('.genbar').length===9);
 w.location.hash='#/matchups'; await wait(250);
 ok('matchup calc still renders', d.querySelector('.result-card strong').textContent==='2×');

 finish(fail,errs);
})().catch(crash);
