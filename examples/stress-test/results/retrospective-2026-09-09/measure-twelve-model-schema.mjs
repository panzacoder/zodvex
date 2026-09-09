import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [input,backend,out,label]=process.argv.slice(2);
const schema=resolve(input);
const require=createRequire(schema);
const esbuild=createRequire(require.resolve('convex/package.json'))('esbuild');
const metadata=JSON.parse(readFileSync(join(backend,'metadata.json'),'utf8'));
if(new URL(metadata.url).hostname!=='127.0.0.1'||metadata.reuseIsolates!==false)throw Error('Dedicated local backend required');
const key=readFileSync(join(backend,'admin-key'),'utf8').trim();
const log=join(backend,'backend-pty.log');
mkdirSync(out,{recursive:true,mode:0o700});
const rows=[];
for(let run=0;run<3;run++)for(const control of [true,false]){
 const nonce=randomUUID();
 const source=`import {query} from 'convex:/_system/repl/wrappers.js';
 import {v} from 'convex/values';
 ${control?'':`import schema from ${JSON.stringify(schema)};`}
 export default query({args:{},returns:v.any(),handler:()=>{
 if(typeof globalThis.gc!=='function')throw Error('GC unavailable');
 globalThis.gc();globalThis.gc();
 ${control?'const tables=0;':`const map=schema.__zodTableMap;
 const tables=Object.keys(map).length;
 if(!tables||Object.values(map).some(value=>!value.doc||!value.insert))throw Error('Lost schema graph');`}
 return {tables,nonce:${JSON.stringify(nonce)}};
 }});`;
 const built=await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts',sourcefile:'private-schema-probe.ts'},bundle:true,platform:'browser',format:'esm',target:'esnext',external:['convex:/_system/repl/wrappers.js'],conditions:['convex','module'],treeShaking:true,minifySyntax:true,minifyIdentifiers:true,keepNames:true,define:{'process.env.NODE_ENV':'"production"'},write:false,metafile:true,logLevel:'silent'});
 const bundle=built.outputFiles[0].text;
 writeFileSync(join(out,nonce+'.js'),bundle,{mode:0o600});
 const offset=readFileSync(log).length;
 const response=await fetch(metadata.url+'/api/run_test_function',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminKey:key,args:{},bundle:{path:'testQuery.js',source:bundle},format:'convex_encoded_json'}),signal:AbortSignal.timeout(20000)});
 const raw=await response.json();
 let records=[],excerpt='',lastLength=-1,quiet=0;
 const deadline=Date.now()+1000;
 do{
  await new Promise(resolve=>setTimeout(resolve,30));
  excerpt=readFileSync(log).subarray(offset).toString();
  quiet=excerpt.length===lastLength?quiet+1:0;lastLength=excerpt.length;
  records=excerpt.split('\n').flatMap(line=>{const at=line.indexOf('GC: {');if(at<0)return[];try{const gc=JSON.parse(line.slice(at+4).trim());return gc.reason==='testing'?[{identity:line.slice(0,at).match(/^\[[^\]]+\]/)?.[0],...gc}]:[];}catch{return[];}});
 }while((records.length<2||quiet<3)&&Date.now()<deadline);
 const valid=response.ok&&raw.status==='success'&&raw.value?.nonce===nonce&&raw.value.tables===(control?0:12)&&records.length>=2&&quiet>=3&&records.every(r=>r.identity&&r.gc==='mc'&&Number.isFinite(r.end_object_size)&&r.end_object_size>0)&&new Set(records.map(r=>r.identity)).size===1;
 writeFileSync(join(out,nonce+'.log'),excerpt,{mode:0o600});
 const row={label,run,control,nonce,valid,raw,gc:records,retainedBytes:valid?records.at(-1).end_object_size:null,bundleBytes:Buffer.byteLength(bundle),bundleSha256:createHash('sha256').update(bundle).digest('hex')};
 rows.push(row);writeFileSync(join(out,label+'.json'),JSON.stringify({format:'private-schema-retained-v1',metadata,scope:'Local Convex retained V8 bytes for schema-only import; excludes endpoint registry, external and peak memory',rows},null,2),{mode:0o600});
 console.log(JSON.stringify({label,run,control,valid,retainedBytes:row.retainedBytes}));
 if(!valid)throw Error('Invalid local schema measurement');
}
