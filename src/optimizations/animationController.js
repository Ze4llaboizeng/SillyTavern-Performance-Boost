/**
 * @module AnimationController
 *
 * Reduces or disables CSS animations/transitions for low-end devices.
 * Works by toggling CSS classes on <body> that the style.css file responds to.
 *
 * Respects the OS-level `prefers-reduced-motion` media query.
 */

const STYLE_ID    = "pb-animation-style";
const BODY_CLASS  = {
    BASE:         "pb-anim-reduced",
    NO_BLUR:      "pb-no-blur",
    NO_SHADOWS:   "pb-no-shadows",
    NO_TRANS:     "pb-no-transitions",
};

export class AnimationController {
    /** @param {object} cfg — from extension_settings.animationController */
    constructor(cfg = {}) {
        this.cfg          = cfg;
        this._mediaQuery  = window.matchMedia("(prefers-reduced-motion: reduce)");
        this._mqListener  = null;
        this._applied     = [];
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    init() {
        this._injectStyles();
        this._apply();

        // Automatically react to OS-level preference changes
        if (this.cfg.respectsReducedMotion) {
            this._mqListener = () => this._apply();
            this._mediaQuery.addEventListener("change", this._mqListener);
        }
    }

    /** Update settings at runtime and re-apply. */
    update(newCfg) {
        Object.assign(this.cfg, newCfg);
        this._apply();
    }

    destroy() {
        this._mqListener && this._mediaQuery.removeEventListener("change", this._mqListener);
        this._removeBodyClasses();
        document.getElementById(STYLE_ID)?.remove();
        this._applied = [];
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _apply() {
        this._removeBodyClasses();
        this._applied = [];

        const reduceMotion = this._mediaQuery.matches;

        if (reduceMotion) {
            // Always honor OS preference — add base class unconditionally
            this._addClass(BODY_CLASS.BASE);
            this._addClass(BODY_CLASS.NO_TRANS);
        }

        if (this.cfg.disableBlur) {
            this._addClass(BODY_CLASS.NO_BLUR);
        }

        if (this.cfg.disableShadows) {
            this._addClass(BODY_CLASS.NO_SHADOWS);
        }

        if (this.cfg.disableTransitions) {
            this._addClass(BODY_CLASS.NO_TRANS);
        }

        if (this.cfg.enabled && !reduceMotion) {
            // Extension-level reduction (user-configured, not OS-level)
            this._addClass(BODY_CLASS.BASE);
        }
    }

    _addClass(cls) {
        document.body.classList.add(cls);
        this._applied.push(cls);
    }

    _removeBodyClasses() {
        Object.values(BODY_CLASS).forEach(cls => document.body.classList.remove(cls));
    }

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = `
            /* ── Base animation reduction ── */
            body.${BODY_CLASS.BASE} *,
            body.${BODY_CLASS.BASE} *::before,
            body.${BODY_CLASS.BASE} *::after {
                animation-duration:        0.01ms !important;
                animation-iteration-count: 1      !important;
                transition-duration:       0.01ms !important;
                scroll-behavior:           auto   !important;
            }

            /* ── No blur effects ── */
            body.${BODY_CLASS.NO_BLUR} * {
                filter:         none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            /* ── No box/text shadows ── */
            body.${BODY_CLASS.NO_SHADOWS} * {
                box-shadow:  none !important;
                text-shadow: none !important;
            }

            /* ── No transitions only ── */
            body.${BODY_CLASS.NO_TRANS} *,
            body.${BODY_CLASS.NO_TRANS} *::before,
            body.${BODY_CLASS.NO_TRANS} *::after {
                transition: none !important;
            }
        `;
        document.head.appendChild(el);
    }
}
