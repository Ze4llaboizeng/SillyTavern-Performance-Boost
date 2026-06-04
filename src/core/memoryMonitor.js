/**
 * @module MemoryMonitor
 *
 * Watches JS heap usage (Chrome/Edge only via performance.memory) and
 * message-count as a cross-browser fallback.
 *
 * When memory pressure is detected, fires the supplied callback so other
 * modules can take action (e.g., activate aggressive virtual scrolling).
 */

const LOG = "[PerfBoost:MemMon]";

export class MemoryMonitor {
    /**
     * @param {object}   cfg       — from extension_settings.memoryMonitor
     * @param {Function} onPressure — (info: PressureInfo) => void
     */
    constructor(cfg = {}, onPressure = () => {}) {
        this.cfg         = cfg;
        this.onPressure  = onPressure;
        this._timer      = null;
        this._lastAlert  = 0;
        this._alertCool  = 60_000; // minimum ms between repeated alerts
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    start() {
        this._check(); // immediate first check
        this._timer = setInterval(() => this._check(), this.cfg.checkInterval ?? 30_000);
    }

    stop() {
        clearInterval(this._timer);
        this._timer = null;
    }

    /** Alias for compatibility with destroy() convention */
    destroy() { this.stop(); }

    /**
     * Returns a live snapshot of memory usage for UI display.
     * Safe to call at any time, even when the monitor isn't running.
     * @returns {{ supported:boolean, usedMB:number|null, limitMB:number|null, ratio:number|null, messageCount:number, threshold:number }}
     */
    getStats() {
        const heap = this._heapInfo();
        const threshold = this.cfg.heapThreshold ?? 0.80;
        return {
            supported:    !!heap,
            usedMB:       heap ? heap.used  / 1024 / 1024 : null,
            limitMB:      heap ? heap.limit / 1024 / 1024 : null,
            ratio:        heap ? heap.used  / heap.limit  : null,
            messageCount: this._messageCount(),
            threshold,
        };
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _check() {
        const heap = this._heapInfo();
        const msgs = this._messageCount();

        const heapPressure = heap
            ? heap.used / heap.limit >= (this.cfg.heapThreshold ?? 0.80)
            : false;

        const msgPressure = msgs >= (this.cfg.messageCountThreshold ?? 500);

        if (heapPressure || msgPressure) {
            const now = Date.now();
            if (now - this._lastAlert < this._alertCool) return; // cooldown
            this._lastAlert = now;

            const info = {
                heapUsedMB:  heap ? (heap.used / 1024 / 1024).toFixed(1) : "N/A",
                heapLimitMB: heap ? (heap.limit / 1024 / 1024).toFixed(1) : "N/A",
                heapRatio:   heap ? (heap.used / heap.limit).toFixed(2) : "N/A",
                messageCount: msgs,
                reason:      heapPressure ? "heap" : "message-count",
            };

            console.warn(`${LOG} Memory pressure —`, info);
            this.onPressure(info);
        }
    }

    /** Returns { used, limit } in bytes from Chrome's performance.memory, or null. */
    _heapInfo() {
        const mem = window.performance?.memory;
        if (!mem) return null;
        return { used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit };
    }

    /** Count rendered .mes elements as a lightweight cross-browser proxy for memory. */
    _messageCount() {
        return document.querySelectorAll("#chat .mes").length;
    }
}
