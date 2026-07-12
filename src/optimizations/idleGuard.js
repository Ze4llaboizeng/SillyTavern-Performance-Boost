/**
 * @module IdleGuard
 *
 * Power / battery savings for phones:
 *  - Pause polling & expensive observers when the tab is hidden
 *  - Re-apply once when the tab becomes visible again
 *  - Optional low-power class when battery is low and unplugged
 *  - Optional freeze of decorative background layers on low tier
 *
 * Pattern mirrors power-idle-menu-mutator skill guidance:
 *  visibilitychange → disconnect / flag pending → re-apply on show.
 */

const STYLE_ID = "pb-idle-guard-style";
const LOG = "[PerfBoost:Idle]";

export class IdleGuard {
    /**
     * @param {object} cfg
     * @param {boolean} cfg.enabled
     * @param {boolean} [cfg.pauseWhenHidden=true]
     * @param {boolean} [cfg.lowBatteryMode=true]
     * @param {boolean} [cfg.freezeBackground=false]
     * @param {Function} [onHidden]  () => void  — pause other modules
     * @param {Function} [onVisible] () => void  — resume other modules
     */
    constructor(cfg = {}, onHidden = null, onVisible = null) {
        this.cfg = cfg;
        this.onHidden = onHidden;
        this.onVisible = onVisible;
        this._hidden = document.hidden;
        this._lowPower = false;
        this._visHandler = null;
        this._battery = null;
        this._battHandlers = [];
    }

    init() {
        this._injectStyles();
        this._visHandler = () => this._onVisibility();
        document.addEventListener("visibilitychange", this._visHandler, { passive: true });

        if (this.cfg.lowBatteryMode !== false) {
            this._watchBattery();
        }

        if (this.cfg.freezeBackground) {
            document.body.classList.add("pb-freeze-bg");
        }

        // If we boot already hidden, pause immediately.
        if (document.hidden) this._onVisibility();
    }

    setFreezeBackground(on) {
        this.cfg.freezeBackground = !!on;
        document.body.classList.toggle("pb-freeze-bg", !!on);
    }

    get isHidden() { return this._hidden; }
    get isLowPower() { return this._lowPower; }

    destroy() {
        if (this._visHandler) {
            document.removeEventListener("visibilitychange", this._visHandler);
            this._visHandler = null;
        }
        for (const { target, type, fn } of this._battHandlers) {
            try { target.removeEventListener(type, fn); } catch { /* ignore */ }
        }
        this._battHandlers = [];
        document.body.classList.remove("pb-freeze-bg", "pb-low-power");
        document.getElementById(STYLE_ID)?.remove();
    }

    _onVisibility() {
        this._hidden = document.hidden;
        if (this._hidden) {
            try { this.onHidden?.(); } catch (e) { console.warn(LOG, e); }
        } else {
            try { this.onVisible?.(); } catch (e) { console.warn(LOG, e); }
        }
    }

    async _watchBattery() {
        try {
            if (!("getBattery" in navigator)) return;
            const b = await navigator.getBattery();
            this._battery = b;
            const update = () => {
                const low = !b.charging && b.level < 0.20;
                if (low !== this._lowPower) {
                    this._lowPower = low;
                    document.body.classList.toggle("pb-low-power", low);
                    if (low) {
                        // Extra freeze when battery is dying
                        document.body.classList.add("pb-freeze-bg");
                        console.log(`${LOG} Low battery — enabling freeze-bg`);
                    } else if (!this.cfg.freezeBackground) {
                        document.body.classList.remove("pb-freeze-bg");
                    }
                }
            };
            update();
            for (const type of ["levelchange", "chargingchange"]) {
                const fn = update;
                b.addEventListener(type, fn);
                this._battHandlers.push({ target: b, type, fn });
            }
        } catch { /* Battery API unavailable */ }
    }

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = `
            /* Freeze decorative backgrounds (saves GPU compositing on phones) */
            body.pb-freeze-bg #bg1,
            body.pb-freeze-bg #bg2,
            body.pb-freeze-bg .bg_example,
            body.pb-freeze-bg #background_template {
                animation: none !important;
                transition: none !important;
                filter: none !important;
                will-change: auto !important;
            }

            /* Low-power: strip remaining paint-heavy chrome */
            body.pb-low-power #top-bar,
            body.pb-low-power #top-settings-holder,
            body.pb-low-power .drawer-content {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            body.pb-low-power * {
                text-shadow: none !important;
            }
        `;
        document.head.appendChild(el);
    }
}
