/**
 * @module ImageOptimizer
 *
 * Applies lazy-loading and async-decoding to images inside the chat.
 * Uses IntersectionObserver to defer loading until the image is near the viewport.
 * Also handles SillyTavern's character expression sprites and avatar thumbnails.
 *
 * Phone tweaks:
 *  - Smaller rootMargin (less speculative decode)
 *  - decoding=async + fetchpriority=low for far images
 *  - Optional avatar defer on low-RAM
 */

const OBSERVED_ATTR = "data-pb-lazy";
const PLACEHOLDER   = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";

export class ImageOptimizer {
    /** @param {object} cfg — from extension_settings.imageOptimizer */
    constructor(cfg = {}) {
        this.cfg      = cfg;
        this.observer = null;
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    init() {
        this._setupObserver();
        this.scanImages();
    }

    /** Re-scan the chat for any images not yet optimized (call after new messages). */
    scanImages() {
        const selector = `
            #chat img:not([${OBSERVED_ATTR}]),
            #chat .mes_img:not([${OBSERVED_ATTR}]),
            #expression-holder img:not([${OBSERVED_ATTR}])
        `.trim();

        document.querySelectorAll(selector).forEach(img => this._processImage(img));
    }

    destroy() {
        this.observer?.disconnect();
        this.observer = null;

        // Restore any deferred images so they load normally
        document.querySelectorAll(`img[${OBSERVED_ATTR}="pending"]`).forEach(img => {
            const src = img.dataset.pbSrc;
            if (src) {
                img.src = src;
                img.removeAttribute("data-pb-src");
            }
            img.removeAttribute(OBSERVED_ATTR);
        });
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _setupObserver() {
        const marginPx = this.cfg.rootMarginPx ?? 120;
        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this._loadImage(entry.target);
                    this.observer.unobserve(entry.target);
                }
            }
        }, {
            rootMargin: `${marginPx}px 0px`,
            threshold:  0,
        });
    }

    _processImage(img) {
        // Mark so we don't process twice
        img.setAttribute(OBSERVED_ATTR, "pending");

        // Always add native hints (zero cost)
        img.setAttribute("loading",  "lazy");
        img.setAttribute("decoding", "async");

        // Don't fight the browser's LCP candidate for the last few messages
        try {
            if ("fetchPriority" in img || "fetchpriority" in img) {
                img.fetchPriority = "low";
            } else {
                img.setAttribute("fetchpriority", "low");
            }
        } catch { /* ignore */ }

        // If image is already loaded (cached / inline src), mark done
        if (img.complete && img.naturalWidth > 0) {
            img.setAttribute(OBSERVED_ATTR, "loaded");
            return;
        }

        // For expressions / large images: defer src until visible
        if (this._shouldDefer(img)) {
            const originalSrc = img.src || img.getAttribute("src");
            if (originalSrc && originalSrc !== PLACEHOLDER) {
                img.dataset.pbSrc = originalSrc;
                img.src           = PLACEHOLDER;
            }
            this.observer?.observe(img);
        } else {
            // Small avatars — just observe passively (native lazy handles them)
            this.observer?.observe(img);
        }
    }

    _loadImage(img) {
        const deferred = img.dataset.pbSrc;
        if (deferred) {
            img.src = deferred;
            img.removeAttribute("data-pb-src");
        }
        try {
            if ("fetchPriority" in img || "fetchpriority" in img) {
                img.fetchPriority = "auto";
            }
        } catch { /* ignore */ }
        img.setAttribute(OBSERVED_ATTR, "loaded");
    }

    /**
     * Returns true for images worth actively deferring:
     * expression sprites (typically large), images inside message blocks.
     */
    _shouldDefer(img) {
        const isExpression = img.closest("#expression-holder") !== null;
        const isMessageImg = img.closest(".mes_img_container") !== null
                          || img.closest(".mes_img") !== null;
        const isLargeAvatar = this.cfg.deferAvatars !== false
            && (img.classList.contains("avatar") || img.closest(".avatar") !== null);

        return isExpression || isMessageImg || isLargeAvatar;
    }
}
