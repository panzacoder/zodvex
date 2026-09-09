import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
const [backend,label,countText='128',round='0']=process.argv.slice(2);
const count=Number(countText),width=32;
if(!Number.isInteger(count)||count<1||count>256)throw Error('Invalid module count');
const metadata=JSON.parse(readFileSync(join(backend,'metadata.json'),'utf8'));
if(new URL(metadata.url).hostname!=='127.0.0.1')throw Error('Local backend only');
const key=readFileSync(join(backend,'admin-key'),'utf8').trim();
const dir=resolve('convex');mkdirSync(dir,{recursive:true});
for(const file of readdirSync(dir))if(/^model\d+\.ts$/.test(file))rmSync(join(dir,file));
const hashes={};
for(let i=0;i<count;i++){
 const source=`import {z} from 'zod';
import {queryGeneric as query} from 'convex/server';
import {v} from 'convex/values';
const schema=z.object(Object.fromEntries(Array.from({length:${width}},(_,i)=>['f'+i,z.string()])));
export const probe=query({args:{},returns:v.number(),handler:()=>{
 const value=schema.parse(Object.fromEntries(Array.from({length:${width}},(_,i)=>['f'+i,'value'])));
 if(Object.keys(value).length!==${width})throw Error('Invalid shape');
 return ${i}+${Number(round)};
}});
`;
 const name=`model${i}.ts`;writeFileSync(join(dir,name),source);hashes[name]=createHash('sha256').update(source).digest('hex');
}
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('convex/package.json')),'bin/main.js');
const env={...process.env,DO_NOT_TRACK:'1',CI:'1'};
for(const name of Object.keys(env))if(name.startsWith('CONVEX_'))delete env[name];
env.CONVEX_SELF_HOSTED_URL=metadata.url;env.CONVEX_SELF_HOSTED_ADMIN_KEY=key;
const started=Date.now();
const result=spawnSync(process.execPath,[cli,'deploy','--yes','--typecheck','disable','--codegen','disable'],{cwd:process.cwd(),env,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
const clean=text=>String(text??'').split(key).join('[REDACTED]');
const report={format:'convex-analysis-history-v1',label,count,width,round:Number(round),runtime:process.version,cli:'1.32.0',zod:'4.3.6',backend:{sourceRevision:metadata.sourceRevision,sha256:metadata.sha256,flags:metadata.flags,reuseIsolates:metadata.reuseIsolates},fixtureHashes:hashes,status:result.status,signal:result.signal,error:result.error?.code??null,elapsedMs:Date.now()-started,stdout:clean(result.stdout),stderr:clean(result.stderr)};
report.queryChecks=[];
if(result.status===0){
 const client=new ConvexHttpClient(metadata.url,{skipConvexDeploymentUrlCheck:true});
 for(const index of [0,count-1]){
  const value=await client.query(makeFunctionReference(`model${index}:probe`),{});
  const expected=index+Number(round);
  report.queryChecks.push({index,value,expected,valid:value===expected});
  if(value!==expected)throw Error('Deployed query verification failed');
 }
}
mkdirSync('results',{recursive:true});writeFileSync(`results/${label}-${count}-${round}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({label,count,round,status:report.status,signal:report.signal,error:report.error,elapsedMs:report.elapsedMs,queryChecks:report.queryChecks,stdout:report.stdout,stderr:report.stderr}));
