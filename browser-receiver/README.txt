Agentic Cloud Receiver 0.3.5.1 — privacy correction

Use your own signed-in Chrome browser, compatible local Agentic Wear bridge,
and paired Watch. The extension alone does not install a bridge. Keep the
computer awake and online and the supported ChatGPT page available.

No account, Dot namespace, conversation ID, credential or personal target is
included in this distribution. Load extension/ through Chrome's Load unpacked.
To enable Dot, open your own Dot page, open the receiver's extension popup and
choose Connect this Dot. Selection is stored only in this browser's extension
local storage. Unset, malformed or mismatched selection blocks Dot history,
text sending and voice. Cloud chat handling is otherwise unchanged.

Your companion's existing private target configuration must refer to the same
Dot namespace. Keep it outside the repository and distribution. Do not upload
it. Disconnect Dot in the popup to remove the extension-local selection.

Install or reload only when you have ended any active call. Existing pairings,
signing identities, credentials and updater configuration are unchanged.

See LICENSE and THIRD-PARTY-NOTICES.txt for redistribution notices.

Source maintainers: this privacy correction applies to v0.6.30-alpha (Watch
build 111). Merge or cherry-pick the privacy branch into the source used for
the next release before tagging. Existing tags and their source archives still
contain the old defaults; this correction does not rewrite that history.

Before packaging, run npm --prefix bridge run check:receiver-package. The
guard checks both committed HEAD and the candidate extension, so uncommitted
fixes alone cannot pass. Native-host bundling runs the same guard. For a staged
distribution or unpacked cached ZIP, add -- --extension-dir /path/to/extension.
Always package the checked files; reusing an unchecked ZIP bypasses this guard.
