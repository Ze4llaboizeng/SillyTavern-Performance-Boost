/**
 * @module SettingsPanel
 * Handles the UI bindings and updates for the extension settings panel.
 */
export class SettingsPanel {
    constructor(state, actions) {
        this.state = state;
        this.actions = actions; // Contains callbacks to core functions like saveSettings, restartModule
        this.EXT_PATH = actions.EXT_PATH;
        this._ramTimer = null;
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

            this._bindSections();
            this._bindUI();
            this._startRamMonitor();
        } catch (err) {
            console.warn(`[⚡ PerfBoost] Could not load settings panel:`, err);
        }
    }

    // ─── Collapsible dropdown sections ──────────────────────────────────────

    _bindSections() {
        $("#pb-settings-panel .pb-section-header").off("click.pb").on("click.pb", function () {
            const $section = $(this).closest(".pb-section");
            const collapsed = $section.toggleClass("pb-collapsed").hasClass("pb-collapsed");
            $(this).attr("aria-expanded", String(!collapsed));
        });
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
                if (modName === "animationReducer") self._updateAnimSubState();
            });
        }

        // Aggressive mode for virtualization
        $("#pb-aggressive-mode").on("change", function () {
            cfg().messageVirtualization.aggressiveMode = this.checked;
            saveSettings();
            self.state.modules.messageVirtualization?.setAggressiveMode?.(this.checked);
        });

        // Animation sub-options — update cfg and re-apply the running controller
        const animSubs = {
            "#pb-disable-blur":        "disableBlur",
            "#pb-disable-shadows":     "disableShadows",
            "#pb-disable-transitions": "disableTransitions",
        };

        for (const [sel, key] of Object.entries(animSubs)) {
            $(sel).on("change", function () {
                cfg().animationReducer[key] = this.checked;
                saveSettings();
                self.state.modules.animationReducer?.update?.(cfg().animationReducer);
            });
        }

        // Heap pressure threshold slider (percentage → ratio)
        $("#pb-heap-threshold").on("input", function () {
            const pct = parseInt(this.value, 10);
            $("#pb-heap-threshold-val").text(`${pct}%`);
            cfg().memoryManager.heapThreshold = pct / 100;
            self._renderRamStats(); // refresh marker position immediately
        }).on("change", function () {
            saveSettings();
        });

        // Re-detect button
        $("#pb-redetect-btn").on("click", async function () {
            $(this).prop("disabled", true).text("Detecting…");
            await detectDevice();
            self.sync();
            $(this).prop("disabled", false).text("Re-detect Device");
        });
    }

    // ─── Live RAM monitor ───────────────────────────────────────────────────

    _startRamMonitor() {
        this._renderRamStats();
        clearInterval(this._ramTimer);
        this._ramTimer = setInterval(() => this._renderRamStats(), 1000);
    }

    stopRamMonitor() {
        clearInterval(this._ramTimer);
        this._ramTimer = null;
    }

    /** Read live memory stats directly from browser APIs + DOM (works even if monitor is off). */
    _readMemStats() {
        const cfg = this.actions.cfg();
        const threshold = cfg.memoryManager?.heapThreshold ?? 0.80;
        const mem = window.performance?.memory;
        const messageCount = document.querySelectorAll("#chat .mes").length;

        if (!mem) {
            return { supported: false, usedMB: null, limitMB: null, ratio: null, messageCount, threshold };
        }
        return {
            supported:    true,
            usedMB:       mem.usedJSHeapSize  / 1024 / 1024,
            limitMB:      mem.jsHeapSizeLimit / 1024 / 1024,
            ratio:        mem.usedJSHeapSize  / mem.jsHeapSizeLimit,
            messageCount,
            threshold,
        };
    }

    _renderRamStats() {
        if ($("#pb-ram-monitor").length === 0) return;

        const s = this._readMemStats();
        $("#pb-ram-msg-count").text(String(s.messageCount));

        if (!s.supported) {
            $("#pb-ram-heap-text").text("Not available in this browser");
            $("#pb-ram-bar-fill").css("width", "0%");
            $("#pb-ram-threshold-marker").css("left", "80%");
            return;
        }

        const pct = Math.min(100, Math.round(s.ratio * 100));
        $("#pb-ram-heap-text").text(
            `${s.usedMB.toFixed(0)} / ${s.limitMB.toFixed(0)} MB · ${pct}%`
        );

        const $fill = $("#pb-ram-bar-fill").css("width", `${pct}%`);
        // Colour-code: green < 60%, amber < threshold, red ≥ threshold
        const thr = Math.round(s.threshold * 100);
        $fill.removeClass("pb-ram-ok pb-ram-warn pb-ram-danger");
        if (pct >= thr)      $fill.addClass("pb-ram-danger");
        else if (pct >= 60)  $fill.addClass("pb-ram-warn");
        else                 $fill.addClass("pb-ram-ok");

        $("#pb-ram-threshold-marker").css("left", `${thr}%`);
    }

    /** Enable/disable the animation sub-options based on the master "Reduce Animations" toggle. */
    _updateAnimSubState() {
        const on = !!this.actions.cfg().animationReducer?.enabled;
        $("#pb-anim-suboptions").toggleClass("pb-disabled", !on);
        $("#pb-anim-suboptions input").prop("disabled", !on);
    }

    sync() {
        const s = this.actions.cfg();
        const setCheck = (sel, val) => $(sel).prop("checked", !!val);

        setCheck("#pb-enabled",            s.enabled);
        setCheck("#pb-auto-detect",        s.autoDetect);
        setCheck("#pb-virtual-scroll",     s.messageVirtualization?.enabled);
        setCheck("#pb-aggressive-mode",    s.messageVirtualization?.aggressiveMode);
        setCheck("#pb-lazy-images",        s.imageOptimizer?.enabled);
        setCheck("#pb-scroll-optimizer",   s.scrollOptimizer?.enabled);
        setCheck("#pb-reduce-animations",  s.animationReducer?.enabled);
        setCheck("#pb-disable-blur",       s.animationReducer?.disableBlur);
        setCheck("#pb-disable-shadows",    s.animationReducer?.disableShadows);
        setCheck("#pb-disable-transitions",s.animationReducer?.disableTransitions);
        setCheck("#pb-memory-monitor",     s.memoryManager?.enabled);
        $("#pb-device-tier").val(s.deviceTier);

        const thrPct = Math.round((s.memoryManager?.heapThreshold ?? 0.80) * 100);
        $("#pb-heap-threshold").val(thrPct);
        $("#pb-heap-threshold-val").text(`${thrPct}%`);

        this._updateAnimSubState();
        this._renderRamStats();

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
