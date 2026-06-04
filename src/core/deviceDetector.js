/**
 * @module DeviceDetector
 * Detects device capabilities and assigns a performance tier.
 * Tiers: "low" | "medium" | "high"
 */

export class DeviceDetector {
    static TIER = {
        LOW:    "low",    // score < 6   — ล่างสุด
        MEDIUM: "medium", // score < 8   — กลาง ๆ
        GOOD:   "good",   // score < 12  — พอใช้ได้
        HIGH:   "high",   // score ≥ 12  — ยอดเยี่ยม
    };

    /** Human-readable level labels (Thai) keyed by tier. */
    static TIER_LABEL = {
        low:    "ล่างสุด",
        medium: "กลาง ๆ",
        good:   "พอใช้ได้",
        high:   "ยอดเยี่ยม",
    };

    /** The maximum value `_calcScore` can return. */
    static MAX_SCORE = 16;

    /** Bytes per gigabyte — used for heap-size math. */
    static GB = 1024 * 1024 * 1024;

    /**
     * Map a 0–16 capability score onto a performance tier.
     *   score < 6   → LOW    (ล่างสุด)
     *   score < 8   → MEDIUM (กลาง ๆ)
     *   score < 12  → GOOD   (พอใช้ได้)
     *   score ≥ 12  → HIGH   (ยอดเยี่ยม)
     * @param {number} score
     * @returns {string} one of DeviceDetector.TIER
     */
    static tierFromScore(score) {
        if (score < 6)  return DeviceDetector.TIER.LOW;
        if (score < 8)  return DeviceDetector.TIER.MEDIUM;
        if (score < 12) return DeviceDetector.TIER.GOOD;
        return DeviceDetector.TIER.HIGH;
    }

    /**
     * Map a JS heap size limit (bytes) onto a performance tier.
     * This is the primary signal — the browser's heap ceiling is the
     * hard limit on how much chat history we can keep alive at once.
     *   < 2 GB → LOW    (ต่ำสุด)
     *   < 4 GB → MEDIUM (กลาง ๆ)
     *   ≥ 4 GB → HIGH   (ยอดเยี่ยม)
     * @param {number|null} heapLimitBytes
     * @returns {string|null} a DeviceDetector.TIER value, or null when heap info is unavailable
     */
    static tierFromHeapLimit(heapLimitBytes) {
        if (!heapLimitBytes) return null;
        const gb = heapLimitBytes / DeviceDetector.GB;
        if (gb < 2) return DeviceDetector.TIER.LOW;
        if (gb < 4) return DeviceDetector.TIER.MEDIUM;
        return DeviceDetector.TIER.HIGH;
    }

    constructor() {
        this._profile = null;
    }

    /**
     * Run all detection checks and return a full device profile.
     * @returns {Promise<DeviceProfile>}
     */
    async detect() {
        const memory    = navigator.deviceMemory ?? this._guessMemory();
        const cores     = navigator.hardwareConcurrency ?? 2;
        const isMobile  = this._checkMobile();
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const lowPower  = await this._checkBattery();
        const fps       = await this._measureFPS();

        // Primary signal: the browser's JS heap ceiling (Chrome/Edge).
        // Falls back to the composite capability score when
        // performance.memory is unavailable (e.g. Firefox/Safari).
        const heapLimitBytes = this._heapLimitBytes();
        const score     = this._calcScore(memory, cores, isMobile, fps);
        const heapTier  = DeviceDetector.tierFromHeapLimit(heapLimitBytes);
        const tier      = heapTier ?? DeviceDetector.tierFromScore(score);

        // If the heap is tight but the machine still has spare RAM,
        // we can suggest raising Node's --max-old-space-size.
        const heapBoost = this._calcHeapBoost(heapLimitBytes, memory);

        this._profile = {
            memory, cores, isMobile, reducedMotion, lowPower,
            fps: Math.round(fps),
            score,
            heapLimitMB: heapLimitBytes ? Math.round(heapLimitBytes / 1024 / 1024) : null,
            tier,
            tierSource: heapTier ? "heap" : "score",
            tierLabel: DeviceDetector.TIER_LABEL[tier],
            heapBoost,
        };
        return this._profile;
    }

    get profile() { return this._profile; }

