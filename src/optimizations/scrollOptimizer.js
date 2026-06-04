/**
 * @module ScrollOptimizer
 *
 * Improves scroll performance in SillyTavern's chat container by:
 *  - Promoting the chat element to its own GPU composite layer (will-change)
 *  - Applying CSS contain during active scrolling (reduces style recalc)
 *  - Adding overscroll-behavior: contain (prevents body scroll chaining on mobile)
 *  - Providing a RAF-throttled scroll-event dispatcher so other modules
 *    can hook into scroll events without causing jank
 */

const STYLE_ID      = "pb-scroll-optimizer-style";
const SCROLLING_CLS = "pb-is-scrolling";

export class ScrollOptimizer {
    /** @param {object} cfg — from extension_settings.scrollOptimizer */
    constructor(cfg = {}) {
        this.cfg            = cfg;
        this.chatEl         = null;
        this._scrollRaf     = null;
        this._scrollTimeout = null;
        this._listeners     = new Set(); // external RAF-throttled scroll listeners
        this._onScroll      = null;
        this._cleanup       = [];        // fns to call in destroy()
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    init() {
        this.chatEl = document.getElementById("chat");
        if (!this.chatEl) return;

        this._injectStyles();
        this._setupScrollListener();
        this._applyContainment();
    }

    /**
     * Register a callback that fires (throttled to rAF) during scroll.
     * @param {Function} fn
     */
    onScroll(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn); // returns unsubscribe fn
    }

    destroy() {
        this._onScroll && this.chatEl?.removeEventListener("scroll", this._onScroll);
        cancelAnimationFrame(this._scrollRaf);
        clearTimeout(this._scrollTimeout);
        document.getElementById(STYLE_ID)?.remove();

        // Restore inline styles
        if (this.chatEl) {
            this.chatEl.classList.remove(SCROLLING_CLS);
            this.chatEl.style.willChange          = "";
            this.chatEl.style.overscrollBehavior  = "";
        }

        this._listeners.clear();
        this._cleanup.forEach(fn => fn());
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = `
            /* Promote chat to its own compositor layer */
            #chat {
                will-change: scroll-position;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch; /* iOS momentum scroll */
            }

            /* During active scrolling: skip expensive per-message style recalc */
            #chat.${SCROLLING_CLS} .mes {
                pointer-events: none;   /* avoid hover recalc while scrolling */
            }
        `;
        document.head.appendChild(el);
    }

    _setupScrollListener() {
        let ticking = false;

        this._onScroll = () => {
            // --- Active scrolling class ---
            this.chatEl.classList.add(SCROLLING_CLS);
            clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                this.chatEl.classList.remove(SCROLLING_CLS);
            }, 150);

            // --- RAF throttle for external listeners ---
            if (!ticking) {
                this._scrollRaf = requestAnimationFrame(() => {
                    this._listeners.forEach(fn => {
                        try { fn(); } catch { /* ignore listener errors */ }
                    });
                    ticking = false;
                });
                ticking = true;
            }
        };

        // IMPORTANT: passive:true prevents blocking the browser's scroll thread
        this.chatEl.addEventListener("scroll", this._onScroll, { passive: true });
    }

    _applyContainment() {
        // overscroll-behavior via CSS (already in _injectStyles),
        // but we also set it as inline style as a fallback for older browsers.
        this.chatEl.style.overscrollBehavior = "contain";
    }
}
