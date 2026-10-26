const fs=require('fs');const path=require('path');
const src=fs.readFileSync(path.resolve(__dirname,'..','app.js'),'utf8');
const grab=(s,e)=>src.slice(src.indexOf(s), src.indexOf(e));
eval(grab('const NATURES =','const BALLS').replace('const','var'));
eval(grab('function natureMod','/* The games round a modifier'));
eval(grab('const pokeRound','/* Gen 5+ capture').replace('const','var'));
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


// --- damage rounding order (Gen 6+). Each step floors/rounds where the games do.
// Bulbapedia's example: L75, power 65, Atk 123 vs Def 163, STAB, 4x effective, no crit/burn.
//   base = floor(floor(floor(2*75/5+2) * 65 * 123 / 163) / 50) + 2
//        = floor(floor(32*65*123/163)/50)+2 = floor(1569/50)+2 = 31+2 = 33
//   min roll 85: floor(33*85/100)=28; STAB pokeRound(28*1.5)=42; 4x = two doublings = 168
//   max roll 100: 33; STAB 49.5 rounds half DOWN to 49; 4x = 196
// Multiplying everything and flooring once gives 33*1.5*4=198 at max (the old, wrong answer).
r=damageRange({level:75,power:65,atk:123,def:163,stab:true,typeMult:4,crit:false,burn:false});
t('Bulbapedia vector: minimum roll',r.min,168);
t('Bulbapedia vector: maximum roll',r.max,196);
t('damageRange returns 16 rolls',r.rolls.length,16);
t('first roll is the minimum',r.rolls[0],r.min);
t('last roll is the maximum',r.rolls[15],r.max);
t('rolls never decrease',r.rolls.every((v,i)=>i===0||v>=r.rolls[i-1])?1:0,1);
t('pokeRound rounds .5 down (3 * 1.5 -> 4)',pokeRound(3,6144),4);
t('pokeRound rounds .5 down (5 * 0.5 -> 2)',pokeRound(5,2048),2);
t('pokeRound rounds above .5 up (3 * 0.855 -> 3)',pokeRound(3,3500),3);
// critical: pokeRound(44*1.5)=66 at max; min roll floor(66*85/100)=56
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:1,crit:true,burn:false});
t('critical hit max',r.max,66);
t('critical hit min',r.min,56);
// resisted: floor(44/2)=22, min floor(37/2)=18; quarter: floor(22/2)=11, min floor(18/2)=9
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:0.5,crit:false,burn:false});
t('0.5x max floors once',r.max,22);t('0.5x min',r.min,18);
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:0.25,crit:false,burn:false});
t('0.25x max floors twice',r.max,11);t('0.25x min',r.min,9);
// STAB then burn: 66 -> pokeRound(66*0.5)=33
r=damageRange({level:50,power:80,atk:120,def:100,stab:true,typeMult:1,crit:false,burn:true});
t('STAB then burn',r.max,33);
// other modifier 1.3 -> round(1.3*4096)=5325; pokeRound(44*5325/4096) = floor((44*5325+2047)/4096) = 57
r=damageRange({level:50,power:80,atk:120,def:100,stab:false,typeMult:1,crit:false,burn:false,other:1.3});
t('other modifier applied through pokeRound',r.max,57);
// a hit that is not immune deals at least 1: base 2, 0.25x -> floor(floor(2/2)/2)=0 -> 1
r=damageRange({level:1,power:1,atk:1,def:999,stab:false,typeMult:0.25,crit:false,burn:false});
t('non-immune damage is at least 1 (min)',r.min,1);t('non-immune damage is at least 1 (max)',r.max,1);
r=damageRange({level:50,power:80,atk:120,def:100,stab:true,typeMult:0,crit:true,burn:false});
t('immune: every roll is 0',r.rolls.every(v=>v===0)&&r.rolls.length===16?1:0,1);

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