    /** Return settings recommended for the detected tier. */
    getRecommendedSettings() {
        const tier = this._profile?.tier ?? DeviceDetector.TIER.MEDIUM;

        const map = {
            [DeviceDetector.TIER.LOW]: {
                aggressiveVirtualization: true,
                reduceAnimations:         true,
                disableBlur:              true,
                disableShadows:           true,
                maxOffscreenMessages:     30,
                scrollThrottleMs:         50,
            },
            [DeviceDetector.TIER.MEDIUM]: {
                aggressiveVirtualization: false,
                reduceAnimations:         false,
                disableBlur:              false,
                disableShadows:           false,
                maxOffscreenMessages:     60,
                scrollThrottleMs:         16,
            },
            [DeviceDetector.TIER.GOOD]: {
                aggressiveVirtualization: false,
                reduceAnimations:         false,
                disableBlur:              false,
                disableShadows:           false,
                maxOffscreenMessages:     90,
                scrollThrottleMs:         12,
            },
            [DeviceDetector.TIER.HIGH]: {
                aggressiveVirtualization: false,
                reduceAnimations:         false,
                disableBlur:              false,
                disableShadows:           false,
                maxOffscreenMessages:     120,
                scrollThrottleMs:         8,
            },
        };

        return map[tier];
    }

    // ─── Private Helpers ──────────────────────────────────────

    _checkMobile() {
        const ua = navigator.userAgent;
        const touchPad = navigator.maxTouchPoints > 1 && window.screen.width < 1024;
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || touchPad;
    }

    async _checkBattery() {
        try {
            if ("getBattery" in navigator) {
                const b = await navigator.getBattery();
                return !b.charging && b.level < 0.15;
            }
        } catch { /* Battery API not available */ }
        return false;
    }

    _guessMemory() {
        // Rough fallback: assume mobile → 2 GB, desktop → 4 GB
        return this._checkMobile() ? 2 : 4;
    }

    /** Read the browser's JS heap size limit in bytes, or null if unsupported. */
    _heapLimitBytes() {
        return window.performance?.memory?.jsHeapSizeLimit ?? null;
    }

    /**
     * Decide whether to recommend raising Node's --max-old-space-size.
     * Fires when the JS heap is constrained but the device still has
     * spare physical RAM to spend.
     *
     * Suggested size ≈ 50% of total RAM, rounded to the nearest GB,
     * with a 2 GB floor (so an 8 GB machine → 4096 MB, 4 GB → 2048 MB).
     *
     * @param {number|null} heapLimitBytes  current heap ceiling (bytes)
     * @param {number}      deviceMemoryGB  total RAM in GB (coarse, capped at 8 by the browser)
     * @returns {{ show:boolean, suggestedMB:number, currentLimitMB:number|null, deviceMemoryGB:number, command:string }}
     */
    _calcHeapBoost(heapLimitBytes, deviceMemoryGB) {
        const ramMB          = deviceMemoryGB * 1024;
        const currentLimitMB = heapLimitBytes ? Math.round(heapLimitBytes / 1024 / 1024) : null;

        // ~50% of RAM, rounded to the nearest 1 GB, never below 2 GB.
        let suggestedMB = Math.round((ramMB * 0.5) / 1024) * 1024;
        suggestedMB = Math.max(suggestedMB, 2048);

        // Only nudge when there's meaningful headroom to gain:
        //   • the machine has spare RAM (≥ 4 GB), and
        //   • the suggestion is at least ~1 GB above the current ceiling.
        const hasSpareRam = deviceMemoryGB >= 4;
        const worthIt     = currentLimitMB == null || suggestedMB >= currentLimitMB + 1024;
        const show        = hasSpareRam && worthIt;

        return {
            show,
            suggestedMB,
            currentLimitMB,
            deviceMemoryGB,
            command: `echo "export NODE_OPTIONS=--max-old-space-size=${suggestedMB}" >> ~/.bashrc`,
        };
    }

    async _measureFPS() {
        return new Promise(resolve => {
            let frames = 0;
            const start = performance.now();
            const SAMPLE_MS = 500;

            const tick = () => {
                frames++;
                if (performance.now() - start < SAMPLE_MS) {
                    requestAnimationFrame(tick);
                } else {
                    resolve((frames / SAMPLE_MS) * 1000);
                }
            };
            requestAnimationFrame(tick);
        });
    }

    /**
     * Compute a 0–16 device capability score.
     *   RAM   → 0–6 pts
     *   Cores → 0–5 pts
     *   FPS   → 0–5 pts
     *   Mobile penalty → −2 pts
     * @returns {number} clamped to [0, DeviceDetector.MAX_SCORE]
     */
    _calcScore(memory, cores, isMobile, fps) {
        let score = 0;

        // RAM (0–6 pts)
        if      (memory >= 8) score += 6;
        else if (memory >= 4) score += 4;
        else if (memory >= 2) score += 2;
        else                  score += 1;

        // CPU cores (0–5 pts)
        score += Math.min(cores, 5);

        // FPS (0–5 pts)
        if      (fps >= 55) score += 5;
        else if (fps >= 30) score += 3;
        else                score += 1;

        // Mobile penalty (−2 pts)
        if (isMobile) score -= 2;

        return Math.max(0, Math.min(DeviceDetector.MAX_SCORE, score));
    }
}
