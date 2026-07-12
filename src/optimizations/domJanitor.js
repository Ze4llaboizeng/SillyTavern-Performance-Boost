/**
 * @module DomJanitor
 *
 * Aggressive DOM/memory hygiene for long chats on low-RAM phones.
 *  - Detach decoded bitmaps of far-off images (keep layout via width/height)
 *  - Cap MutationObserver work with rAF coalescing
 *  - Optional: collapse old message media blocks beyond a keep-window
 *
 * IMPORTANT: never remove .mes nodes — ST binds jQuery handlers on them.
 * We only touch <img> sources and CSS containment.
 */

const LOG = "[PerfBoost:Janitor]";
const STYLE_ID = "pb-janitor-style";
const DETACHED_ATTR = "data-pb-detached";

export class DomJanitor {
    /**
     * @param {object} cfg
     * @param {boolean} cfg.enabled
     * @param {boolean} [cfg.detachFarImages=true]
     * @param {number}  [cfg.keepViewportMult=3]  keep images within N× viewport
     * @param {number}  [cfg.sweepIntervalMs=45000]
     * @param {boolean} [cfg.collapseOldMedia=false]
     * @param {number}  [cfg.mediaKeepLast=80]  last N messages keep media expanded
     */
    constructor(cfg = {}) {
        this.cfg = cfg;
        this.chatEl = null;
        this._timer = null;
        this._io = null;
        this._raf = null;
        this._paused = false;
    }

    init() {
        this.chatEl = document.getElementById("chat");
        if (!this.chatEl) return;

        this._injectStyles();

        if (this.cfg.detachFarImages !== false) {
            this._setupIO();
            this.scan();
        }

        const interval = this.cfg.sweepIntervalMs ?? 45_000;
        this._timer = setInterval(() => {
            if (this._paused || document.hidden) return;
            this.scan();
            if (this.cfg.collapseOldMedia) this._collapseOldMedia();
        }, interval);
    }

    pause() { this._paused = true; }
    resume() {
        this._paused = false;
        this.scan();
    }

    scan() {
        if (!this.chatEl) return;
        const imgs = this.chatEl.querySelectorAll(
            `img:not([${DETACHED_ATTR}="pending-keep"]), #expression-holder img`
        );
        // Only observe those without our marker, or re-check detached ones via IO
        imgs.forEach(img => {
            if (!img.dataset.pbJanitorObs) {
                img.dataset.pbJanitorObs = "1";
                this._io?.observe(img);
            }
        });
    }

    /** Force detach all off-screen images now (memory pressure). */
    forceDetachAll() {
        if (!this.chatEl) return;
        let n = 0;
        this.chatEl.querySelectorAll("img").forEach(img => {
            if (this._isNearViewport(img)) return;
            if (this._detach(img)) n++;
        });
        // Expression sprites are often the biggest RAM hog
        document.querySelectorAll("#expression-holder img").forEach(img => {
            if (this._detach(img)) n++;
        });
        console.log(`${LOG} Force-detached ${n} images`);
        return n;
    }

    destroy() {
        clearInterval(this._timer);
        this._timer = null;
        this._io?.disconnect();
        this._io = null;
        cancelAnimationFrame(this._raf);

        // Restore detached images
        document.querySelectorAll(`img[${DETACHED_ATTR}="1"]`).forEach(img => this._reattach(img));
        document.getElementById(STYLE_ID)?.remove();
    }

    // ── private ──────────────────────────────────────────────────────────

    _setupIO() {
        const mult = this.cfg.keepViewportMult ?? 3;
        const margin = `${window.innerHeight * mult}px 0px`;

        this._io = new IntersectionObserver(entries => {
            if (this._paused) return;
            // Coalesce bursts into one rAF
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => {
                this._raf = null;
                for (const entry of entries) {
                    const img = entry.target;
                    if (entry.isIntersecting) this._reattach(img);
                    else this._detach(img);
                }
            });
        }, { root: null, rootMargin: margin, threshold: 0 });
    }

    _detach(img) {
        if (!(img instanceof HTMLImageElement)) return false;
        if (img.getAttribute(DETACHED_ATTR) === "1") return false;
        // Don't detach tiny icons / already-placeholder
        if (img.naturalWidth > 0 && img.naturalWidth < 24 && img.naturalHeight < 24) return false;

        const src = img.currentSrc || img.src;
        if (!src || src.startsWith("data:")) return false;

        // Preserve layout box so scroll height doesn't jump
        if (!img.dataset.pbW && img.offsetWidth) img.dataset.pbW = String(img.offsetWidth);
        if (!img.dataset.pbH && img.offsetHeight) img.dataset.pbH = String(img.offsetHeight);
        if (img.dataset.pbW) img.style.width = img.dataset.pbW + "px";
        if (img.dataset.pbH) img.style.height = img.dataset.pbH + "px";

        img.dataset.pbFullSrc = src;
        // Empty src releases the decoded bitmap in most Chromium mobile builds
        img.removeAttribute("src");
        img.setAttribute(DETACHED_ATTR, "1");
        img.classList.add("pb-img-detached");
        return true;
    }

    _reattach(img) {
        if (!(img instanceof HTMLImageElement)) return;
        if (img.getAttribute(DETACHED_ATTR) !== "1") return;
        const src = img.dataset.pbFullSrc;
        if (src) {
            img.src = src;
            delete img.dataset.pbFullSrc;
        }
        img.removeAttribute(DETACHED_ATTR);
        img.classList.remove("pb-img-detached");
        // Keep explicit size until natural load fills it; then clear
        img.addEventListener("load", () => {
            img.style.width = "";
            img.style.height = "";
        }, { once: true });
    }

    _isNearViewport(img) {
        const r = img.getBoundingClientRect();
        const mult = this.cfg.keepViewportMult ?? 3;
        const pad = window.innerHeight * mult;
        return r.bottom > -pad && r.top < window.innerHeight + pad;
    }

    _collapseOldMedia() {
        const keep = this.cfg.mediaKeepLast ?? 80;
        // chatEl is already #chat — do not re-prefix with #chat
        const nodes = this.chatEl.querySelectorAll(".mes");
        const total = nodes.length;
        if (total <= keep) return;

        const cutoff = total - keep;
        for (let i = 0; i < cutoff; i++) {
            const mes = nodes[i];
            if (mes.dataset.pbMediaCollapsed === "1") continue;
            mes.querySelectorAll(".mes_img_container, .mes_img, .media-display").forEach(el => {
                el.classList.add("pb-media-collapsed");
            });
            mes.dataset.pbMediaCollapsed = "1";
        }
    }

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = `
            img.pb-img-detached {
                background: rgba(128,128,128,0.12);
                object-fit: contain;
            }
            .pb-media-collapsed {
                max-height: 48px !important;
                overflow: hidden !important;
                opacity: 0.55;
            }
        `;
        document.head.appendChild(el);
    }
}
