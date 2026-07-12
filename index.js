import { extension_settings } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const { saveSettingsDebounced } = SillyTavern.getContext();

const EXT_NAME = "SillyTavern-Performance-Boost";
const EXT_PATH = `scripts/extensions/third-party/${EXT_NAME}`;
const LOG      = "[⚡ PerfBoost]";

/**
 * Defaults tuned for low-RAM phones first (official ST FAQ + Android Termux tips):
 *  - Fast UI / no blur, reduced motion, low streaming FPS, chat truncation
 *  - Aggressive virtual scroll + image detach + idle pause
 * Desktop / high tiers can still auto-relax via DeviceDetector.
 */
const DEFAULTS = {
    enabled:    true,
    autoDetect: true,
    deviceTier: "auto",

    // Apply ST's own power_user knobs on boot (Fast UI, streaming FPS, etc.)
    stCoreHints: {
        enabled: true,
        applyOnBoot: true,
    },

    messageVirtualization: {
        enabled: true,
        aggressiveMode: false, // auto-on for low tier
    },
    imageOptimizer: {
        enabled: true,
        rootMarginPx: 120,
        deferAvatars: true,
    },
    scrollOptimizer: { enabled: true },
    animationReducer: {
        enabled: false,
        respectsReducedMotion: true,
        disableBlur: false,
        disableShadows: false,
        disableTransitions: false,
    },
    memoryManager: {
        enabled: true,
        checkInterval: 30_000,
        heapThreshold: 0.75,          // slightly tighter than 0.80 for phones
        messageCountThreshold: 300,   // lower than 500 — phones choke earlier
        pauseWhenHidden: true,
    },
    idleGuard: {
        enabled: true,
        pauseWhenHidden: true,
        lowBatteryMode: true,
        freezeBackground: false, // auto-on for low tier
    },
    domJanitor: {
        enabled: true,
        detachFarImages: true,
        keepViewportMult: 2.5,
        sweepIntervalMs: 40_000,
        collapseOldMedia: false, // auto-on for low tier under pressure
        mediaKeepLast: 60,
    },
};

const state = {
    initialized:   false,
    deviceProfile: null,
    appliedTier:   null,
    modules: {
        messageVirtualization: null,
        imageOptimizer:        null,
        scrollOptimizer:       null,
        animationReducer:      null,
        memoryManager:         null,
        stCoreHints:           null,
        idleGuard:             null,
        domJanitor:            null,
    },
};

let settingsPanel = null;

function loadSettings() {
    extension_settings[EXT_NAME] ??= {};
    _deepMergeDefaults(extension_settings[EXT_NAME], DEFAULTS);
}

function cfg() { return extension_settings[EXT_NAME]; }

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

async function boot() {
    loadSettings();

    const { SettingsPanel } = await import(`/${EXT_PATH}/src/ui/settingsPanel.js`);
    settingsPanel = new SettingsPanel(state, {
        EXT_PATH,
        cfg,
        saveSettings: saveSettingsDebounced,
        detectDevice: _detectDevice,
        startModules: _startModules,
        destroyModules: _destroyModules,
        restartModule: _restartModule,
        applyTierClass: _applyTierClass,
        applyPhoneSaver: _applyPhoneSaver,
        applyStHints: _applyStHints,
        forceMemoryClean: _forceMemoryClean,
    });

    await settingsPanel.load();

    if (cfg().autoDetect) {
        await _detectDevice();
    } else {
        state.appliedTier = cfg().deviceTier === "auto" ? "medium" : cfg().deviceTier;
        _applyTierClass(state.appliedTier);
    }

    if (cfg().enabled) await _startModules();

    _bindSTEvents();
    state.initialized = true;
    settingsPanel.sync();

    console.log(`${LOG} Ready — tier: ${state.appliedTier ?? cfg().deviceTier}`);
}

async function _detectDevice() {
    try {
        const { DeviceDetector } = await import(`/${EXT_PATH}/src/core/deviceDetector.js`);
        const detector = new DeviceDetector();
        state.deviceProfile = await detector.detect();
        state.appliedTier   = state.deviceProfile.tier;

        if (cfg().deviceTier === "auto") {
            const rec = detector.getRecommendedSettings();
            _applyRecommended(rec);
            saveSettingsDebounced();
        }
        _applyTierClass(state.appliedTier);

        // Heap is tight but the machine has spare RAM → offer a NODE_OPTIONS boost.
        settingsPanel?.maybeShowHeapBoost?.(state.deviceProfile.heapBoost);
    } catch (err) {
        console.warn(`${LOG} Device detection error:`, err);
    }
}

