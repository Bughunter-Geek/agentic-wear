import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const content = readFileSync(new URL('../../browser-receiver/extension/content.js', import.meta.url), 'utf8');
const popup = readFileSync(new URL('../../browser-receiver/extension/popup.js', import.meta.url), 'utf8');
const url = 'https://chatgpt.com/dots/home', namespace = '1'.repeat(32);
const selection = { namespace, profileLabel: 'Fixture’s profile' };
const row = ns => `<article class="message-row" data-message-id="${ns}~${ns}~CalpicoMessage~Sentinel_${'a'.repeat(32)}"><div class="message-body">Private reply<button data-action="reply">Reply</button></div></article>`;
const body = `<main><button data-orbit-profile-trigger="true" aria-label="Open Fixture’s profile"></button>${row(namespace)}<div class="ProseMirror" contenteditable="true" aria-label="Message"></div></main>`;
const flush = () => new Promise(resolve => setImmediate(resolve));
async function observe(saved) {
  const dom = new JSDOM(body, { url, runScripts: 'outside-only' }), seen = [];
  let changed;
  dom.window.chrome = {
    runtime: { id: 'fixture', sendMessage: value => { seen.push(JSON.parse(JSON.stringify(value))); return Promise.resolve(); } },
    storage: { local: { get: async () => ({ dotSelection: saved }) }, onChanged: { addListener: fn => { changed = fn; }, removeListener() {} } },
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  dom.window.eval(content); await flush();
  return { dom, seen, change: value => changed({ dotSelection: { newValue: value } }, 'local') };
}
test('unset, malformed and foreign Dot selections expose no history or input', async () => {
  for (const saved of [undefined, { namespace: 'invalid', profileLabel: selection.profileLabel }, { ...selection, namespace: '2'.repeat(32) }]) {
    const f = await observe(saved);
    try { assert.equal(f.seen.at(-1).blocked, true); assert.equal(f.seen.at(-1).inputReady, false); assert.deepEqual(f.seen.at(-1).turns, []); assert.equal(f.seen.at(-1).nativeVoice, false); }
    finally { f.dom.window.close(); }
  }
});
test('explicit matching selection enables history and removing it fails closed', async () => {
  const f = await observe(selection);
  try {
    assert.equal(f.seen.at(-1).blocked, false); assert.equal(f.seen.at(-1).turns.length, 1);
    f.change(undefined); await flush();
    assert.equal(f.seen.at(-1).blocked, true); assert.deepEqual(f.seen.at(-1).turns, []);
    assert.equal(f.seen.at(-1).identity, undefined);
  } finally { f.dom.window.close(); }
});
async function choose(pageBody = body, href = url) {
  const page = new JSDOM(pageBody, { url: href, runScripts: 'outside-only' });
  const dom = new JSDOM('<button id="connect"></button><button id="disconnect"></button><p id="status"></p>', { runScripts: 'outside-only' });
  const writes = []; let saved;
  dom.window.chrome = {
    tabs: { query: async () => [{ id: 1, url: href }] },
    scripting: { executeScript: async ({ func }) => [{ result: page.window.eval(`(${func.toString()})()`) }] },
    storage: { local: { get: async () => ({ dotSelection: saved }), set: async value => { saved = value.dotSelection; writes.push(value); }, remove: async () => { saved = undefined; } } },
  };
  dom.window.eval(popup); await flush();
  assert.equal(writes.length, 0, 'opening the popup must never select an account');
  dom.window.document.getElementById('connect').click(); await flush();
  return { dom, page, writes, saved: () => saved };
}
test('user selection stores only the current verified Dot locally', async () => {
  const f = await choose();
  try {
    assert.equal(f.writes.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(f.saved())), selection);
    assert.equal(f.dom.window.document.body.textContent.includes(namespace), false);
    f.dom.window.document.getElementById('disconnect').click(); await flush(); assert.equal(f.saved(), undefined);
  } finally { f.dom.window.close(); f.page.window.close(); }
});
test('selection refuses an active call, mixed accounts and another page without changing configuration', async () => {
  for (const [html, href] of [[body + '<button aria-label="Hang up"></button>', url], [body.replace('</main>', row('2'.repeat(32)) + '</main>'), url], [body, 'https://chatgpt.com/local/00000000-0000-4000-8000-000000000001']]) {
    const f = await choose(html, href);
    try { assert.equal(f.writes.length, 0); }
    finally { f.dom.window.close(); f.page.window.close(); }
  }
});

test('disconnect/reconnect accepts the generic toolbar plus one named Dot profile', async () => {
  const f = await choose(body.replace('<main>', '<main><button data-orbit-profile-trigger="true" aria-label="Toggle profile"></button>'));
  try {
    assert.equal(f.writes.length, 1);
    f.dom.window.document.getElementById('disconnect').click(); await flush();
    assert.equal(f.saved(), undefined);
    f.dom.window.document.getElementById('connect').click(); await flush();
    assert.equal(f.writes.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(f.saved())), selection);
  } finally { f.dom.window.close(); f.page.window.close(); }
});
test('generic toolbar does not authorize missing or ambiguous named profiles', async () => {
  for (const html of [body.replace('Open Fixture’s profile', 'Toggle profile'), body.replace('</main>', '<button data-orbit-profile-trigger="true" aria-label="Open Foreign’s profile"></button></main>')]) {
    const f = await choose(html);
    try { assert.equal(f.writes.length, 0); }
    finally { f.dom.window.close(); f.page.window.close(); }
  }
});
