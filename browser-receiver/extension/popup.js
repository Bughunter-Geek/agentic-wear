'use strict';
const status = document.getElementById('status');
const report = text => { status.textContent = text; };
const DOT = 'https://chatgpt.com/dots/home';
async function selectionStatus() {
  try {
    const value = await chrome.storage.local.get('dotSelection');
    report(value.dotSelection ? 'A Dot is selected locally.' : 'No Dot selected. Dot access is disabled.');
  } catch { report('Local selection is unavailable. Dot access is disabled.'); }
}
document.getElementById('connect').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.url !== DOT) { report('Open your Dot page in the selected tab first.'); return; }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: () => {
        if (location.href !== 'https://chatgpt.com/dots/home') return null;
        if ([...document.querySelectorAll('button')].some(b =>
          (b.getAttribute('aria-label') || b.textContent.trim()) === 'Hang up')) return null;
        const rows = [...document.querySelectorAll('main article.message-row[data-message-id]')];
        if (!rows.length) return null;
        const match = /^([a-f0-9]{32})~\1~CalpicoMessage~/.exec(rows[0].dataset.messageId);
        if (!match || !rows.every(row => row.dataset.messageId.startsWith(`${match[1]}~${match[1]}~CalpicoMessage~`))) return null;
        const profiles = [...document.querySelectorAll('[data-orbit-profile-trigger=true]')];
        if (profiles.length !== 1) return null;
        const profileLabel = (profiles[0].getAttribute('aria-label') || '').replace(/^(Open|Close) /, '');
        if (profileLabel.length > 200 || !/.+[’']s profile$/.test(profileLabel)) return null;
        return { namespace: match[1], profileLabel };
      },
    });
    if (!result?.result) { report('Could not verify one idle Dot. End any call and open your Dot conversation first.'); return; }
    await chrome.storage.local.set({ dotSelection: result.result });
    report('Dot selected locally. The companion must match this selection.');
  } catch { report('Selection failed. Existing local configuration was kept.'); }
});
document.getElementById('disconnect').addEventListener('click', async () => {
  try { await chrome.storage.local.remove('dotSelection'); report('Dot disconnected. Dot access is disabled.'); }
  catch { report('Could not clear the local selection.'); }
});
void selectionStatus();
