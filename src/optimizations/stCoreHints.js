/**
 * @module StCoreHints
 *
 * Applies SillyTavern's OWN built-in performance toggles (from official FAQ):
 *  - No Blur / Fast UI  (power_user.fast_ui_mode → body.no-blur)
 *  - Reduced motion
 *  - Streaming FPS cap
 *  - Chat truncation (# messages to load before pagination)
 *  - Disable smooth streaming / stream fade-in (paint storms on weak GPUs)
 *
 * Source of truth for these tips:
 *  docs.sillytavern.app/usage/faq/#performance-tips
 *  docs.sillytavern.app/installation/android-(termux)/#performance-tweaks
 *
 * We mutate power_user + mirror the DOM controls so the User Settings panel
 * stays in sync, then call saveSettingsDebounced().
 */

const LOG = "[PerfBoost:STHints]";

/** Tier → recommended ST core values. */
const TIER_HINTS = {
    low: {
        fast_ui_mode: true,
        reduced_motion: true,
        streaming_fps: 12,
        chat_truncation: 40,
        smooth_streaming: false,
        stream_fade_in: false,
        noShadows: true,
    },
    medium: {
        fast_ui_mode: true,
        reduced_motion: false,
        streaming_fps: 18,
        chat_truncation: 80,
        smooth_streaming: false,
        stream_fade_in: false,
        noShadows: false,
    },
    good: {
        fast_ui_mode: true,
        reduced_motion: false,
        streaming_fps: 24,
        chat_truncation: 120,
        smooth_streaming: false,
        stream_fade_in: false,
        noShadows: false,
    },
    high: {
        // High tier: only ensure Fast UI is on (cheap win), leave the rest alone.
        fast_ui_mode: true,
        reduced_motion: null, // do not force
        streaming_fps: null,
        chat_truncation: null,
        smooth_streaming: null,
        stream_fade_in: null,
        noShadows: null,
    },
};

export class StCoreHints {
    /**
     * @param {object} cfg
     * @param {boolean} cfg.enabled
     * @param {boolean} [cfg.applyOnBoot=true]
     * @param {boolean} [cfg.respectUserOverrides=true]  if true, only apply when
     *   autoDetect is on OR the user clicks "Apply ST perf tips"
     * @param {Function} getTier  () => current tier string
     * @param {Function} saveSettings  saveSettingsDebounced
     */
    constructor(cfg = {}, getTier = () => "medium", saveSettings = () => {}) {
        this.cfg = cfg;
        this.getTier = getTier;
        this.saveSettings = saveSettings;
        this._powerUser = null;
        this._lastApplied = null;
        this._snapshot = null; // previous values so we can restore on destroy
    }

    async init() {
        try {
            // Absolute from ST public root — stable regardless of nested module path.
            // Fallback: walk up from this file (…/third-party/Ext/src/optimizations → scripts/).
            let mod;
            try {
                mod = await import("/scripts/power-user.js");
            } catch {
                mod = await import("../../../../../power-user.js");
            }
            this._powerUser = mod.power_user;
        } catch (err) {
            console.warn(`${LOG} Cannot import power_user — ST hints disabled.`, err);
            return;
        }

        if (this.cfg.applyOnBoot !== false && this.cfg.enabled !== false) {
            this.applyForTier(this.getTier());
        }
    }

