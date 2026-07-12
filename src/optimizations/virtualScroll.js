/**
 * @module VirtualScroll
 *
 * Two-layer virtual scrolling strategy:
 *  1. CSS `content-visibility: auto`  → browser skips layout/paint for off-screen messages (zero JS cost)
 *  2. IntersectionObserver             → for low-end tier, also apply `content-visibility: hidden`
 *                                        on messages that are >N viewport-heights away (saves render budget)
 *
 * Why NOT just remove/re-insert DOM nodes?
 *  SillyTavern attaches jQuery event handlers directly to `.mes` elements (edit, regen, copy, etc.).
 *  Removing nodes destroys those handlers with no easy way to re-attach them.
 *  content-visibility keeps the DOM intact while still saving rendering work.
 *
 * Phone tweaks:
 *  - Smaller rootMargin in aggressive mode (1.25× viewport vs 2×)
 *  - contain: content on hidden messages
 *  - Pause MutationObserver while document.hidden
 */

const STYLE_ID        = "pb-virtual-scroll-style";
const HIDDEN_CLASS    = "pb-msg-hidden";
const INTRINSIC_HINT  = 130; // px — average estimated message height for scroll-bar sizing

export class VirtualScroll {
    /** @param {object} cfg  — from extension_settings.messageVirtualization */
    constructor(cfg = {}) {
        this.cfg        = cfg;
        this.observer   = null;      // IntersectionObserver
        this.mutObs     = null;      // MutationObserver (watches for new messages)
        this.chatEl     = null;
        this.heights    = new Map(); // el → measured height (px)
        this.enabled    = false;
        this._pending   = [];
        this._visHandler = null;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    init() {
        this.chatEl = document.getElementById("chat");
        if (!this.chatEl) return;

        this._injectStyles();

        if (this.cfg.aggressiveMode) {
            this._setupIntersectionObserver();
            this._setupMutationObserver();
        }

        // Pause mutation work when tab is backgrounded
        this._visHandler = () => {
            if (document.hidden) {
                this.mutObs?.disconnect();
            } else if (this.cfg.aggressiveMode && this.chatEl) {
                this.mutObs?.observe(this.chatEl, { childList: true });
                this.onMessageAdded();
            }
        };
        document.addEventListener("visibilitychange", this._visHandler, { passive: true });

        this.enabled = true;
    }

    /** Called when ST switches to a different chat */
    onChatChanged() {
        this._clearAll();
        if (this.cfg.aggressiveMode) {
            setTimeout(() => this._observeAll(), 250);
        }
    }

    /** Called when ST appends a new message element */
    onMessageAdded() {
        if (!this.observer) return;
        document.querySelectorAll("#chat .mes:not([data-pb-observed])").forEach(el => {
            this._measureAndCache(el);
            this.observer.observe(el);
            el.dataset.pbObserved = "1";
        });
    }

    /** Toggle aggressive mode on/off at runtime (e.g., memory pressure) */
    setAggressiveMode(on) {
        this.cfg.aggressiveMode = on;

        if (on && !this.observer) {
            this._setupIntersectionObserver();
            this._setupMutationObserver();
            this._observeAll();
        } else if (!on && this.observer) {
            this.observer.disconnect();
            this.observer = null;
            this.mutObs?.disconnect();
            this.mutObs = null;
            this._clearAll();
        }
    }

    destroy() {
        this.observer?.disconnect();
        this.mutObs?.disconnect();
        if (this._visHandler) {
            document.removeEventListener("visibilitychange", this._visHandler);
            this._visHandler = null;
        }
        this._clearAll();
        document.getElementById(STYLE_ID)?.remove();
        this.heights.clear();
        this.enabled = false;
    }

    // ─── Layer 1: CSS content-visibility ────────────────────────────────────

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = `
            /* Layer 1 — browser-native skip-render for off-screen messages */
            #chat .mes {
                content-visibility: auto;
                contain-intrinsic-block-size: ${INTRINSIC_HINT}px;
            }

            /* Layer 2 — aggressive: fully skip off-viewport messages */
            #chat .mes.${HIDDEN_CLASS} {
                content-visibility: hidden;
                contain: strict;
            }
        `;
        document.head.appendChild(el);
    }

    // ─── Layer 2: IntersectionObserver ───────────────────────────────────────

    _setupIntersectionObserver() {
        // rootMargin: 1.25× viewport on phones saves more; 2× on desktop feels smoother
        const isMobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
        const mult = isMobile ? 1.25 : 2;
        const margin = `${window.innerHeight * mult}px 0px ${window.innerHeight * mult}px 0px`;

        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                entry.isIntersecting
                    ? this._showMsg(entry.target)
                    : this._hideMsg(entry.target);
            }
        }, { root: this.chatEl, rootMargin: margin, threshold: 0 });

        this._observeAll();
    }

    _setupMutationObserver() {
        this.mutObs = new MutationObserver(mutations => {
            if (document.hidden) return;
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && node.classList?.contains("mes")) {
                        setTimeout(() => {
                            this._measureAndCache(node);
                            this.observer?.observe(node);
                            node.dataset.pbObserved = "1";
                        }, 80);
                    }
                }
            }
        });
        this.mutObs.observe(this.chatEl, { childList: true });
    }

    _observeAll() {
        document.querySelectorAll("#chat .mes").forEach(el => {
            this._measureAndCache(el);
            this.observer?.observe(el);
            el.dataset.pbObserved = "1";
        });
    }

    _showMsg(el) {
        if (!el.classList.contains(HIDDEN_CLASS)) return;
        el.classList.remove(HIDDEN_CLASS);
        el.style.containIntrinsicBlockSize = "";
    }

    _hideMsg(el) {
        if (el.classList.contains(HIDDEN_CLASS)) return;
        const h = this.heights.get(el) ?? INTRINSIC_HINT;
        el.style.containIntrinsicBlockSize = `${h}px`;
        el.classList.add(HIDDEN_CLASS);
    }

    _measureAndCache(el) {
        if (!this.heights.has(el)) {
            const h = el.offsetHeight;
            if (h > 0) this.heights.set(el, h);
        }
    }

    _clearAll() {
        document.querySelectorAll(`#chat .mes.${HIDDEN_CLASS}`).forEach(el => {
            el.classList.remove(HIDDEN_CLASS);
            el.style.containIntrinsicBlockSize = "";
            delete el.dataset.pbObserved;
        });
        // Also clear observed markers so re-observe works cleanly
        document.querySelectorAll("#chat .mes[data-pb-observed]").forEach(el => {
            delete el.dataset.pbObserved;
        });
        this.heights.clear();
    }
}
