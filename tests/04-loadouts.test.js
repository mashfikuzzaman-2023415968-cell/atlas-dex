const fs=require('fs'),{JSDOM}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const path=require('path');
const {waitFor,trackErrors,finish,crash}=require('./harness');
const dir=path.resolve(__dirname,'..');
const html=fs.readFileSync(dir+'/index.html','utf8'),appjs=fs.readFileSync(dir+'/app.js','utf8');
// move library with distinct types so coverage changes are observable
const MOVEDB={
  'ember':{type:'fire',power:40,cls:'special'},
  'surf':{type:'water',power:90,cls:'special'},
  'earthquake':{type:'ground',power:100,cls:'physical'},
  'ice-beam':{type:'ice',power:90,cls:'special'},
  'nasty-plot':{type:'dark',power:null,cls:'status'},
  'tackle':{type:'normal',power:40,cls:'physical'}
};
const MOVES=Object.keys(MOVEDB);
const mkPoke=(id,name,types)=>({id,name,height:10,weight:100,base_experience:60,
  species:{url:'/pokemon-species/'+id+'/'},types:types.map(t=>({type:{name:t}})),
  stats:[['hp',108,0],['attack',130,0],['defense',95,0],['special-attack',80,0],['special-defense',85,0],['speed',102,0]]
    .map(([n,v,e])=>({base_stat:v,effort:e,stat:{name:n}})),
  abilities:[{ability:{name:'blaze'},is_hidden:false},{ability:{name:'levitate'},is_hidden:true}],
  moves:MOVES.map(n=>({move:{name:n},version_group_details:[{level_learned_at:5,move_learn_method:{name:'level-up'}}]})),
  sprites:{other:{'official-artwork':{front_default:'x.png',front_shiny:'s.png'}}},cries:{latest:'c.ogg'}});
