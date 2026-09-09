import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const versions=['4.3.6','4.4.3','4.5.4'];
const orders=[versions,[...versions].reverse(),['4.4.3','4.5.4','4.3.6']];
const cells=orders.flatMap((order,i)=>order.flatMap(version=>(i===1?['off','on']:['on','off']).map(helpers=>[version,helpers,i+1])));
writeFileSync('run-plan.json', JSON.stringify({count:16,width:32,profile:'codec-rich',entries:0,cells,order:'Three independently collected rounds. Version order reverses in round two, then rotates in round three; helper order reverses in round two. Each collection uses eight fresh isolates. Earlier two-version study remains preserved separately.'},null,2));
for (const [version,helpers,round] of cells) {
 console.log('CELL',version,helpers,round);
 const result=spawnSync(process.execPath,['memory/local.mjs','/private/tmp/zodvex-retro-backend-20260909','16','32','codec-rich'],{env:{...process.env,ZOD_RETRO_VERSION:version,ZOD_RETRO_HELPERS:helpers,ZOD_RETRO_ROUND:String(round)},encoding:'utf8'});
 appendFileSync('collection-output.log',JSON.stringify({version,helpers,round,exitCode:result.status})+'\n'+result.stdout+result.stderr);
 console.log(result.stdout);
 if(result.status!==0) throw new Error(result.stderr);
}
