/**
 * @module DeviceDetector
 * Detects device capabilities and assigns a performance tier.
 * Tiers: "low" | "medium" | "good" | "high"
 *
 * Mobile + low deviceMemory is weighted heavily — phones report
 * navigator.deviceMemory capped (often 0.5–4) and share RAM with the OS.
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
     * On mobile Chrome the heap ceiling is often ~1–2 GB even on
     * "flagship" phones, so thresholds are lower than desktop.
     *   < 1.5 GB → LOW
     *   < 2.5 GB → MEDIUM
     *   < 4   GB → GOOD
     *   ≥ 4   GB → HIGH
     * @param {number|null} heapLimitBytes
     * @param {boolean} isMobile
     * @returns {string|null}
     */
    static tierFromHeapLimit(heapLimitBytes, isMobile = false) {
        if (!heapLimitBytes) return null;
        const gb = heapLimitBytes / DeviceDetector.GB;
        if (isMobile) {
            // Mobile Chromium is heap-constrained; be stricter.
            if (gb < 1.5) return DeviceDetector.TIER.LOW;
            if (gb < 2.5) return DeviceDetector.TIER.MEDIUM;
            if (gb < 4)   return DeviceDetector.TIER.GOOD;
            return DeviceDetector.TIER.HIGH;
        }
        if (gb < 2) return DeviceDetector.TIER.LOW;
        if (gb < 4) return DeviceDetector.TIER.MEDIUM;
        return DeviceDetector.TIER.HIGH;
    }

    constructor() {
        this._profile = null;
    }

    /**
     * Run all detection checks and return a full device profile.
     * @returns {Promise<object>}
     */
    async detect() {
        const memory    = navigator.deviceMemory ?? this._guessMemory();
        const cores     = navigator.hardwareConcurrency ?? 2;
        const isMobile  = this._checkMobile();
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const lowPower  = await this._checkBattery();
        const fps       = await this._measureFPS();
        const conn      = this._connectionInfo();

        const heapLimitBytes = this._heapLimitBytes();
        const score     = this._calcScore(memory, cores, isMobile, fps, conn);
        const heapTier  = DeviceDetector.tierFromHeapLimit(heapLimitBytes, isMobile);
        let   tier      = heapTier ?? DeviceDetector.tierFromScore(score);

        // Hard floor: very low deviceMemory on a phone is always LOW,
        // even if the score/FPS sample looked fine during idle boot.
        if (isMobile && memory > 0 && memory <= 2) {
            tier = DeviceDetector.TIER.LOW;
        } else if (isMobile && memory > 0 && memory <= 4 && tier === DeviceDetector.TIER.HIGH) {
            tier = DeviceDetector.TIER.GOOD; // cap flagship phones at GOOD by default
        }

        // Low battery + mobile → at least drop one tier
        if (lowPower && isMobile && tier === DeviceDetector.TIER.HIGH) {
            tier = DeviceDetector.TIER.GOOD;
        } else if (lowPower && isMobile && tier === DeviceDetector.TIER.GOOD) {
            tier = DeviceDetector.TIER.MEDIUM;
        }

        const heapBoost = this._calcHeapBoost(heapLimitBytes, memory);

        this._profile = {
            memory, cores, isMobile, reducedMotion, lowPower,
            fps: Math.round(fps),
            score,
            heapLimitMB: heapLimitBytes ? Math.round(heapLimitBytes / 1024 / 1024) : null,
            connection: conn,
            tier,
            tierSource: (isMobile && memory <= 2) ? "mobile-ram"
                : heapTier ? "heap" : "score",
            tierLabel: DeviceDetector.TIER_LABEL[tier],
            heapBoost,
        };
        return this._profile;
    }

    get profile() { return this._profile; }

    /** Return settings recommended for the detected tier. */
    getRecommendedSettings() {
        const tier = this._profile?.tier ?? DeviceDetector.TIER.MEDIUM;
        const isMobile = !!this._profile?.isMobile;

        const map = {
            [DeviceDetector.TIER.LOW]: {
                aggressiveVirtualization: true,
                reduceAnimations:         true,
                disableBlur:              true,
                disableShadows:           true,
                disableTransitions:       true,
                freezeBackground:         true,
                collapseOldMedia:         true,
                heapThreshold:            0.70,
                messageCountThreshold:    200,
                keepViewportMult:         2,
                maxOffscreenMessages:     30,
                scrollThrottleMs:         50,
            },
            [DeviceDetector.TIER.MEDIUM]: {
                aggressiveVirtualization: isMobile,
                reduceAnimations:         isMobile,
                disableBlur:              isMobile,
                disableShadows:           false,
                disableTransitions:       false,
                freezeBackground:         false,
                collapseOldMedia:         false,
                heapThreshold:            0.75,
                messageCountThreshold:    300,
                keepViewportMult:         2.5,
                maxOffscreenMessages:     60,
                scrollThrottleMs:         16,
            },
            [DeviceDetector.TIER.GOOD]: {
                aggressiveVirtualization: false,
                reduceAnimations:         false,
                disableBlur:              false,
                disableShadows:           false,
                disableTransitions:       false,
                freezeBackground:         false,
                collapseOldMedia:         false,
                heapThreshold:            0.80,
                messageCountThreshold:    500,
                keepViewportMult:         3,
                maxOffscreenMessages:     90,
                scrollThrottleMs:         12,
            },
            [DeviceDetector.TIER.HIGH]: {
                aggressiveVirtualization: false,
                reduceAnimations:         false,
                disableBlur:              false,
                disableShadows:           false,
                disableTransitions:       false,
                freezeBackground:         false,
                collapseOldMedia:         false,
                heapThreshold:            0.85,
                messageCountThreshold:    800,
                keepViewportMult:         4,
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
        // matchMedia coarse pointer is a strong mobile/tablet signal
        const coarse = window.matchMedia("(pointer: coarse)").matches;
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
            || touchPad
            || (coarse && window.screen.width < 900);
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
        return this._checkMobile() ? 2 : 4;
    }

    _heapLimitBytes() {
        return window.performance?.memory?.jsHeapSizeLimit ?? null;
    }

    _connectionInfo() {
        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return null;
        return {
            effectiveType: c.effectiveType || null,
            saveData: !!c.saveData,
            downlink: typeof c.downlink === "number" ? c.downlink : null,
        };
    }

    /**
     * Decide whether to recommend raising Node's --max-old-space-size.
     * Only meaningful on the HOST machine (Termux / desktop server), not the
     * phone browser viewing a remote ST instance.
     */
    _calcHeapBoost(heapLimitBytes, deviceMemoryGB) {
        const ramMB          = deviceMemoryGB * 1024;
        const currentLimitMB = heapLimitBytes ? Math.round(heapLimitBytes / 1024 / 1024) : null;

        let suggestedMB = Math.round((ramMB * 0.5) / 1024) * 1024;
        suggestedMB = Math.max(suggestedMB, 2048);

        const hasSpareRam = deviceMemoryGB >= 4;
        const worthIt     = currentLimitMB == null || suggestedMB >= currentLimitMB + 1024;
        // Don't recommend Node heap boost from a pure mobile browser session
        // unless deviceMemory reports ≥ 4 (rare; usually Termux-on-tablet).
        const show        = hasSpareRam && worthIt && !this._checkMobile();

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
            const SAMPLE_MS = 400;

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
     *   saveData / 2g-3g → −1 pt
     */
    _calcScore(memory, cores, isMobile, fps, conn) {
        let score = 0;

        if      (memory >= 8) score += 6;
        else if (memory >= 4) score += 4;
        else if (memory >= 2) score += 2;
        else                  score += 1;

        score += Math.min(cores, 5);

        if      (fps >= 55) score += 5;
        else if (fps >= 30) score += 3;
        else                score += 1;

        if (isMobile) score -= 2;

        if (conn?.saveData) score -= 1;
        if (conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") score -= 2;
        else if (conn?.effectiveType === "3g") score -= 1;

        return Math.max(0, Math.min(DeviceDetector.MAX_SCORE, score));
    }
}
