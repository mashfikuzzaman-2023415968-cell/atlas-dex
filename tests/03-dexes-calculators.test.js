const fs=require('fs'),{JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const path=require('path');
const dir=path.resolve(__dirname,'..');
const html=fs.readFileSync(dir+'/index.html','utf8');
const appjs=fs.readFileSync(dir+'/app.js','utf8');
const TY=['fire','water','grass','electric','flying','steel','ghost','dragon'];
const MOVES=['ember','surf','nasty-plot','thunderbolt','flamethrower','tackle'];
const ABIL=['blaze','torrent','levitate','intimidate'];
const ITEMS=['potion','oran-berry','fire-stone','leftovers'];
const mkPoke=(id,name,types)=>({id,name,height:10,weight:100,base_experience:60,
  species:{url:'/pokemon-species/'+(id>10000?26:id)+'/'},
  types:types.map(t=>({type:{name:t}})),
  stats:[['hp',60,1],['attack',108,2],['defense',70,0],['special-attack',90,0],['special-defense',75,0],['speed',100,0]]
    .map(([n,v,e])=>({base_stat:v,effort:e,stat:{name:n}})),
  abilities:[{ability:{name:'blaze'},is_hidden:false}],
  moves:[{move:{name:'ember'},version_group_details:[{level_learned_at:7,move_learn_method:{name:'level-up'}}]}],
  sprites:{other:{'official-artwork':{front_default:'x.png',front_shiny:'s.png'}}},cries:{latest:'c.ogg'}});

global.fetch=async(url)=>{
 let data={};
 const m=s=>url.includes(s);
 if(m('pokemon-species?')) data={results:Array.from({length:60},(_,i)=>({name:'mon'+(i+1),url:'/pokemon-species/'+(i+1)+'/'}))};
 else if(m('/move?limit')) data={results:MOVES.map((n,i)=>({name:n,url:'/move/'+(i+1)+'/'}))};
 else if(m('/ability?limit')) data={results:ABIL.map((n,i)=>({name:n,url:'/ability/'+(i+1)+'/'}))};
 else if(m('/item?limit')) data={results:ITEMS.map((n,i)=>({name:n,url:'/item/'+(i+1)+'/'}))};
 else if(m('/egg-group/')) data={pokemon_species:[{name:'mon1'},{name:'mon2'},{name:'mon3'}]};
 else if(m('/encounters')) data=[{location_area:{name:'route-1-area'},version_details:[
    {version:{name:'red'},encounter_details:[{chance:35,min_level:3,max_level:6}]}]}];
 else if(m('/move/')){const n=url.split('/move/')[1].replace(/\/$/,'');
   data={name:n,power:n==='nasty-plot'?null:90,accuracy:100,pp:15,priority:0,type:{name:'fire'},
     damage_class:{name:n==='nasty-plot'?'status':'special'},
     effect_entries:[{language:{name:'en'},short_effect:'Deals damage.'}],
     learned_by_pokemon:[{name:'mon1'},{name:'mon2'}]};}
 else if(m('/ability/')){const n=url.split('/ability/')[1].replace(/\/$/,'');
   data={name:n,generation:{name:'generation-iii'},is_main_series:true,
     effect_entries:[{language:{name:'en'},short_effect:'Powers up Fire moves.'}],
     pokemon:[{pokemon:{name:'mon1'},is_hidden:false}]};}
 else if(m('/item/')){const n=url.split('/item/')[1].replace(/\/$/,'');
   data={name:n,cost:200,fling_power:30,category:{name:'healing'},sprites:{default:'i.png'},
     effect_entries:[{language:{name:'en'},short_effect:'Restores HP.'}],held_by_pokemon:[]};}
 else if(m('/pokemon-species/')){const sid=+url.match(/pokemon-species\/(\d+)/)[1];
   const varieties=sid===26?[{is_default:true,pokemon:{name:'raichu',url:'/pokemon/26/'}},
     {is_default:false,pokemon:{name:'raichu-alola',url:'/pokemon/10100/'}}]
     :[{is_default:true,pokemon:{name:'mon'+sid,url:'/pokemon/'+sid+'/'}}];
   data={name:sid===26?'raichu':'mon'+sid,id:sid,gender_rate:4,capture_rate:45,hatch_counter:20,base_happiness:50,
     egg_groups:[{name:'monster'}],growth_rate:{name:'medium-slow'},habitat:{name:'forest'},shape:{name:'upright'},
     varieties,is_legendary:false,is_mythical:false,is_baby:false,
     flavor_text_entries:[{language:{name:'en'},flavor_text:'A test mon.'}],
     genera:[{language:{name:'en'},genus:'Test'}],evolution_chain:{url:'/evolution-chain/1/'}};}
 else if(m('/evolution-chain/')) data={chain:{species:{name:'mon1',url:'/pokemon-species/1/'},evolves_to:[]}};
 else if(url.match(/\/pokemon\/(\d+)$/)||url.match(/\/pokemon\/(\d+)\/$/)){
   const id=+url.match(/\/pokemon\/(\d+)/)[1];
   data=id===10100?mkPoke(10100,'raichu-alola',['electric','psychic']):mkPoke(id,'mon'+id,[TY[id%TY.length],TY[(id+3)%TY.length]]);}
 return {ok:true,json:async()=>data};
};
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.test/',pretendToBeVisual:true});
const w=dom.window;
w.fetch=global.fetch;w.indexedDB=indexedDB;w.IDBKeyRange=IDBKeyRange;
w.Audio=function(){return{play:async()=>{}}};w.confirm=()=>true;w.prompt=()=>'Rain Team';
w.CSS={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
w.navigator.storage={estimate:async()=>({usage:5e7,quota:2e9}),persist:async()=>true};
let copied=null;w.navigator.clipboard={writeText:async t=>{copied=t}};
let downloaded=false;
const origCreate=w.document.createElement.bind(w.document);
w.document.createElement=tag=>{const el=origCreate(tag);if(tag==='a'){el.click=()=>{downloaded=true}}return el};
w.localStorage.clear();
const errs=[];w.addEventListener('error',e=>errs.push(e.message));
w.eval(appjs);
const d=w.document,$=id=>d.getElementById(id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const key=(k,o={})=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,...o}));
const typeIn=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
const chg=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}))};

