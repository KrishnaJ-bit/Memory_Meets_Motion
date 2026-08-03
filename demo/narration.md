# Relay Demo Narration

1. The presence monitor watches camera motion plus mouse, click, keyboard, and tab activity while the developer works.
2. The developer hits the checkout token-bucket boundary failure and leaves, so Relay emits a `developer_absent` handoff event.
3. Autopilot turns on automatically and the Guild.ai `relay-resume` agent inherits the live task graph plus event tail.
4. RocketRide replays the handoff context, reasons about the blocker, edits the limiter, retries the test, and opens the PR.
5. The PR summary says what Relay inherited, what it changed, and how the sponsor-backed audit trail proves the handoff.
