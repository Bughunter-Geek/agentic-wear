# Alpha 1 preview: what to expect

Updated October 14, 2026.

**Alpha 1 is the proposed name for the next development preview. It is not available to download yet.** The core features mostly work in the developer's tested setup, but the design and stability are unfinished, some features are missing, and security testing and hardening need more time.

## What you can install today

The newest published alpha is [0.6.25](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha). Use its [matching setup instructions](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/README.md).

The newer watch app and browser integration described below are private development builds. Their changes are not included in that download or its source tag. Updating this page does not release a new app or change the automatic updater.

## What is working in development

Live voice—talking and hearing replies through an ongoing call—has worked on the developer's watch through a Mac and a signed-in browser. The current Dot voice connection needs a compatible account, the correct conversation configured, and the paired Mac and browser running. The watch does not connect to the account on its own.

In the owner's tests:

- A screen-off startup fix was accepted by the user.
- Three consecutive calls connected successfully. An earlier failed connection returned a server error whose cause is still being investigated.
- Browser checks passed, including checks for startup from an unselected tab. These checks do not prove that real calls work in every browser state or that the app is secure.
- Startup was observed around 21–24 seconds in earlier tests and around 15 seconds in a later test. A pause of roughly 20 seconds between calls also seemed to help. These are observations, not a speed guarantee or a proven required waiting time.

Support for live voice and tools in ordinary chats is still being investigated. A working Dot call does not establish the same capabilities for every chat.

## What still needs testing

Call reliability, turning the screen off, switching between Bluetooth and Wi-Fi, battery use, and different watch, browser and Codex versions all need broader testing. Small, round, square and rectangular screens have not all been checked on real devices.

An unselected browser tab can accept a start in the adapter's tests. A browser can still slow or pause a background page, and delayed or changed controls can prevent startup. Changes to the browser or Codex may also break the integration.

**This is experimental software for willing early testers, not a production-ready or safety-critical service.** Security testing and hardening are incomplete. Do not rely on it for urgent or safety-critical tasks, and use a disposable test project when trying it.

## Trying the published alpha

You need your own configured Mac bridge—the background program connecting your watch to Codex—and the matching relay, which passes encrypted messages between them. Installing the watch app alone does not supply those services or access to the developer's Mac. First-time setup still needs technical experience; follow the instructions for the published version rather than mixing development files with it.

Use the [alpha testing guide](alpha-testing.md). Helpful reports include the app and bridge versions, watch model, what you tried, and what happened. Failures are useful reports too. Keep passwords, pairing codes, private conversations and unedited diagnostic logs out of public reports.

The project keeps its existing Apache-2.0 license. Downloadable development builds and their included components will need a separate review before release.