(async()=>{
 let fail=0;const ok=(l,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+l);if(!c)fail++};
 await wait(500);

 console.log('\n--- MOVES / ABILITIES / ITEMS DEXES ---');
 w.location.hash='#/moves';await wait(800);
 ok('moves dex renders',$('panel').innerHTML.includes('Moves'));
 ok('move rows present',d.querySelectorAll('.dexrow[data-entity]').length>0);
 ok('move data hydrated (power shown)',/\b90\b/.test($('panel').innerHTML));
 typeIn($('brSearch'),'nasty');await wait(500);
 ok('move search filters',d.querySelectorAll('.dexrow[data-entity]').length===1);
 click(d.querySelector('.dexrow[data-entity]'));await wait(400);
 ok('move detail modal opens',$('modalContent').innerHTML.includes('Nasty Plot'));
 ok('move shows learners',$('modalContent').innerHTML.includes('Learned by'));
 click(d.querySelector('[data-openname]'));await wait(400);
 ok('learner chip opens that Pokemon',$('modalContent').innerHTML.includes('About'));
 $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await wait(100);

 w.location.hash='#/abilities';await wait(700);
 ok('abilities dex renders',d.querySelectorAll('.dexrow.ability[data-entity]').length>0);
 ok('ability effect text shown',$('panel').innerHTML.includes('Powers up Fire'));
 w.location.hash='#/items';await wait(700);
 ok('items dex renders',d.querySelectorAll('.dexrow.item[data-entity]').length>0);
 ok('item cost shown',$('panel').innerHTML.includes('₽200'));
 click(d.querySelector('.dexrow.item[data-entity]'));await wait(400);
 ok('item detail opens',$('modalContent').innerHTML.includes('Restores HP'));
 $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await wait(100);

 console.log('\n--- CALCULATORS ---');
 w.location.hash='#/calc';await wait(400);
 ok('calculators render',$('panel').innerHTML.includes('Calculators'));
 ok('6 calculator tabs',d.querySelectorAll('[data-calctab]').length===6);
 click(d.querySelector('[data-calctab="damage"]'));await wait(250);
 ok('damage tab renders',$('panel').innerHTML.includes('DAMAGE RANGE'));
 const dmgBefore=d.querySelector('.result-card strong').textContent;
 const powerInput=d.querySelector('[data-calc="dPower"]');
 typeIn(powerInput,'160');await wait(300);
 ok('damage recalculates on input',d.querySelector('.result-card strong').textContent!==dmgBefore);
 click(d.querySelector('[data-calctab="catch"]'));await wait(250);
 ok('catch tab renders',$('panel').innerHTML.includes('CATCH CHANCE'));
 const catchBefore=d.querySelector('.result-card strong').textContent;
 chg(d.querySelector('[data-calc="cBall"]'),'Ultra Ball');await wait(300);
 ok('ball choice changes catch odds',d.querySelector('.result-card strong').textContent!==catchBefore);
 click(d.querySelector('[data-calctab="natures"]'));await wait(250);
 ok('all 25 natures listed',d.querySelectorAll('.naturecard').length===25);
 click(d.querySelector('[data-calctab="breeding"]'));await wait(600);
 ok('breeding egg group loads',$('panel').innerHTML.includes('compatible species'));

 console.log('\n--- STAT CALC IN MODAL + ENCOUNTERS ---');
 w.location.hash='#/pokemon/3';await wait(700);
 click(d.querySelector('[data-tab="stats"]'));await wait(300);
 ok('stats tab has actual-stat calc',$('modalContent').innerHTML.includes('Actual stats'));
 const lvl=d.querySelector('[data-calc="level"]');
 const statsBefore=$('modalContent').innerHTML;
 typeIn(lvl,'100');await wait(350);
 ok('changing level updates real stats',$('modalContent').innerHTML!==statsBefore);
 click(d.querySelector('[data-tab="encounters"]'));await wait(500);
 ok('encounters tab loads locations',$('modalContent').innerHTML.includes('Route 1'));
 ok('encounter shows level range',/Lv 3/.test($('modalContent').innerHTML));
 $('closeModal').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await wait(150);

 console.log('\n--- MULTIPLE TEAMS + EXPORT ---');
 w.location.hash='#/';await wait(400);
 const tb=[...d.querySelectorAll('[data-team]')].slice(0,2);
 for(const b of tb){click(b);await wait(200)}
 w.location.hash='#/team';await wait(500);
 ok('team tabs rendered',d.querySelectorAll('[data-teamsel]').length===1);
 click(d.querySelector('[data-teamnew]'));await wait(350);
 ok('second team created',d.querySelectorAll('[data-teamsel]').length===2);
 ok('new team is empty',$('teamCount').textContent==='0');
 click(d.querySelector('[data-teamsel="0"]'));await wait(350);
 ok('switching back restores members',$('teamCount').textContent==='2');
 click(d.querySelector('[data-teamrename]'));await wait(300);
 ok('team renamed',$('panel').innerHTML.includes('Rain Team'));
 click(d.querySelector('[data-showdown]'));await wait(250);
 ok('Showdown export copied',!!copied&&copied.includes('Ability:'));
 ok('Showdown omits blank move slots for empty builds',!copied.includes('- \n')&&copied.includes('Nature'));

 w.location.hash='#/offline';await wait(500);
 ok('data export button present',!!d.querySelector('[data-export]'));
 click(d.querySelector('[data-export]'));await wait(250);
 ok('backup file downloaded',downloaded);

 console.log('\n--- COMMAND PALETTE ---');
 key('k',{ctrlKey:true});await wait(400);
 ok('palette opens on Ctrl+K',!$('palette').hidden);
 ok('palette shows default routes',d.querySelectorAll('.pal-row').length>0);
 typeIn($('paletteInput'),'mon1');await wait(400);
 ok('palette finds Pokemon',[...d.querySelectorAll('.pal-label')].some(e=>e.textContent.includes('Mon1')));
 typeIn($('paletteInput'),'ember');await wait(500);
 ok('palette finds moves',[...d.querySelectorAll('.pal-kind')].some(e=>e.textContent==='Move'));
 typeIn($('paletteInput'),'potion');await wait(400);
 ok('palette finds items',[...d.querySelectorAll('.pal-kind')].some(e=>e.textContent==='Item'));
 typeIn($('paletteInput'),'team');await wait(300);
 const before=w.location.hash;
 key('ArrowDown');key('Enter');await wait(400);
 ok('palette Enter navigates',!$('palette').hidden===false);
 key('k',{ctrlKey:true});await wait(300);
 key('Escape');await wait(200);
 ok('Escape closes palette',$('palette').hidden);

 console.log('\n--- SORTING + REGRESSION ---');
 w.location.hash='#/';await wait(500);
 chg($('sortFilter'),'bst-desc');await wait(500);
 ok('stat-total sort applies',$('sortFilter').value==='bst-desc'&&d.querySelectorAll('.poke-card').length>0);
 w.location.hash='#/progress';await wait(300);
 ok('living dex still works',d.querySelectorAll('.genbar').length===9);
 w.location.hash='#/game';await wait(300);
 ok('game still works',d.querySelectorAll('.gamecard').length===2);
 w.location.hash='#/matchups';await wait(300);
 ok('matchups still work',d.querySelector('.result-card strong').textContent==='2×');

 console.log('\nruntime errors: '+(errs.length?errs.join(' | '):'none'));
 console.log(fail?`\n${fail} FAILURES`:'\nAll tests passed');
 process.exit(fail?1:0);
})();
