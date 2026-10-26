const fs=require('fs');const path=require('path');
const src=fs.readFileSync(path.resolve(__dirname,'..','app.js'),'utf8');
const grab=(s,e)=>src.slice(src.indexOf(s), src.indexOf(e));
eval(grab('const NATURES =','const BALLS').replace('const','var'));
eval(grab('function natureMod','/* Gen 5+ damage'));
eval(grab('function damageRange','/* Gen 5+ capture'));
eval(src.slice(src.indexOf('function catchChance'), src.indexOf('return Math.pow(b / 65536, 4);')+32));
let fail=0;const t=(l,g,w)=>{const ok=Math.abs(g-w)<1e-6;console.log((ok?'  PASS  ':'  FAIL  ')+l+(ok?'':` got ${g} want ${w}`));if(!ok)fail++};

// --- natures: all 25 present, exactly 5 neutral, boosts/drops never equal
const names=Object.keys(NATURES);
t('25 natures defined',names.length,25);
t('5 neutral natures',names.filter(n=>!NATURES[n][0]).length,5);
let bad=0;for(const n of names){const[u,d]=NATURES[n];if(u&&u===d)bad++}
t('no nature boosts and drops the same stat',bad,0);
t('adamant raises attack',natureMod('adamant','attack'),1.1);
t('adamant lowers sp.atk',natureMod('adamant','special-attack'),0.9);
t('adamant neutral on speed',natureMod('adamant','speed'),1);
t('hardy is fully neutral',natureMod('hardy','attack'),1);

// --- stat formula: canonical Garchomp lv100 example (base 108 atk, 31 IV, 252 EV, Adamant)
// floor((2*108+31+63)*100/100)=310; (310+5)*1.1 = 346.5 -> 346
t('Garchomp Attack lv100 adamant 31/252',realStat(108,31,252,100,'attack','adamant'),346);
// HP: base 108, 31 IV, 0 EV, lv100 -> floor((216+31+0)*100/100)+100+10 = 247+110 = 357
t('Garchomp HP lv100 31/0',realStat(108,31,0,100,'hp','hardy'),357);
// Shedinja always 1 HP
t('Shedinja HP is always 1',realStat(1,31,252,100,'hp','hardy'),1);
// lv50 neutral, base 100, 31 IV, 0 EV -> floor((200+31)*50/100)=115; 115+5=120
t('lv50 neutral base100 31/0',realStat(100,31,0,50,'attack','hardy'),120);

// --- damage: known reference. L50, power 80, atk 120, def 100
// floor(floor(floor(2*50/5+2)*80*120/100)/50)+2 = floor(floor(22*96)/50)+2 = floor(2112/50)+2=42+2=44
let r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:1,crit:false,burn:false});
t('base damage max roll',r.max,44);
t('base damage min roll (85%)',r.min,Math.floor(44*0.85));
r=damageRange({level:50,power:80,atk:120,def:100,stab:true,typeMult:1,crit:false,burn:false});
t('STAB multiplies by 1.5',r.max,Math.floor(44*1.5));
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:2,crit:false,burn:false});
t('2x type doubles damage',r.max,88);
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:0,crit:false,burn:false});
t('immune deals 0',r.max,0);
r=damageRange({level:50,power:0,atk:120,def:100,stab:false,typeMult:1,crit:false,burn:false});
t('status move deals 0',r.max,0);
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:1,crit:false,burn:true});
t('burn halves physical',r.max,22);

// --- catch rate
t('Master Ball always catches',catchChance(100,100,3,255,1),1);
const full=catchChance(100,100,45,1,1), low=catchChance(100,1,45,1,1);
console.log((low>full?'  PASS  ':'  FAIL  ')+'low HP improves catch chance');if(!(low>full))fail++;
const slept=catchChance(100,1,45,1,2.5);
console.log((slept>low?'  PASS  ':'  FAIL  ')+'sleep improves catch chance');if(!(slept>low))fail++;
const ultra=catchChance(100,1,45,2,1);
console.log((ultra>low?'  PASS  ':'  FAIL  ')+'Ultra Ball beats Poke Ball');if(!(ultra>low))fail++;
const inRange=[full,low,slept,ultra].every(p=>p>=0&&p<=1);
console.log((inRange?'  PASS  ':'  FAIL  ')+'all probabilities within 0..1');if(!inRange)fail++;
// a rare legendary at full HP with a Poke Ball should be grim
console.log((catchChance(100,100,3,1,1)<0.05?'  PASS  ':'  FAIL  ')+'rate-3 legendary is very hard');if(!(catchChance(100,100,3,1,1)<0.05))fail++;

console.log(fail?`\n${fail} FAILURES`:'\nAll battle-math tests passed');
process.exit(fail?1:0);
