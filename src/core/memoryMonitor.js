/**
 * @module MemoryMonitor
 *
 * Watches JS heap usage (Chrome/Edge only via performance.memory) and
 * message-count as a cross-browser fallback.
 *
 * When memory pressure is detected, fires the supplied callback so other
 * modules can take action (e.g., activate aggressive virtual scrolling).
 *
 * Pauses automatically when the document is hidden (battery + CPU).
 */

const LOG = "[PerfBoost:MemMon]";

export class MemoryMonitor {
    /**
     * @param {object}   cfg       — from extension_settings.memoryManager
     * @param {Function} onPressure — (info: PressureInfo) => void
     */
    constructor(cfg = {}, onPressure = () => {}) {
        this.cfg         = cfg;
        this.onPressure  = onPressure;
        this._timer      = null;
        this._lastAlert  = 0;
        this._alertCool  = 60_000; // minimum ms between repeated alerts
        this._paused     = false;
        this._lastStats  = null;
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

    pause() {
        this._paused = true;
    }

    resume() {
        this._paused = false;
        this._check();
    }

    /** Alias for compatibility with destroy() convention */
    destroy() { this.stop(); }

    /**
     * Returns a live snapshot of memory usage for UI display.
     * @returns {{ supported:boolean, usedMB:number|null, limitMB:number|null, ratio:number|null, messageCount:number, threshold:number, paused:boolean }}
     */
    getStats() {
        const heap = this._heapInfo();
        const threshold = this.cfg.heapThreshold ?? 0.75;
        const stats = {
            supported:    !!heap,
            usedMB:       heap ? heap.used  / 1024 / 1024 : null,
            limitMB:      heap ? heap.limit / 1024 / 1024 : null,
            ratio:        heap ? heap.used  / heap.limit  : null,
            messageCount: this._messageCount(),
            threshold,
            paused:       this._paused,
        };
        this._lastStats = stats;
        return stats;
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _check() {
        if (this._paused) return;
        if (this.cfg.pauseWhenHidden !== false && document.hidden) return;

        const heap = this._heapInfo();
        const msgs = this._messageCount();

        const heapPressure = heap
            ? heap.used / heap.limit >= (this.cfg.heapThreshold ?? 0.75)
            : false;

        const msgPressure = msgs >= (this.cfg.messageCountThreshold ?? 300);

        // Cache for UI
        this._lastStats = {
            supported: !!heap,
            usedMB: heap ? heap.used / 1024 / 1024 : null,
            limitMB: heap ? heap.limit / 1024 / 1024 : null,
            ratio: heap ? heap.used / heap.limit : null,
            messageCount: msgs,
            threshold: this.cfg.heapThreshold ?? 0.75,
            paused: false,
        };

        if (heapPressure || msgPressure) {
            const now = Date.now();
            if (now - this._lastAlert < this._alertCool) return;
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
