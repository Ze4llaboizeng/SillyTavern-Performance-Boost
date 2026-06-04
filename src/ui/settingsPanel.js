/**
 * @module SettingsPanel
 * Handles the UI bindings and updates for the extension settings panel.
 */
export class SettingsPanel {
    constructor(state, actions) {
        this.state = state;
        this.actions = actions; // Contains callbacks to core functions like saveSettings, restartModule
        this.EXT_PATH = actions.EXT_PATH;
    }

    async load() {
        try {
            // FIX: SillyTavern already injects settings.html via manifest.json's "settings" field.
            // Only fetch and append manually if it hasn't been loaded yet (e.g. older ST versions).
            if ($("#pb-settings-panel").length === 0) {
                const html = await fetch(`/${this.EXT_PATH}/settings.html`).then(r => r.text());
                const extensionContainer = $("#extensions_settings");

                if (extensionContainer.length > 0) {
                    extensionContainer.append(html);
                    console.log("[⚡ PerfBoost] Manually appended UI to settings panel.");
                } else {
                    console.warn("[⚡ PerfBoost] Container not found, appending to body as fallback...");
                    $("body").append(`<div id="pb-floating-panel" class="sillytavern-panel">${html}</div>`);
                }
            }

            this._bindUI();
        } catch (err) {
            console.warn(`[⚡ PerfBoost] Could not load settings panel:`, err);
        }
    }

    _bindUI() {
        const { cfg, saveSettings, startModules, destroyModules, detectDevice, restartModule, applyTierClass } = this.actions;
        const self = this;

        // Master toggle
        $("#pb-enabled").on("change", function () {
            cfg().enabled = this.checked;
            saveSettings();
            this.checked ? startModules() : destroyModules();
        });

        // Auto-detect toggle
        $("#pb-auto-detect").on("change", async function () {
            cfg().autoDetect = this.checked;
            saveSettings();
            if (this.checked) {
                await detectDevice();
                self.sync();
            }
        });

        // Manual tier override
        $("#pb-device-tier").on("change", function () {
            cfg().deviceTier = this.value;
            if (this.value !== "auto") {
                self.state.appliedTier = this.value;
                applyTierClass(this.value);
            }
            saveSettings();
        });

        // Per-module toggles
        const moduleToggles = {
            "#pb-virtual-scroll":    "messageVirtualization",
            "#pb-lazy-images":       "imageOptimizer",
            "#pb-scroll-optimizer":  "scrollOptimizer",
            "#pb-reduce-animations": "animationReducer",
            "#pb-memory-monitor":    "memoryManager",
        };

        for (const [sel, modName] of Object.entries(moduleToggles)) {
            $(sel).on("change", function () {
                cfg()[modName].enabled = this.checked;
                saveSettings();
                restartModule(modName);
            });
        }

        // Aggressive mode for virtualization
        $("#pb-aggressive-mode").on("change", function () {
            cfg().messageVirtualization.aggressiveMode = this.checked;
            saveSettings();
            self.state.modules.messageVirtualization?.setAggressiveMode?.(this.checked);
        });

        // Re-detect button
        $("#pb-redetect-btn").on("click", async function () {
            $(this).prop("disabled", true).text("Detecting…");
            await detectDevice();
            self.sync();
            $(this).prop("disabled", false).text("Re-detect Device");
        });
    }

    sync() {
        const s = this.actions.cfg();
        const setCheck = (sel, val) => $(sel).prop("checked", !!val);

        setCheck("#pb-enabled",           s.enabled);
        setCheck("#pb-auto-detect",       s.autoDetect);
        setCheck("#pb-virtual-scroll",    s.messageVirtualization?.enabled);
        setCheck("#pb-aggressive-mode",   s.messageVirtualization?.aggressiveMode);
        setCheck("#pb-lazy-images",       s.imageOptimizer?.enabled);
        setCheck("#pb-scroll-optimizer",  s.scrollOptimizer?.enabled);
        setCheck("#pb-reduce-animations", s.animationReducer?.enabled);
        setCheck("#pb-memory-monitor",    s.memoryManager?.enabled);
        $("#pb-device-tier").val(s.deviceTier);

        if (this.state.deviceProfile) {
            const p = this.state.deviceProfile;
            const tierLabel = p.tier.toUpperCase();
            const type      = p.isMobile ? "📱 Mobile" : "🖥️ Desktop";
            $("#pb-device-info-text").text(
                `${tierLabel} tier · ${p.memory} GB RAM · ${p.cores} cores · ${type} · ~${p.fps} FPS`
            );
            $("#pb-device-info").show();
        }
    }
}
