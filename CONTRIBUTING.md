# Contributing

Thanks for helping improve Agentic Wear.

1. Keep changes independent of private applications, repositories, credentials, and customer data.
2. Use synthetic session names and prompts in screenshots, tests, issues, and pull requests.
3. Preserve the terminal-event invariant: only `turn/completed` or a persisted final turn status may create a completion/error alert.
4. Never broaden watch approval controls beyond watch-owned sessions without a public threat-model update.
5. Run all bridge, relay, Android lint, and build checks documented in `README.md`.
6. Visually inspect every changed state on a round Wear OS emulator. Motion changes must be checked at normal speed and with animations disabled.

Public discussions should be candid about defects and tradeoffs, but must not disclose unrelated private products or user data.
