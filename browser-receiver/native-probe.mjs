import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./extension/manifest.json',import.meta.url)));
const {createHash}=await import('node:crypto');
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
if(process.argv[2]!==`chrome-extension://${extensionId}/`)process.exit(2);
let input=Buffer.alloc(0);
function reply(x){const b=Buffer.from(JSON.stringify(x)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([h,b]));}
process.stdin.on('data',b=>{input=Buffer.concat([input,b]);while(input.length>=4){let n=input.readUInt32LE(0);if(n>200000)process.exit(3);if(input.length<n+4)return;let d=JSON.parse(input.subarray(4,4+n));input=input.subarray(4+n);
 if(d.version!==1||d.kind!=='observation'||d.url!=='https://chatgpt.com/local/01a1188b-a850-755b-91ec-717f6182900a')process.exit(4);
 writeFileSync(join(homedir(),'.agentic-wear','browser-diagnostic.json'),JSON.stringify(d,null,2),{mode:0o600});reply({status:'inspecting'});
}});
process.stdin.on('end',()=>process.exit(0));
