/**
 * @module DeviceDetector
 * Detects device capabilities and assigns a performance tier.
 * Tiers: "low" | "medium" | "high"
 */

export class DeviceDetector {
    static TIER = {
        LOW:    "low",    // ≤1 GB RAM or weak mobile chipset
        MEDIUM: "medium", // 2–3 GB RAM
        HIGH:   "high",   // 4+ GB RAM
    };

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
        const tier      = this._calcTier(memory, cores, isMobile, fps);

        this._profile = { memory, cores, isMobile, reducedMotion, lowPower, fps: Math.round(fps), tier };
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

    _calcTier(memory, cores, isMobile, fps) {
        // Score: 0–100
        let score = 0;

        // Memory (0–35 pts)
        if      (memory >= 8) score += 35;
        else if (memory >= 4) score += 25;
        else if (memory >= 2) score += 12;
        else                  score +=  4;

        // CPU cores (0–30 pts)
        score += Math.min(cores * 3, 30);

        // Mobile penalty (−12 pts)
        if (isMobile) score -= 12;

        // FPS (0–35 pts)
        if      (fps >= 55) score += 35;
        else if (fps >= 30) score += 18;
        else                score +=  5;

        score = Math.max(0, Math.min(100, score));

        if (score < 32) return DeviceDetector.TIER.LOW;
        if (score < 65) return DeviceDetector.TIER.MEDIUM;
        return DeviceDetector.TIER.HIGH;
    }
}
