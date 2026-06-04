import { extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, eventTypes }                   from "../../../../script.js";

const EXT_NAME = "SillyTavern-Performance-Boost";
const EXT_PATH = `scripts/extensions/third-party/${EXT_NAME}`;
const LOG      = "[⚡ PerfBoost]";

// Adjusted defaults to match the new file names
const DEFAULTS = {
    enabled:    true,
    autoDetect: true,
    deviceTier: "auto", 

    messageVirtualization: { enabled: true, aggressiveMode: false },
    imageOptimizer:        { enabled: true },
    scrollOptimizer:       { enabled: true },
    animationReducer:      { enabled: false, respectsReducedMotion: true, disableBlur: false, disableShadows: false, disableTransitions: false },
    memoryManager:         { enabled: true, checkInterval: 30_000, heapThreshold: 0.80, messageCountThreshold: 500 },
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
    },
};

let settingsPanel = null; // UI Controller instance

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
    
    // Load UI Component dynamically
    const { SettingsPanel } = await import(`/${EXT_PATH}/src/ui/settingsPanel.js`);
    settingsPanel = new SettingsPanel(state, {
        EXT_PATH, cfg, saveSettings: saveSettingsDebounced, 
        detectDevice: _detectDevice, startModules: _startModules, 
        destroyModules: _destroyModules, restartModule: _restartModule, 
        applyTierClass: _applyTierClass
    });
    
    await settingsPanel.load();

    if (cfg().autoDetect) {
        await _detectDevice();
    } else {
        state.appliedTier = cfg().deviceTier;
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
            if (rec.aggressiveVirtualization) cfg()..aggressiveMode = true;
            if (rec.reduceAnimations) {
                cfg().animationReducer.enabled      = true;
                cfg().animationReducer.disableBlur  = rec.disableBlur  ?? false;
                cfg().animationReducer.disableShadows = rec.disableShadows ?? false;
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

// Module map matching the new folder structure
const MODULE_DEFS = {
    messageVirtualization: { path: "optimizations/virtualScroll.js", Class: "VirtualScroll", ... },
    animationReducer:      { path: "optimizations/animationController.js", Class: "AnimationController", ... },
    imageOptimizer:        { path: "optimizations/imageOptimizer.js", Class: "ImageOptimizer", start: (m) => m.init() },
    scrollOptimizer:       { path: "optimizations/scrollOptimizer.js", Class: "ScrollOptimizer", start: (m) => m.init() },
    memoryManager:         { path: "core/memoryManager.js", Class: "MemoryMonitor", start: (m) => m.start(), extraArgs: () => [_onMemoryPressure] },
};

async function _startModules() {
    for (const [name, def] of Object.entries(MODULE_DEFS)) await _startModule(name, def);
}

async function _startModule(name, def) {
    const modCfg = cfg()[name];
    if (!modCfg?.enabled) return;
    try {
        const mod = await import(`/${EXT_PATH}/src/${def.path}`);
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

async function _restartModule(name) {
    try { state.modules[name]?.destroy?.(); } catch { /* ignore */ }
    state.modules[name] = null;
    await _startModule(name, MODULE_DEFS[name]);
}

function _onMemoryPressure(info) {
    console.warn(`${LOG} Memory pressure!`, info);
    state.modules.messageVirtualization?.setAggressiveMode?.(true);
    window.gc?.();
    toastr?.warning(`Memory pressure detected (${info.reason}).`, "Performance Boost", { timeOut: 4000, positionClass: "toast-bottom-right" });
}

function _bindSTEvents() {
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        state.modules.messageVirtualization?.onChatChanged?.();
        setTimeout(() => state.modules.imageOptimizer?.scanImages?.(), 300);
    });
    const onNewMsg = () => setTimeout(() => {
        state.modules.imageOptimizer?.scanImages?.();
        state.modules.messageVirtualization?.onMessageAdded?.();
    }, 120);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, onNewMsg);
    eventSource.on(eventTypes.MESSAGE_SENT, onNewMsg);
}

jQuery(() => { boot().catch(err => console.error(`${LOG} Boot error:`, err)); });
