import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { deriveCredential, sha256Base64Url, sha256Hex } from "../src/crypto";
import { privateApkDigest, MAX_PRIVATE_APK_BYTES } from "../src/private-update";
async function pair() {
 const id=await sha256Base64Url(crypto.randomUUID());
 const bridge=await deriveCredential("test-credential-secret-that-is-long-enough","bridge",id);
 const watch=await deriveCredential("test-credential-secret-that-is-long-enough","watch",id);
 const relay=env.PAIR_RELAY.getByName(id);
 await relay.initializePair({pairId:id,bridgePublicKey:"A".repeat(44),bridgeAuthHash:await sha256Hex(bridge),watchAuthHash:await sha256Hex(watch),expiresAt:Date.now()+60000});
 await relay.beginPairing({pairId:id,watchPublicKey:"B".repeat(44),fcmInstallationId:null,now:Date.now()});
 await relay.confirmWatch(watch,"C".repeat(43),Date.now());
 await relay.confirmBridge(bridge,{watchPublicKey:"B".repeat(44),watchProof:"C".repeat(43),bridgeProof:"D".repeat(43),now:Date.now()});
 const bytes=new Uint8Array(1024*1024+10).fill(42).buffer;
 const manifest={versionCode:55,versionName:"0.6.29-private-alpha",sha256:await privateApkDigest(bytes),apkSize:bytes.byteLength,expiresAt:Date.now()+60000};
 return {id,bridge,watch,relay,bytes,manifest};
}
async function upload(p: Awaited<ReturnType<typeof pair>>, credential=p.bridge, manifest=p.manifest) {
 return exports.default.fetch(`https://relay.test/v1/pairs/${p.id}/private-update`,{method:"PUT",headers:{Authorization:`Bearer ${credential}`,"X-Update-Version-Code":String(manifest.versionCode),"X-Update-Version-Name":manifest.versionName,"X-Update-Sha256":manifest.sha256,"X-Update-Expires-At":String(manifest.expiresAt)},body:p.bytes});
}
describe("private paired OTA",()=>{
 it("serves manifest and exact bytes only to the paired watch",async()=>{
  const p=await pair();await p.relay.publishPrivateUpdate(p.bridge,p.manifest,p.bytes);
  const path=`https://relay.test/v1/pairs/${p.id}/private-update`;
  expect((await exports.default.fetch(path+"/manifest")).status).toBe(401);
  expect((await exports.default.fetch(path+"/manifest",{headers:{Authorization:`Bearer ${p.bridge}`}})).status).toBe(401);
  const response=await exports.default.fetch(path+"/manifest",{headers:{Authorization:`Bearer ${p.watch}`}});
  expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await p.relay.privateUpdateApk(p.watch,p.manifest.sha256)).toEqual(p.bytes);
  expect(await p.relay.privateUpdateApk(p.watch,"0".repeat(64))).toBeNull();
 });
 it("refuses other pairs and watch-side publishing or revocation",async()=>{
  const p=await pair(), other=await pair();
  expect((await upload(p,other.bridge)).status).toBe(401);
  expect((await upload(p,p.watch)).status).toBe(401);
  await p.relay.publishPrivateUpdate(p.bridge,p.manifest,p.bytes);
  expect((await exports.default.fetch(`https://relay.test/v1/pairs/${p.id}/private-update/manifest`,{headers:{Authorization:`Bearer ${other.watch}`}})).status).toBe(401);
  expect((await exports.default.fetch(`https://relay.test/v1/pairs/${p.id}/private-update`,{method:"DELETE",headers:{Authorization:`Bearer ${p.watch}`}})).status).toBe(401);
 });
 it("rejects digest/size mismatch and non-increasing versions",async()=>{
  const p=await pair();expect((await upload(p,p.bridge,{...p.manifest,sha256:"0".repeat(64)})).status).toBe(400);
  expect((await upload(p,p.bridge,{...p.manifest,expiresAt:Date.now()+73*60*60*1000})).status).toBe(400);
  await p.relay.publishPrivateUpdate(p.bridge,p.manifest,p.bytes);
  expect((await upload(p)).status).toBe(409);
 });
 it("expires access and revokes both manifest and payload without changing pairing",async()=>{
  const p=await pair();await p.relay.publishPrivateUpdate(p.bridge,p.manifest,p.bytes);
  await runInDurableObject(p.relay,async (_,state)=>{await state.storage.put("private-update:manifest",{...p.manifest,expiresAt:Date.now()-1});});
  expect(await p.relay.privateUpdateManifest(p.watch)).toBeNull();
  expect(await p.relay.privateUpdateApk(p.watch,p.manifest.sha256)).toBeNull();
  await p.relay.revokePrivateUpdate(p.bridge);
  expect(await p.relay.privateUpdateManifest(p.watch)).toBeNull();
  expect((await p.relay.watchPairingStatus(p.watch)).paired).toBe(true);
 });
 it("accepts the authenticated upload route and rejects oversized bodies before storage",async()=>{
  const p=await pair();const url=`https://relay.test/v1/pairs/${p.id}/private-update`;
  const headers={Authorization:`Bearer ${p.bridge}`,"X-Update-Version-Code":"55","X-Update-Version-Name":p.manifest.versionName,"X-Update-Sha256":p.manifest.sha256,"X-Update-Expires-At":String(p.manifest.expiresAt)};
  expect((await exports.default.fetch(url,{method:"PUT",headers,body:p.bytes})).status).toBe(201);
  expect((await exports.default.fetch(url,{method:"PUT",headers:{...headers,"Content-Length":String(MAX_PRIVATE_APK_BYTES+1)},body:new Uint8Array(1)})).status).toBe(413);
  expect((await exports.default.fetch(url,{method:"DELETE",headers})).status).toBe(204);
 });
 it("stores 9 to 16 MiB updates in batched puts, replaces the previous one fully and keeps the cap",async()=>{
  const p=await pair();
  const make=async(size:number,code:number)=>{const bytes=new Uint8Array(size);for(let i=0;i<size;i+=4099)bytes[i]=(i/4099+code)&255;const buf=bytes.buffer;
   return {bytes:buf,manifest:{...p.manifest,versionCode:code,apkSize:size,sha256:await privateApkDigest(buf)}};};
  const big=await make(MAX_PRIVATE_APK_BYTES,60);
  expect(MAX_PRIVATE_APK_BYTES).toBe(16*1024*1024);
  const puts:number[]=[];
  await p.relay.publishPrivateUpdate(p.bridge,big.manifest,big.bytes);
  expect(await p.relay.privateUpdateApk(p.watch,big.manifest.sha256)).toEqual(big.bytes);
  const mid=await make(9*1024*1024+5,61);
  await p.relay.publishPrivateUpdate(p.bridge,mid.manifest,mid.bytes);
  expect(await p.relay.privateUpdateApk(p.watch,mid.manifest.sha256)).toEqual(mid.bytes);
  const small=await make(2*1024*1024,62);
  await p.relay.publishPrivateUpdate(p.bridge,small.manifest,small.bytes);
  await runInDurableObject(p.relay,async (_,state)=>{
   const keys=[...(await state.storage.list({prefix:"private-update:chunk:"})).keys()];
   puts.push(keys.length);
  });
  expect(puts).toEqual([2]); // chunks of the larger earlier updates are gone
  expect(await p.relay.privateUpdateApk(p.watch,small.manifest.sha256)).toEqual(small.bytes);
  // A rejected (non-increasing) 16 MiB upload leaves the current update untouched.
  expect(await p.relay.publishPrivateUpdate(p.bridge,{...big.manifest,versionCode:62},big.bytes).then(()=>'ok',()=>'rejected')).toBe('rejected');
  expect(await p.relay.privateUpdateApk(p.watch,small.manifest.sha256)).toEqual(small.bytes);
  // One byte over the cap is refused by the schema and by the upload route.
  expect(await p.relay.publishPrivateUpdate(p.bridge,{...big.manifest,versionCode:70,apkSize:MAX_PRIVATE_APK_BYTES+1},new ArrayBuffer(MAX_PRIVATE_APK_BYTES+1)).then(()=>'ok',()=>'rejected')).toBe('rejected');
  const url=`https://relay.test/v1/pairs/${p.id}/private-update`;
  const over=await exports.default.fetch(url,{method:"PUT",headers:{Authorization:`Bearer ${p.bridge}`,"X-Update-Version-Code":"80","X-Update-Version-Name":"v","X-Update-Sha256":"0".repeat(64),"X-Update-Expires-At":String(Date.now()+60000)},body:new Uint8Array(MAX_PRIVATE_APK_BYTES+1)});
  expect(over.status).toBe(413);
 },60000);
 it("writes each storage put with at most four 1 MiB chunks inside one transaction",async()=>{
  const p=await pair();const size=11*1024*1024;const bytes=new Uint8Array(size).fill(7).buffer;
  const manifest={...p.manifest,versionCode:90,apkSize:size,sha256:await privateApkDigest(bytes)};
  const sizes:number[]=[];
  await runInDurableObject(p.relay,async (instance,state)=>{
   const original=state.storage.transaction.bind(state.storage);
   (state.storage as unknown as {transaction:unknown}).transaction=(f:(tx:Record<string,unknown>)=>Promise<unknown>)=>original(async tx=>{
    const put=(tx as {put:(...a:unknown[])=>Promise<void>}).put.bind(tx);
    (tx as {put:unknown}).put=(a:unknown,...r:unknown[])=>{if(a&&typeof a==="object"&&!(a instanceof ArrayBuffer))sizes.push(Object.keys(a).filter(k=>k.startsWith("private-update:chunk:")).length);return put(a,...r);};
    return f(tx as unknown as Record<string,unknown>);
   });
   await (instance as unknown as {publishPrivateUpdate:(c:string,m:unknown,b:ArrayBuffer)=>Promise<void>}).publishPrivateUpdate(p.bridge,manifest,bytes);
  });
  expect(sizes.filter(n=>n>0)).toEqual([4,4,3]);
  expect(await p.relay.privateUpdateApk(p.watch,manifest.sha256)).toEqual(bytes);
 },60000);
});
