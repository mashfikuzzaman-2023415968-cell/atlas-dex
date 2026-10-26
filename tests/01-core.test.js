const fs=require('fs'),{JSDOM}=require('jsdom');
const path=require('path');
const dir=path.resolve(__dirname,'..');
const html=fs.readFileSync(dir+'/index.html','utf8');
const appjs=fs.readFileSync(dir+'/app.js','utf8');

const mkPoke=(id,types)=>({id,name:'mon'+id,height:10,weight:100,base_experience:60,
  types:types.map(t=>({type:{name:t}})),
  stats:[['hp',60,1],['attack',80,2],['defense',70,0],['special-attack',90,0],['special-defense',75,0],['speed',100,0]]
    .map(([n,v,e])=>({base_stat:v,effort:e,stat:{name:n}})),
  abilities:[{ability:{name:'blaze'},is_hidden:false}],
  moves:[{move:{name:'ember'},version_group_details:[{level_learned_at:7,move_learn_method:{name:'level-up'}}]}],
  sprites:{other:{'official-artwork':{front_default:'x.png',front_shiny:'s.png'}}},cries:{latest:'c.ogg'}});

const TY=['fire','water','grass','electric','flying','steel','ghost','dragon'];
global.fetch=async(url)=>{
  let data;
  if(url.includes('pokemon-species?')) data={results:Array.from({length:60},(_,i)=>({name:'mon'+(i+1),url:'/pokemon-species/'+(i+1)+'/'}))};
  else if(url.includes('/pokemon-species/')) data={name:'mon1',gender_rate:4,capture_rate:45,hatch_counter:20,base_happiness:50,
    egg_groups:[{name:'monster'}],growth_rate:{name:'medium-slow'},habitat:{name:'forest'},shape:{name:'upright'},
    is_legendary:false,is_mythical:false,is_baby:false,generation:{name:'generation-i'},
    flavor_text_entries:[{language:{name:'en'},flavor_text:'A test mon.'}],genera:[{language:{name:'en'},genus:'Test Pokémon'}],
    evolution_chain:{url:'/evolution-chain/1/'},id:1};
  else if(url.includes('/evolution-chain/')) data={chain:{species:{name:'mon1',url:'/pokemon-species/1/'},evolves_to:[
    {species:{name:'mon2',url:'/pokemon-species/2/'},evolution_details:[{min_level:16}],evolves_to:[]}]}};
  else if(url.includes('/move/')) data={name:'ember',power:40,accuracy:100,pp:25,type:{name:'fire'},damage_class:{name:'special'}};
  else if(url.includes('/ability/')) data={effect_entries:[{language:{name:'en'},short_effect:'Powers up Fire moves.'}]};
  else if(url.match(/\/pokemon\/(\d+)/)){const id=+url.match(/\/pokemon\/(\d+)/)[1];data=mkPoke(id,[TY[id%TY.length],TY[(id+3)%TY.length]]);}
  else data={};
  return {ok:true,json:async()=>data};
};

const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.test/',pretendToBeVisual:true});
const w=dom.window;
['fetch','AbortController','setTimeout','clearTimeout'].forEach(k=>{if(!w[k])w[k]=global[k]});
w.fetch=global.fetch;
w.Audio=function(){return{play:async()=>{}}};
w.confirm=()=>true;
w.CSS={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
w.localStorage.clear();
const errs=[];w.addEventListener('error',e=>errs.push(e.message));

w.eval(appjs);
const d=w.document, $=id=>d.getElementById(id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=el=>{el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))};

(async()=>{
  let fail=0; const ok=(l,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+l); if(!c)fail++};
  await wait(400);

  ok('grid rendered cards', d.querySelectorAll('.poke-card').length>0);
  ok('species total shown', $('totalStat').textContent==='60');

  // catch a pokemon
  click(d.querySelector('.catchbtn'));
  await wait(50);
  ok('caught counter incremented', $('caughtCount').textContent==='1');
  ok('hero % updated', $('heroPct').textContent!=='0%');

  // build a team of 3
  const teamBtns=[...d.querySelectorAll('[data-team]')].slice(0,3);
  for(const b of teamBtns){click(b);await wait(60)}
  ok('team has 3 members', $('teamCount').textContent==='3');
  ok('team dock visible', !$('teamDock').hidden);

  // team view
  w.location.hash='#/team'; await wait(300);
  ok('team view rendered', $('panel').innerHTML.includes('Coverage heatmap'));
  ok('heatmap has 18 type rows', d.querySelectorAll('.heat-row').length===19);
  ok('verdict cards present', d.querySelectorAll('.verdict').length===4);
  ok('team slots = 6', d.querySelectorAll('.team-slot').length===6);

  // living dex
  w.location.hash='#/progress'; await wait(200);
  ok('progress view rendered', $('panel').innerHTML.includes('Living Dex'));
  ok('9 generation bars', d.querySelectorAll('.genbar').length===9);
  ok('ring shows percent', !!d.querySelector('.ring-inner strong').textContent.match(/%/));

  // matchups
  w.location.hash='#/matchups'; await wait(200);
  ok('matchup calculator rendered', $('panel').innerHTML.includes('Type Matchup Calculator'));
  ok('fire vs grass = 2x', d.querySelector('.result-card strong').textContent==='2×');
  const tps=[...d.querySelectorAll('[data-picker="def1"] .tp')];
  click(tps.find(b=>b.dataset.val==='water')); await wait(120);
  ok('fire vs water = 1/2x', d.querySelector('.result-card strong').textContent==='½×');

  // detail modal tabs
  w.location.hash='#/'; await wait(250);
  click(d.querySelector('.poke-card')); await wait(300);
  ok('modal opened', !$('overlay').hidden);
  ok('overview has abilities', $('modalContent').innerHTML.includes('Abilities'));
  await wait(200);
  ok('ability text loaded', $('modalContent').innerHTML.includes('Powers up Fire'));

  for(const [tab,needle] of [['stats','Base statistics'],['matchups','Defensive matchups'],
      ['evolution','Evolution family'],['breeding','EGG GROUPS'],['moves','Move']]){
    click(d.querySelector(`[data-tab="${tab}"]`)); await wait(260);
    ok(`tab: ${tab}`, $('modalContent').innerHTML.includes(needle));
  }
  ok('move table filled type', $('modalContent').innerHTML.includes('Fire'));
  ok('move power filled', !!d.querySelector('.mv-pow') && d.querySelector('.mv-pow').textContent==='40');

  // filters
  $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await wait(100);
  click(d.querySelector('[data-chip="uncaught"]')); await wait(150);
  ok('uncaught chip filters', $('resultCount').textContent==='59');
  click(d.querySelector('[data-chip="legendary"]')); await wait(150);
  ok('legendary chip applies', $('resultCount').textContent!=='59');

  console.log('\nruntime errors: '+(errs.length?errs.join(' | '):'none'));
  console.log(fail?`\n${fail} FAILURES`:'\nAll smoke tests passed');
})();
