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
});
