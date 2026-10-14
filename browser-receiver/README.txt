Agentic Cloud Receiver 0.3.5

Chrome receiver for Agentic Wear cloud chats and configured native Dot calls.
Use it alongside the compatible Agentic Wear bridge and paired Watch. Chrome
must remain signed in, with the configured ChatGPT chat/Dot page available,
and the computer must stay awake and online. Pairing and target configuration
remain local; credentials and personal configuration are not included here.

The receiver observes supported pages, forwards replies, and handles explicit
Watch sends and calls. Native call readiness includes host acceptance. Browser
mute ownership and profile readiness fixes are retained. Ended native calls
have a 20-second Watch cooldown. Watch build 106 includes media calling audio
that stops on acceptance, cancel or failure.

Install the extension through Chrome's Load unpacked workflow using extension/.
Native messaging requires the companion bridge host; the extension alone is
not a standalone bridge installer. Existing paired installations keep their
identity, signing and local configuration.
