/**
 * SillyTavern Performance Boost — Main Entry Point
 *
 * Coordinates all sub-modules and integrates with SillyTavern's extension API.
 *
 * Import paths assume the extension is installed at:
 *   SillyTavern/public/scripts/extensions/third-party/performance-boost/
 *
 * If ST cannot resolve these imports, adjust the depth:
 *   ../../extensions.js  →  3 levels up  →  ../../../extensions.js
 *   ../../../script.js   →  4 levels up  →  ../../../../script.js
 */

import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, eventTypes }                   from "../../../../script.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const EXT_NAME = "performance-boost";
const EXT_PATH = `scripts/extensions/third-party/${EXT_NAME}`;
const LOG      = "[⚡ PerfBoost]";

// ═══════════════════════════════════════════════════════════════════════════════
// Default Settings
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
    enabled:    true,
    autoDetect: true,
    deviceTier: "auto",   // "auto" | "low" | "medium" | "high"

    virtualScroll: {
        enabled:        true,
        aggressiveMode: false,
    },
    imageOptimizer: {
        enabled: true,
    },
    scrollOptimizer: {
        enabled: true,
    },
    animationController: {
        enabled:              false,  // auto-enabled for LOW tier
        respectsReducedMotion: true,
        disableBlur:          false,
        disableShadows:       false,
        disableTransitions:   false,
    },
    memoryMonitor: {
        enabled:                 true,
        checkInterval:           30_000,
        heapThreshold:           0.80,
        messageCountThreshold:   500,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime State
// ═══════════════════════════════════════════════════════════════════════════════

const state = {
    initialized:   false,
    deviceProfile: null,
    appliedTier:   null,
    modules: {
        virtualScroll:       null,
        imageOptimizer:      null,
        scrollOptimizer:     null,
        animationController: null,
        memoryMonitor:       null,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Settings helpers
// ═══════════════════════════════════════════════════════════════════════════════

function loadSettings() {
    extension_settings[EXT_NAME] ??= {};
    _deepMergeDefaults(extension_settings[EXT_NAME], DEFAULTS);
}

function cfg() {
    return extension_settings[EXT_NAME];
}

function _deepMergeDefaults(target, defaults) {
    for (const k of Object.keys(defaults)) {
        if (defaults[k] !== null && typeof defaults[k] === "object" && !Array.isArray(defaults[k])) {
            target[k] ??= {};
            _deepMergeDefaults(target[k], defaults[k]);
        } else {
            target[k] ??= defaults[k];
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════════

async function boot() {
    loadSettings();
    await _loadSettingsPanel();

    if (cfg().autoDetect) {
        await _detectDevice();
    } else {
        state.appliedTier = cfg().deviceTier;
        _applyTierClass(state.appliedTier);
    }

    if (cfg().enabled) {
        await _startModules();
    }

    _bindSTEvents();
    state.initialized = true;
    _syncUI();

    console.log(
        `${LOG} Ready — tier: ${state.appliedTier ?? cfg().deviceTier}` +
        (state.deviceProfile
            ? ` | ${state.deviceProfile.memory}GB / ${state.deviceProfile.cores}core` +
              ` | ${state.deviceProfile.isMobile ? "📱" : "🖥️"} | ~${state.deviceProfile.fps} FPS`
            : "")
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Device Detection
// ═══════════════════════════════════════════════════════════════════════════════

async function _detectDevice() {
    try {
        const { DeviceDetector } = await import(`/${EXT_PATH}/src/deviceDetector.js`);
        const detector = new DeviceDetector();
        state.deviceProfile = await detector.detect();
        state.appliedTier   = state.deviceProfile.tier;

        if (cfg().deviceTier === "auto") {
            const rec = detector.getRecommendedSettings();
            // Apply recommended settings only where user hasn't explicitly changed them
            if (rec.aggressiveVirtualization) {
                cfg().virtualScroll.aggressiveMode = true;
            }
            if (rec.reduceAnimations) {
                cfg().animationController.enabled      = true;
                cfg().animationController.disableBlur  = rec.disableBlur  ?? false;
                cfg().animationController.disableShadows = rec.disableShadows ?? false;
            }
            saveSettingsDebounced();
        }

        _applyTierClass(state.appliedTier);
    } catch (err) {
        console.warn(`${LOG} Device detection error:`, err);
    }
}

function _applyTierClass(tier) {
    if (!tier || tier === "auto") return;
    document.body.classList.remove("pb-tier-low", "pb-tier-medium", "pb-tier-high");
    document.body.classList.add(`pb-tier-${tier}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module Management
// ═══════════════════════════════════════════════════════════════════════════════

const MODULE_DEFS = {
    virtualScroll: {
        file:  "virtualScroll.js",
        Class: "VirtualScroll",
        start: (m) => m.init(),
    },
    imageOptimizer: {
        file:  "imageOptimizer.js",
        Class: "ImageOptimizer",
        start: (m) => m.init(),
    },
    scrollOptimizer: {
        file:  "scrollOptimizer.js",
        Class: "ScrollOptimizer",
        start: (m) => m.init(),
    },
    animationController: {
        file:  "animationController.js",
        Class: "AnimationController",
        start: (m) => m.init(),
    },
    memoryMonitor: {
        file:  "memoryMonitor.js",
        Class: "MemoryMonitor",
        start: (m) => m.start(),
        extraArgs: () => [_onMemoryPressure],
    },
};

async function _startModules() {
    for (const [name, def] of Object.entries(MODULE_DEFS)) {
        await _startModule(name, def);
    }
}

async function _startModule(name, def) {
    const modCfg = cfg()[name];
    if (!modCfg?.enabled) return;

    try {
        const mod = await import(`/${EXT_PATH}/src/${def.file}`);
        const extra = def.extraArgs ? def.extraArgs() : [];
        const instance = new mod[def.Class](modCfg, ...extra);
        def.start(instance);
        state.modules[name] = instance;
    } catch (err) {
        console.error(`${LOG} Failed to start ${name}:`, err);
    }
}

function _destroyModules() {
    for (const [name, mod] of Object.entries(state.modules)) {
        try { mod?.destroy?.(); } catch { /* ignore */ }
        state.modules[name] = null;
    }
}

/** Restart a single module (used when a toggle changes in settings). */
async function _restartModule(name) {
    try { state.modules[name]?.destroy?.(); } catch { /* ignore */ }
    state.modules[name] = null;
    await _startModule(name, MODULE_DEFS[name]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory Pressure Handler
// ═══════════════════════════════════════════════════════════════════════════════

function _onMemoryPressure(info) {
    console.warn(`${LOG} Memory pressure!`, info);

    // Escalate virtual scroll to aggressive mode
    state.modules.virtualScroll?.setAggressiveMode?.(true);

    // Suggest browser GC (non-standard, may not be available)
    window.gc?.();

    // Toast notification (ST includes toastr)
    toastr?.warning(
        `Memory pressure detected (${info.reason}).`,
        "Performance Boost",
        { timeOut: 4000, positionClass: "toast-bottom-right" }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SillyTavern Event Hooks
// ═══════════════════════════════════════════════════════════════════════════════

function _bindSTEvents() {
    eventSource.on(eventTypes.CHAT_CHANGED, _onChatChanged);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, _onNewMessage);
    eventSource.on(eventTypes.MESSAGE_SENT, _onNewMessage);
}

function _onChatChanged() {
    state.modules.virtualScroll?.onChatChanged?.();
    setTimeout(() => state.modules.imageOptimizer?.scanImages?.(), 300);
}

function _onNewMessage() {
    setTimeout(() => {
        state.modules.imageOptimizer?.scanImages?.();
        state.modules.virtualScroll?.onMessageAdded?.();
    }, 120);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings Panel
// ═══════════════════════════════════════════════════════════════════════════════

async function _loadSettingsPanel() {
    try {
        const html = await fetch(`/${EXT_PATH}/settings.html`).then(r => r.text());
        $("#extensions_settings").append(html);
        _bindSettingsUI();
    } catch (err) {
        console.warn(`${LOG} Could not load settings panel:`, err);
    }
}

function _bindSettingsUI() {
    // Master enable/disable
    $("#pb-enabled").on("change", function () {
        cfg().enabled = this.checked;
        saveSettingsDebounced();
        this.checked ? _startModules() : _destroyModules();
    });

    // Auto-detect
    $("#pb-auto-detect").on("change", async function () {
        cfg().autoDetect = this.checked;
        saveSettingsDebounced();
        if (this.checked) {
            await _detectDevice();
            _syncUI();
        }
    });

    // Manual tier override
    $("#pb-device-tier").on("change", function () {
        cfg().deviceTier = this.value;
        if (this.value !== "auto") {
            state.appliedTier = this.value;
            _applyTierClass(this.value);
        }
        saveSettingsDebounced();
    });

    // Per-module toggles
    const moduleToggles = {
        "#pb-virtual-scroll":        "virtualScroll",
        "#pb-lazy-images":           "imageOptimizer",
        "#pb-scroll-optimizer":      "scrollOptimizer",
        "#pb-reduce-animations":     "animationController",
        "#pb-memory-monitor":        "memoryMonitor",
    };

    for (const [sel, modName] of Object.entries(moduleToggles)) {
        $(sel).on("change", function () {
            cfg()[modName].enabled = this.checked;
            saveSettingsDebounced();
            _restartModule(modName);
        });
    }

    // Aggressive mode
    $("#pb-aggressive-mode").on("change", function () {
        cfg().virtualScroll.aggressiveMode = this.checked;
        saveSettingsDebounced();
        state.modules.virtualScroll?.setAggressiveMode?.(this.checked);
    });

    // Re-detect button
    $("#pb-redetect-btn").on("click", async function () {
        $(this).prop("disabled", true).text("Detecting…");
        await _detectDevice();
        _syncUI();
        $(this).prop("disabled", false).text("Re-detect Device");
    });
}

function _syncUI() {
    const s = cfg();

    _setCheck("#pb-enabled",           s.enabled);
    _setCheck("#pb-auto-detect",       s.autoDetect);
    _setCheck("#pb-virtual-scroll",    s.virtualScroll.enabled);
    _setCheck("#pb-aggressive-mode",   s.virtualScroll.aggressiveMode);
    _setCheck("#pb-lazy-images",       s.imageOptimizer.enabled);
    _setCheck("#pb-scroll-optimizer",  s.scrollOptimizer.enabled);
    _setCheck("#pb-reduce-animations", s.animationController.enabled);
    _setCheck("#pb-memory-monitor",    s.memoryMonitor.enabled);
    $("#pb-device-tier").val(s.deviceTier);

    if (state.deviceProfile) {
        const p = state.deviceProfile;
        const tierLabel = p.tier.toUpperCase();
        const type      = p.isMobile ? "📱 Mobile" : "🖥️ Desktop";
        $("#pb-device-info-text").text(
            `${tierLabel} tier · ${p.memory} GB RAM · ${p.cores} cores · ${type} · ~${p.fps} FPS`
        );
        $("#pb-device-info").show();
    }
}

function _setCheck(sel, val) {
    $(sel).prop("checked", !!val);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(() => { boot().catch(err => console.error(`${LOG} Boot error:`, err)); });
