# ⚡ SillyTavern Performance Boost

**SillyTavern Performance Boost** is a SillyTavern extension for low-RAM phones and weak clients: less paint, fewer decoded images, fewer DOM messages on screen, and one-tap **Phone Saver** that applies official ST performance knobs.

---

## 🚀 Features

### 1. Device Profiler
* **Heap-first tiering** on Chromium (`performance.memory.jsHeapSizeLimit`)
* **Composite score** fallback (RAM / cores / FPS / mobile / network)
* **4 tiers**: Low / Medium / Good / High — with a **mobile RAM floor** (≤2 GB → LOW)
* Optional **NODE_OPTIONS heap boost** hint when host RAM is spare

### 2. Virtual Scrolling
* Layer 1: `content-visibility: auto` (zero-JS skip of off-screen messages)
* Layer 2 (aggressive): hide far messages with `content-visibility: hidden` + `contain: strict`
* Keeps `.mes` DOM so ST jQuery handlers stay intact

### 3. Lazy Image Loading
* Defers avatars / expression sprites until near viewport
* `loading=lazy`, `decoding=async`, `fetchpriority=low` until visible

### 4. Scroll Optimizer
* `will-change` / containment while scrolling, `overscroll-behavior: contain`
* Passive + rAF-throttled scroll listeners

### 5. Animation Controller
* Strip blur / shadows / transitions on low tier
* Honors `prefers-reduced-motion`

### 6. Memory Monitor
* Watches JS heap + rendered message count
* On pressure: aggressive virtual scroll + force image detach + collapse old media
* Pauses when the tab is hidden

### 7. ST Core Hints (official ST FAQ knobs)
* **Fast UI / No Blur** (`power_user.fast_ui_mode` → `body.no-blur`)
* **Reduced motion**, **Streaming FPS**, **# Messages to Load** (`chat_truncation`)
* Disables smooth streaming / stream fade-in on weak tiers
* Syncs User Settings checkboxes/sliders

### 8. Idle / Battery Guard
* Pauses monitors when tab is hidden
* Low-battery freeze of decorative backgrounds

### 9. DOM Janitor
* Detaches decoded bitmaps of far-off images (layout preserved)
* Optional collapse of older media blocks
* **Clean Now** for emergency free-up

### 10. Phone Saver (one-tap)
* Low-tier profile: Fast UI + ~12 FPS stream + ~40 messages loaded + aggressive virtual scroll + freeze backgrounds + detach far images

---

## 📁 Project structure

```text
SillyTavern-Performance-Boost/
├── src/
│   ├── core/
│   │   ├── deviceDetector.js
│   │   ├── memoryMonitor.js
│   │   └── virtualizer.js            # legacy; runtime uses optimizations/virtualScroll.js
│   ├── optimizations/
│   │   ├── stCoreHints.js
│   │   ├── idleGuard.js
│   │   ├── domJanitor.js
│   │   ├── animationController.js
│   │   ├── imageOptimizer.js
│   │   ├── scrollOptimizer.js
│   │   └── virtualScroll.js
│   └── ui/
│       └── settingsPanel.js
├── index.js
├── manifest.json
├── settings.html
├── style.css
├── CHANGELOG.md
└── LICENSE
```

### Install
1. Open SillyTavern
2. Extensions → Install Extension
3. URL: `https://github.com/Ze4llaboizeng/SillyTavern-Performance-Boost`
4. Install, then refresh once

### Settings panel
**Quick actions**
* **Phone Saver** — recommended first action on phones
* **Apply ST Tips** — apply Fast UI / FPS / truncation for current tier
* **Clean Now** — detach far images immediately

**Device / Memory / Optimizations**
* Auto tier, heap threshold (default **75%**), message-count trigger (default **300**)
* ST Core Hints, Virtual Scroll, Lazy Images, DOM Janitor, Idle Guard, Reduce Animations

### Low-RAM phone checklist (ST FAQ + Termux)
1. Tap **Phone Saver**
2. Enable browser Hardware Acceleration
3. Disable heavy extensions (Live2D / VRM / talkinghead) if possible
4. Termux host: `performance.lazyLoadCharacters: true`, `useDiskCache: false` in `config.yaml`
5. Best pattern: run ST on PC/server, open the UI in the phone browser

### Sources used (Reddit APIs were blocked from this environment)
* https://docs.sillytavern.app/usage/faq/ (Performance Tips)
* https://docs.sillytavern.app/installation/android-(termux)/ (performance tweaks)
* ST core `power-user.js` keys: `fast_ui_mode`, `reduced_motion`, `streaming_fps`, `chat_truncation`, `smooth_streaming`, `stream_fade_in`, `noShadows`

### Contribute / bugs
Open a GitHub Issue with the Bug Report or Feature Request form.