const TYPEOF={1:['fire'],2:['water'],3:['grass'],4:['electric'],5:['ground'],6:['steel']};
global.fetch=async(url)=>{
 let data={};const m=s=>url.includes(s);
 if(m('pokemon-species?'))data={results:Array.from({length:30},(_,i)=>({name:'mon'+(i+1),url:'/pokemon-species/'+(i+1)+'/'}))};
 else if(m('/move?limit'))data={results:MOVES.map((n,i)=>({name:n,url:'/move/'+(i+1)+'/'}))};
 else if(m('/ability?limit'))data={results:[{name:'blaze',url:'/ability/1/'}]};
 else if(m('/item?limit'))data={results:[{name:'leftovers',url:'/item/1/'},{name:'life-orb',url:'/item/2/'}]};
 else if(m('/egg-group/'))data={pokemon_species:[{name:'mon1'}]};
 else if(m('/encounters'))data=[];
 else if(m('/move/')){const n=url.split('/move/')[1].replace(/\/$/,'');const d=MOVEDB[n]||MOVEDB.tackle;
   data={name:n,power:d.power,accuracy:100,pp:15,priority:0,type:{name:d.type},damage_class:{name:d.cls},
     effect_entries:[{language:{name:'en'},short_effect:'x'}],learned_by_pokemon:[]};}
 else if(m('/ability/'))data={name:'blaze',effect_entries:[{language:{name:'en'},short_effect:'x'}],pokemon:[]};
 else if(m('/item/'))data={name:'leftovers',cost:200,category:{name:'held'},sprites:{default:'i.png'},effect_entries:[{language:{name:'en'},short_effect:'x'}]};
 else if(m('/pokemon-species/')){const sid=+url.match(/pokemon-species\/(\d+)/)[1];
   data={name:'mon'+sid,id:sid,gender_rate:4,capture_rate:45,hatch_counter:20,base_happiness:50,
     egg_groups:[{name:'monster'}],growth_rate:{name:'medium-slow'},varieties:[{is_default:true,pokemon:{name:'mon'+sid,url:'/pokemon/'+sid+'/'}}],
     is_legendary:false,is_mythical:false,flavor_text_entries:[{language:{name:'en'},flavor_text:'x'}],
     genera:[{language:{name:'en'},genus:'T'}],evolution_chain:{url:'/evolution-chain/1/'}};}
 else if(m('/evolution-chain/'))data={chain:{species:{name:'mon1',url:'/pokemon-species/1/'},evolves_to:[]}};
 else if(url.match(/\/pokemon\/(\d+)/)){const id=+url.match(/\/pokemon\/(\d+)/)[1];
   data=mkPoke(id,'mon'+id,TYPEOF[id]||['normal']);}
 return{ok:true,json:async()=>data};
};
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.test/',pretendToBeVisual:true});
const w=dom.window;
w.fetch=global.fetch;w.indexedDB=indexedDB;w.IDBKeyRange=IDBKeyRange;
w.Audio=function(){return{play:async()=>{}}};w.confirm=()=>true;w.prompt=()=>'Main';
w.CSS={escape:s=>s.replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
w.navigator.storage={estimate:async()=>({usage:1,quota:2}),persist:async()=>true};
let copied=null;w.navigator.clipboard={writeText:async t=>{copied=t}};
w.localStorage.clear();
const errs=trackErrors(w);
w.eval(appjs);
const d=w.document,$=id=>d.getElementById(id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const typeIn=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
const chg=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
(async()=>{
 let fail=0;const ok=(l,c)=>{console.log((c?'  PASS  ':'  FAIL  ')+l);if(!c)fail++};
 await waitFor(()=>d.querySelectorAll('[data-team]').length>=3);
 console.log('\n--- BUILD A TEAM ---');
 const tb=[...d.querySelectorAll('[data-team]')].slice(0,3);
 for(const b of tb){click(b);await wait(200)}
 await waitFor(()=>$('teamCount').textContent==='3');
 w.location.hash='#/team';await waitFor(()=>$('panel').innerHTML.includes('0/4 moves'));
 ok('3 members added',$('teamCount').textContent==='3');
 ok('slots show move progress',$('panel').innerHTML.includes('0/4 moves'));
 ok('slots show level and nature',$('panel').innerHTML.includes('Lv 50'));
 ok('coverage starts approximated',$('panel').innerHTML.includes('approximated from their typing'));
 const blindBefore=($('panel').innerHTML.match(/no answer/g)||[]).length;

 console.log('\n--- LOADOUT EDITOR ---');
 click(d.querySelector('[data-edit]'));await waitFor(()=>$('modalContent').innerHTML.includes('LOADOUT'));
 ok('editor opens',$('modalContent').innerHTML.includes('LOADOUT'));
 ok('4 move slots',d.querySelectorAll('[data-moveslot]').length===4);
 ok('6 IV inputs',d.querySelectorAll('[data-iv]').length===6);
 ok('6 EV inputs',d.querySelectorAll('[data-ev]').length===6);
 ok('ability dropdown incl hidden',$('modalContent').innerHTML.includes('(hidden)'));

 // base attack 130, lv50, 31 IV, 0 EV, hardy -> floor((260+31)*50/100)=145; 145+5=150
 const rows=[...d.querySelectorAll('.ldrow:not(.ldhead)')];
 ok('neutral attack stat correct (150)',rows[1].querySelector('.ld-final').textContent==='150');
 // HP base 108 lv50 31IV -> floor((216+31)*50/100)=123; +50+10 = 183
 ok('HP stat correct (183)',rows[0].querySelector('.ld-final').textContent==='183');

 // nature change should bump attack by 10%: 145+5=150 -> *1.1 = 165
 chg(d.querySelector('[data-ld="nature"]'),'adamant');await waitFor(()=>rows[1].querySelector('.ld-final').textContent==='165');
 ok('adamant raises attack to 165',rows[1].querySelector('.ld-final').textContent==='165');
 ok('nature arrow shown',rows[1].querySelector('.ld-label i.up'));

 // EV preset
 click(d.querySelector('[data-ldspread="attack"]'));await waitFor(()=>d.querySelector('[data-ev="attack"]').value==='252');
 const rows2=[...d.querySelectorAll('.ldrow:not(.ldhead)')];
 ok('preset sets 252 Atk EV',d.querySelector('[data-ev="attack"]').value==='252');
 // 130 base, 31 IV, 252 EV(63), lv50 -> floor((260+31+63)*50/100)=177; (177+5)*1.1=200.2 -> 200
 ok('EVs raise attack to 200',rows2[1].querySelector('.ld-final').textContent==='200');
 ok('EV total displayed',$('modalContent').innerHTML.includes('508 / 510'));

 // over-limit warning
 typeIn(d.querySelector('[data-ev="defense"]'),'252');await waitFor(()=>!!d.querySelector('.evbar.over'));
 ok('EV bar flags over-limit',!!d.querySelector('.evbar.over'));

 // assign moves
 chg(d.querySelector('[data-moveslot="0"]'),'earthquake');await waitFor(()=>$('modalContent').innerHTML.includes('100 pow'));
 ok('move assigned shows type',$('modalContent').innerHTML.includes('Ground'));
 ok('move shows power',$('modalContent').innerHTML.includes('100 pow'));
 chg(d.querySelector('[data-moveslot="1"]'),'ice-beam');await waitFor(()=>$('modalContent').innerHTML.includes('Ice'));
 chg(d.querySelector('[data-moveslot="2"]'),'nasty-plot');await waitFor(()=>$('modalContent').innerHTML.includes('Dark'));
 ok('coverage line present',$('modalContent').innerHTML.includes('super effective against'));
 chg(d.querySelector('[data-ld="item"]'),'life-orb');
 click(d.querySelector('[data-ldclose]'));await waitFor(()=>$('panel').innerHTML.includes('3/4 moves'));
 ok('editor closes back to team',$('panel').innerHTML.includes('Coverage heatmap'));
 ok('slot reflects 3 moves',$('panel').innerHTML.includes('3/4 moves'));

 console.log('\n--- EXACT COVERAGE ---');
 // give the other two members moves so coverage becomes exact
 for(const idx of [1,2]){
   const edits=[...d.querySelectorAll('[data-edit]')];
   click(edits[idx]);await waitFor(()=>$('modalContent').innerHTML.includes('LOADOUT')&&!!d.querySelector('[data-moveslot="0"]'));
   chg(d.querySelector('[data-moveslot="0"]'),'surf');await waitFor(()=>$('modalContent').innerHTML.includes('90 pow'));
   click(d.querySelector('[data-ldclose]'));await waitFor(()=>$('panel').innerHTML.includes('Coverage heatmap'));
 }
 await waitFor(()=>$('panel').innerHTML.includes('Exact — calculated from the damaging moves'));
 ok('coverage now exact',$('panel').innerHTML.includes('Exact — calculated from the damaging moves'));
 const blindAfter=($('panel').innerHTML.match(/no answer/g)||[]).length;
 ok('coverage recomputed from moves',blindAfter!==blindBefore);
 // ground move must now answer electric/steel types
 ok('heatmap reflects move types',$('panel').innerHTML.includes('can hit'));

 console.log('\n--- SHOWDOWN EXPORT ---');
 click(d.querySelector('[data-showdown]'));await waitFor(()=>!!copied&&copied.includes('@ Life Orb'));
 ok('export includes held item',copied.includes('@ Life Orb'));
 ok('export includes ability',copied.includes('Ability:'));
 ok('export includes EV line',/EVs: .*Atk/.test(copied));
 ok('export includes nature',copied.includes('Adamant Nature'));
 ok('export includes level',copied.includes('Level: 50'));
 ok('export lists real moves',copied.includes('- Earthquake')&&copied.includes('- Ice Beam'));
 ok('export has no blank move slots',!/- *$/m.test(copied.replace(/\n$/,'')));

 console.log('\n--- TEAM DAMAGE CALCULATOR ---');
 w.location.hash='#/calc';await waitFor(()=>d.querySelectorAll('[data-calctab]').length===6);
 click(d.querySelector('[data-calctab="team-damage"]'));await waitFor(()=>$('panel').innerHTML.includes('ATTACKER'));
 ok('team damage tab renders',$('panel').innerHTML.includes('ATTACKER'));
 ok('attacker picker lists team',d.querySelectorAll('[data-calc="atkId"] option').length===3);
 ok('move picker lists damaging moves only',
    [...d.querySelectorAll('[data-calc="moveName"] option')].every(o=>!o.textContent.includes('Nasty Plot')));
 ok('shows real attack stat used',$('panel').innerHTML.includes('ATTACK USED'));
 ok('damage range computed',/\d+ – \d+/.test($('panel').innerHTML));
 const dmg1=d.querySelector('.result-card strong').textContent;
 // mon1 is fire, mon4 is electric; earthquake (ground) vs electric = 2x
 chg(d.querySelector('[data-calc="defId"]'),'3');await waitFor(()=>$('panel').innerHTML.includes("Mon3's"));
 ok('changing defender changes damage',d.querySelector('.result-card strong').textContent!==dmg1);
 ok('defender selection actually applied',$('panel').innerHTML.includes("Mon3's"));
 ok('effectiveness surfaced',/[0-9¼½]×/.test($('panel').innerHTML));
 const noCrit=d.querySelector('.result-card strong').textContent;
 click(d.querySelector('[data-calc="dCrit"]'));await wait(400);
 ok('critical hit raises damage',d.querySelector('.result-card strong').textContent!==noCrit);

 console.log('\n--- PERSISTENCE + REGRESSION ---');
 const saved=JSON.parse(w.localStorage.getItem('atlasdex:teams'));
 ok('loadouts persisted to storage',saved[0].members[0].moves.includes('earthquake'));
 ok('EVs persisted',saved[0].members[0].evs.attack===252);
 ok('nature persisted',saved[0].members[0].nature==='adamant');
 w.location.hash='#/';await waitFor(()=>d.querySelectorAll('.poke-card').length>0);
 ok('grid still renders',d.querySelectorAll('.poke-card').length>0);
 w.location.hash='#/moves';await waitFor(()=>d.querySelectorAll('.dexrow[data-entity]').length>0);
 ok('moves dex still works',d.querySelectorAll('.dexrow[data-entity]').length>0);
 w.location.hash='#/matchups';await waitFor(()=>!!d.querySelector('.result-card strong'));
 ok('matchups still work',d.querySelector('.result-card strong').textContent==='2×');

 finish(fail,errs);
})().catch(crash);