function _applyRecommended(rec) {
    if (!rec) return;
    if (rec.aggressiveVirtualization) cfg().messageVirtualization.aggressiveMode = true;
    if (rec.reduceAnimations) {
        cfg().animationReducer.enabled         = true;
        cfg().animationReducer.disableBlur     = rec.disableBlur     ?? true;
        cfg().animationReducer.disableShadows  = rec.disableShadows  ?? true;
        cfg().animationReducer.disableTransitions = rec.disableTransitions ?? false;
    }
    if (rec.freezeBackground != null) {
        cfg().idleGuard.freezeBackground = !!rec.freezeBackground;
    }
    if (rec.collapseOldMedia != null) {
        cfg().domJanitor.collapseOldMedia = !!rec.collapseOldMedia;
    }
    if (rec.heapThreshold != null) {
        cfg().memoryManager.heapThreshold = rec.heapThreshold;
    }
    if (rec.messageCountThreshold != null) {
        cfg().memoryManager.messageCountThreshold = rec.messageCountThreshold;
    }
    if (rec.keepViewportMult != null) {
        cfg().domJanitor.keepViewportMult = rec.keepViewportMult;
    }
}

function _applyTierClass(tier) {
    if (!tier || tier === "auto") return;
    document.body.classList.remove("pb-tier-low", "pb-tier-medium", "pb-tier-good", "pb-tier-high");
    document.body.classList.add(`pb-tier-${tier}`);
}

const MODULE_DEFS = {
    stCoreHints: {
        path: "optimizations/stCoreHints.js",
        Class: "StCoreHints",
        start: (m) => m.init(),
        extraArgs: () => [
            () => state.appliedTier || "medium",
            saveSettingsDebounced,
        ],
    },
    messageVirtualization: {
        path: "optimizations/virtualScroll.js",
        Class: "VirtualScroll",
        start: (m) => m.init(),
    },
    imageOptimizer: {
        path: "optimizations/imageOptimizer.js",
        Class: "ImageOptimizer",
        start: (m) => m.init(),
    },
    scrollOptimizer: {
        path: "optimizations/scrollOptimizer.js",
        Class: "ScrollOptimizer",
        start: (m) => m.init(),
    },
    animationReducer: {
        path: "optimizations/animationController.js",
        Class: "AnimationController",
        start: (m) => m.init(),
    },
    memoryManager: {
        path: "core/memoryMonitor.js",
        Class: "MemoryMonitor",
        start: (m) => m.start(),
        extraArgs: () => [_onMemoryPressure],
    },
    idleGuard: {
        path: "optimizations/idleGuard.js",
        Class: "IdleGuard",
        start: (m) => m.init(),
        extraArgs: () => [
            () => _onTabHidden(),
            () => _onTabVisible(),
        ],
    },
    domJanitor: {
        path: "optimizations/domJanitor.js",
        Class: "DomJanitor",
        start: (m) => m.init(),
    },
};

// Start order matters: idleGuard early so other modules can be paused; stCoreHints early for ST knobs
const MODULE_ORDER = [
    "stCoreHints",
    "idleGuard",
    "messageVirtualization",
    "imageOptimizer",
    "scrollOptimizer",
    "animationReducer",
    "domJanitor",
    "memoryManager",
];

async function _startModules() {
    for (const name of MODULE_ORDER) {
        await _startModule(name, MODULE_DEFS[name]);
    }
}

async function _startModule(name, def) {
    if (!def) return;
    const modCfg = cfg()[name];
    // Modules without an enabled flag always run when master is on
    if (modCfg && modCfg.enabled === false) return;
    try {
        const mod = await import(`/${EXT_PATH}/src/${def.path}`);
        const extra = def.extraArgs ? def.extraArgs() : [];
        const instance = new mod[def.Class](modCfg || {}, ...extra);
        // stCoreHints.init is async (dynamic import of power_user) — always await
        await def.start(instance);
        state.modules[name] = instance;
    } catch (err) {
        console.error(`${LOG} Failed to start ${name}:`, err);
    }
}

function _destroyModules() {
    // Reverse order
    for (const name of [...MODULE_ORDER].reverse()) {
        try { state.modules[name]?.destroy?.(); } catch { /* ignore */ }
        state.modules[name] = null;
    }
    // Catch any leftover keys
    for (const name of Object.keys(state.modules)) {
        if (state.modules[name]) {
            try { state.modules[name]?.destroy?.(); } catch { /* ignore */ }
            state.modules[name] = null;
        }
    }
}

async function _restartModule(name) {
    try { state.modules[name]?.destroy?.(); } catch { /* ignore */ }
    state.modules[name] = null;
    await _startModule(name, MODULE_DEFS[name]);
}

function _onTabHidden() {
    state.modules.memoryManager?.pause?.();
    state.modules.domJanitor?.pause?.();
    settingsPanel?.pauseLiveUi?.();
}

