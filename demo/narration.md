# Relay Demo Narration

1. The presence monitor watches mouse, click, keyboard, and tab activity while the developer works — no camera.
2. The developer hits the checkout token-bucket boundary failure and leaves, so Relay emits a `developer_absent` handoff event.
3. Autopilot turns on automatically: Guild.ai's `context-summarizer` (G1) compresses the session, then `relay-resume` (G2) inherits the live task graph plus event tail and proposes a fix.
4. RocketRide replays the handoff context, reasons about the blocker, edits the limiter, and retries the test — a human then approves before anything opens.
5. Once approved, the PR opens for real, Guild.ai's `pr-risk-review` (G3) reviews it automatically, and the PR itself — not a custom results screen — is the finale.
