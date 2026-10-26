const fs=require('fs');const path=require('path');
const src=fs.readFileSync(path.resolve(__dirname,'..','app.js'),'utf8');
// pull the real declarations out of the app so we test shipped data
const grab=n=>src.match(new RegExp('const '+n+' = [\\s\\S]*?\\n\\};'))[0];
eval(grab('TYPES').replace('const','var'));
eval(grab('CHART').replace('const','var'));
eval(grab('COLORS').replace('const','var'));
function eff(a,ds){let m=1;const r=CHART[a]||{};for(const d of ds)m*=(d in r)?r[d]:1;return m}

let fail=0;
const t=(label,got,want)=>{const ok=got===want;console.log((ok?'  PASS  ':'  FAIL  ')+label+(ok?'':` got ${got} want ${want}`));if(!ok)fail++};

// every type has a row, every key is a real type, every multiplier is legal, every type has a colour
const problems=[];
if(!Array.isArray(TYPES)||TYPES.length!==18||new Set(TYPES).size!==18) problems.push('TYPES is not 18 distinct types');
for(const a of TYPES){
  if(!CHART[a]){problems.push('missing chart row for '+a);continue}
  for(const [d,m] of Object.entries(CHART[a])){
    if(!TYPES.includes(d)) problems.push(`bad key ${a} -> ${d}`);
    if(![0,0.5,2].includes(m)) problems.push(`bad multiplier ${a} -> ${d} = ${m}`);
  }
  if(!COLORS[a]) problems.push('missing colour for '+a);
  else if(!/^#[0-9a-f]{6}$/i.test(COLORS[a])) problems.push(`bad colour for ${a}: ${COLORS[a]}`);
}
for(const k of Object.keys(CHART)) if(!TYPES.includes(k)) problems.push('chart row for unknown type '+k);
problems.forEach(p=>console.log('  FAIL  '+p));
const structOk=problems.length===0;
console.log((structOk?'  PASS  ':'  FAIL  ')+'every type has a chart row, valid keys and multipliers, and a colour');
if(!structOk) fail+=problems.length;

// known single-type matchups
t('fire->grass',eff('fire',['grass']),2);
t('water->fire',eff('water',['fire']),2);
t('electric->ground',eff('electric',['ground']),0);
t('normal->ghost',eff('normal',['ghost']),0);
t('ghost->normal',eff('ghost',['normal']),0);
t('dragon->fairy',eff('dragon',['fairy']),0);
t('poison->steel',eff('poison',['steel']),0);
t('fighting->ghost',eff('fighting',['ghost']),0);
t('psychic->dark',eff('psychic',['dark']),0);

// classic dual-type cases
t('rock->Charizard(fire/flying)',eff('rock',['fire','flying']),4);
t('ice->Dragonite(dragon/flying)',eff('ice',['dragon','flying']),4);
t('electric->Gyarados(water/flying)',eff('electric',['water','flying']),4);
t('ground->Magnezone(electric/steel)',eff('ground',['electric','steel']),4);
t('fighting->Tyranitar(rock/dark)',eff('fighting',['rock','dark']),4);
t('grass->Swampert(water/ground)',eff('grass',['water','ground']),4);
t('fighting->Sableye(dark/ghost)',eff('fighting',['dark','ghost']),0);
t('ground->Skarmory(steel/flying)',eff('ground',['steel','flying']),0);
t('normal->Aggron(steel/rock)',eff('normal',['steel','rock']),0.25);
t('bug->Scizor(bug/steel)',eff('bug',['bug','steel']),0.5);
t('fire->Scizor(bug/steel)',eff('fire',['bug','steel']),4);

// chart symmetry sanity: Steel resists a lot
const steelResists=TYPES.filter(a=>eff(a,['steel'])<1).length;
t('steel resists at least 9 types',steelResists>=9,true);

console.log(fail?`\n${fail} FAILURES`:'\nAll type-chart tests passed ('+TYPES.length+' types verified)');
process.exit(fail?1:0);