function _onTabVisible() {
    state.modules.memoryManager?.resume?.();
    state.modules.domJanitor?.resume?.();
    settingsPanel?.resumeLiveUi?.();
    // Re-scan after resume — chat may have grown while hidden
    setTimeout(() => {
        state.modules.imageOptimizer?.scanImages?.();
        state.modules.domJanitor?.scan?.();
        state.modules.messageVirtualization?.onMessageAdded?.();
    }, 200);
}

function _onMemoryPressure(info) {
    console.warn(`${LOG} Memory pressure!`, info);

    // Escalate virtualization
    state.modules.messageVirtualization?.setAggressiveMode?.(true);
    cfg().messageVirtualization.aggressiveMode = true;

    // Detach far images immediately
    state.modules.domJanitor?.forceDetachAll?.();

    // Collapse old media under heap pressure
    if (info.reason === "heap") {
        cfg().domJanitor.collapseOldMedia = true;
        state.modules.domJanitor?.scan?.();
        // Restart janitor with collapse on if it wasn't
        if (state.modules.domJanitor && !state.modules.domJanitor.cfg.collapseOldMedia) {
            state.modules.domJanitor.cfg.collapseOldMedia = true;
        }
    }

    // Soft GC if exposed (Chrome with --js-flags=--expose-gc only)
    try { window.gc?.(); } catch { /* ignore */ }

    saveSettingsDebounced();
    settingsPanel?.sync?.();

    toastr?.warning(
        `Memory pressure (${info.reason}). Aggressive mode + image detach active.`,
        "Performance Boost",
        { timeOut: 4500, positionClass: "toast-bottom-right" },
    );
}

function _applyPhoneSaver() {
    // One-tap low-end phone profile
    state.appliedTier = "low";
    cfg().deviceTier = "low";
    cfg().autoDetect = false;
    _applyTierClass("low");

    cfg().messageVirtualization.enabled = true;
    cfg().messageVirtualization.aggressiveMode = true;
    cfg().imageOptimizer.enabled = true;
    cfg().scrollOptimizer.enabled = true;
    cfg().animationReducer.enabled = true;
    cfg().animationReducer.disableBlur = true;
    cfg().animationReducer.disableShadows = true;
    cfg().animationReducer.disableTransitions = true;
    cfg().memoryManager.enabled = true;
    cfg().memoryManager.heapThreshold = 0.70;
    cfg().memoryManager.messageCountThreshold = 200;
    cfg().idleGuard.enabled = true;
    cfg().idleGuard.freezeBackground = true;
    cfg().idleGuard.lowBatteryMode = true;
    cfg().domJanitor.enabled = true;
    cfg().domJanitor.detachFarImages = true;
    cfg().domJanitor.collapseOldMedia = true;
    cfg().domJanitor.keepViewportMult = 2;
    cfg().stCoreHints.enabled = true;

    saveSettingsDebounced();

    // Apply ST core knobs (Fast UI, streaming FPS 12, chat_truncation 40, etc.)
    if (state.modules.stCoreHints) {
        state.modules.stCoreHints.applyPhoneSaver();
    } else {
        // Module not up yet — will apply on start
        cfg().stCoreHints.applyOnBoot = true;
    }

    // Hot-restart modules so new flags stick
    _destroyModules();
    return _startModules().then(() => {
        settingsPanel?.sync?.();
        toastr?.success("Phone Saver profile applied.", "Performance Boost", {
            timeOut: 3000,
            positionClass: "toast-bottom-right",
        });
    });
}

function _applyStHints() {
    const tier = state.appliedTier || "low";
    if (state.modules.stCoreHints) {
        return state.modules.stCoreHints.applyForTier(tier, { force: true });
    }
    return null;
}

function _forceMemoryClean() {
    state.modules.messageVirtualization?.setAggressiveMode?.(true);
    const n = state.modules.domJanitor?.forceDetachAll?.() ?? 0;
    try { window.gc?.(); } catch { /* ignore */ }
    toastr?.info(`Cleaned: detached ${n} far images.`, "Performance Boost", {
        timeOut: 2500,
        positionClass: "toast-bottom-right",
    });
    settingsPanel?.sync?.();
    return n;
}

function _bindSTEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        state.modules.messageVirtualization?.onChatChanged?.();
        setTimeout(() => {
            state.modules.imageOptimizer?.scanImages?.();
            state.modules.domJanitor?.scan?.();
        }, 300);
    });
    const onNewMsg = () => setTimeout(() => {
        state.modules.imageOptimizer?.scanImages?.();
        state.modules.messageVirtualization?.onMessageAdded?.();
        state.modules.domJanitor?.scan?.();
    }, 120);
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMsg);
    eventSource.on(event_types.MESSAGE_SENT, onNewMsg);
}

jQuery(() => { boot().catch(err => console.error(`${LOG} Boot error:`, err)); });