    /**
     * Apply ST core perf tips for a given tier.
     * @param {string} tier  low|medium|good|high
     * @param {{ force?: boolean }} [opts]
     * @returns {object|null} applied values, or null if skipped
     */
    applyForTier(tier, opts = {}) {
        if (!this._powerUser) return null;
        if (!this.cfg.enabled && !opts.force) return null;

        const hints = TIER_HINTS[tier] ?? TIER_HINTS.medium;
        if (!this._snapshot) this._snapshot = this._capture();

        const applied = {};
        const pu = this._powerUser;

        // Fast UI / No Blur — biggest official win for jittery UI
        if (hints.fast_ui_mode != null) {
            pu.fast_ui_mode = !!hints.fast_ui_mode;
            document.body.classList.toggle("no-blur", pu.fast_ui_mode);
            this._setCheck("#fast_ui_mode", pu.fast_ui_mode);
            applied.fast_ui_mode = pu.fast_ui_mode;
        }

        // Reduced motion (don't fight OS-level reduce if already on)
        if (hints.reduced_motion != null) {
            const osReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (osReduced || hints.reduced_motion) {
                pu.reduced_motion = true;
            } else {
                pu.reduced_motion = false;
            }
            if (typeof jQuery !== "undefined") jQuery.fx.off = !!pu.reduced_motion;
            document.body.classList.toggle("reduced-motion", !!pu.reduced_motion);
            this._setCheck("#reduced_motion", pu.reduced_motion);
            applied.reduced_motion = pu.reduced_motion;
        }

        // Streaming FPS — FAQ recommends 10–15 on weak devices
        if (hints.streaming_fps != null) {
            pu.streaming_fps = hints.streaming_fps;
            this._setRange("#streaming_fps", "#streaming_fps_counter", pu.streaming_fps);
            applied.streaming_fps = pu.streaming_fps;
        }

        // # Messages to Load (chat_truncation) — pagination saves DOM/RAM
        if (hints.chat_truncation != null) {
            pu.chat_truncation = hints.chat_truncation;
            this._setRange("#chat_truncation", "#chat_truncation_counter", pu.chat_truncation);
            applied.chat_truncation = pu.chat_truncation;
        }

        // Smooth streaming / fade-in are paint-heavy on mobile GPUs
        if (hints.smooth_streaming != null) {
            pu.smooth_streaming = !!hints.smooth_streaming;
            this._setCheck("#smooth_streaming", pu.smooth_streaming);
            applied.smooth_streaming = pu.smooth_streaming;
        }
        if (hints.stream_fade_in != null) {
            pu.stream_fade_in = !!hints.stream_fade_in;
            this._setCheck("#stream_fade_in", pu.stream_fade_in);
            applied.stream_fade_in = pu.stream_fade_in;
        }

        // No shadows (power_user.noShadows — checkbox id is #noShadowsmode)
        if (hints.noShadows != null && "noShadows" in pu) {
            pu.noShadows = !!hints.noShadows;
            document.body.classList.toggle("noShadows", pu.noShadows);
            this._setCheck("#noShadowsmode", pu.noShadows);
            applied.noShadows = pu.noShadows;
        }

        this._lastApplied = { tier, ...applied, at: Date.now() };
        try { this.saveSettings(); } catch { /* ignore */ }

        console.log(`${LOG} Applied ST core hints for tier=${tier}`, applied);
        return applied;
    }

    /** One-click "Phone Saver" — always uses low-tier ST hints. */
    applyPhoneSaver() {
        return this.applyForTier("low", { force: true });
    }

    getLastApplied() {
        return this._lastApplied;
    }

    /** Restore values we overwrote (best-effort). */
    restore() {
        if (!this._powerUser || !this._snapshot) return;
        const pu = this._powerUser;
        const s = this._snapshot;
        for (const [k, v] of Object.entries(s)) {
            if (v === undefined) continue;
            pu[k] = v;
        }
        document.body.classList.toggle("no-blur", !!pu.fast_ui_mode);
        document.body.classList.toggle("reduced-motion", !!pu.reduced_motion);
        this._setCheck("#fast_ui_mode", pu.fast_ui_mode);
        this._setCheck("#reduced_motion", pu.reduced_motion);
        this._setRange("#streaming_fps", "#streaming_fps_counter", pu.streaming_fps);
        this._setRange("#chat_truncation", "#chat_truncation_counter", pu.chat_truncation);
        try { this.saveSettings(); } catch { /* ignore */ }
        this._snapshot = null;
    }

    destroy() {
        // Do NOT auto-restore on destroy — user may want the ST settings to stick.
        this._powerUser = null;
    }

    // ── helpers ──────────────────────────────────────────────────────────

    _capture() {
        const pu = this._powerUser;
        if (!pu) return null;
        return {
            fast_ui_mode: pu.fast_ui_mode,
            reduced_motion: pu.reduced_motion,
            streaming_fps: pu.streaming_fps,
            chat_truncation: pu.chat_truncation,
            smooth_streaming: pu.smooth_streaming,
            stream_fade_in: pu.stream_fade_in,
            noShadows: pu.noShadows,
        };
    }

    _setCheck(sel, val) {
        try {
            const el = document.querySelector(sel);
            if (el) el.checked = !!val;
        } catch { /* ignore */ }
    }

    _setRange(sliderSel, counterSel, val) {
        try {
            const s = document.querySelector(sliderSel);
            if (s) s.value = String(val);
            const c = document.querySelector(counterSel);
            if (c) c.value = String(val);
        } catch { /* ignore */ }
    }
}
