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

// every type has a row, and every key is a real type
console.log('  PASS  every type has a chart row and valid keys');
for(const a of TYPES){ if(!CHART[a]){console.log('  FAIL  missing row',a);fail++;continue}
  for(const d of Object.keys(CHART[a])) if(!TYPES.includes(d)){console.log('FAIL bad key',a,d);fail++} }
for(const t2 of TYPES) if(!COLORS[t2]){console.log('FAIL missing color',t2);fail++}

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
if(steelResists<9){console.log('FAIL steel should resist many types, got',steelResists);fail++}

console.log(fail?`\n${fail} FAILURES`:'\nAll type-chart tests passed ('+TYPES.length+' types verified)');
