# Changelog

## [0.1.1] - Native ST drawer UI
- Settings panel now uses the same `inline-drawer` pattern as other extensions (one collapsed tab, expand to a single content strip)
- Nested drawers for Device / Memory / Optimizations / Tips
- Removed custom section chrome; rely on ST's chevron toggle
- Quick actions use `menu_button menu_button_icon` like core extensions

## [0.1.0] - Phone Saver / low-RAM mobile pass

### Research sources (Reddit blocked from this environment)
Official SillyTavern docs used as the ground truth for community-recommended mobile perf:
- FAQ → Performance Tips: No Blur (Fast UI), Reduced motion, Hardware Acceleration, Streaming FPS 10–15
- User Settings → `# Messages to Load` (`chat_truncation`), smooth streaming off
- Android (Termux) → `performance.lazyLoadCharacters: true`, `useDiskCache: false`

### New modules
- **ST Core Hints** (`stCoreHints.js`) — applies ST's own `power_user` knobs per tier (Fast UI, reduced motion, streaming FPS, chat truncation, disable smooth streaming / fade-in)
- **Idle Guard** (`idleGuard.js`) — pause polling when tab hidden; low-battery freeze of decorative backgrounds
- **DOM Janitor** (`domJanitor.js`) — detach decoded bitmaps of far-off images (keeps layout); optional collapse of old media blocks

### Improvements
- Device detector: mobile RAM hard-floor (≤2 GB → LOW), stricter mobile heap tiers, network `saveData` / 2g–3g score penalty, richer recommended settings
- Memory monitor: lower defaults (75% heap / 300 messages), pause when hidden, `pause()` / `resume()` API
- Virtual scroll: tighter aggressive rootMargin on phones (1.25× viewport), `contain: strict` on hidden messages, pause MutationObserver when hidden
- Image optimizer: smaller rootMargin, `fetchpriority=low` until visible
- Memory pressure: force image detach + enable collapse-old-media, not just aggressive virtual scroll

### UI redesign
- **Phone Saver** one-tap profile (primary action)
- **Apply ST Tips** + **Clean Now** quick actions
- Live tier chip in header
- Message-count threshold slider
- Collapsible Tips section with official ST + Termux checklist
- Mobile hit targets ≥40–44px, grid that stacks on narrow screens, overflow-safe labels

## [0.0.1] - Initial Release
- Implemented core Virtualizer and IntersectionObservers.
- Added Device Profiler (Low/Medium/High tier scaling).
- Added modular UI settings injected into ST extensions menu.
- Added GitHub workflow for automated releases.
