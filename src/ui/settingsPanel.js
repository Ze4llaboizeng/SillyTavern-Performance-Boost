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
        // localStorage key — lets the user dismiss the heap-boost tip permanently.
        this._boostDismissKey = "pb-heap-boost-dismissed";
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
            const label    = p.tierLabel ? ` (${p.tierLabel})` : "";
            const tierText = `${p.tier.toUpperCase()}${label}`;
            const scoreText = (typeof p.score === "number") ? ` · score ${p.score}/16` : "";
            const type      = p.isMobile ? "📱 Mobile" : "🖥️ Desktop";
            // The tier is now driven primarily by the JS heap ceiling; surface it.
            const heapText  = p.heapLimitMB
                ? ` · heap ${(p.heapLimitMB / 1024).toFixed(1)} GB`
                : "";
            const srcText   = p.tierSource === "heap" ? " (from heap)" : scoreText;
            $("#pb-device-info-text").text(
                `${tierText} tier${srcText} · ${p.memory} GB RAM · ${p.cores} cores · ${type} · ~${p.fps} FPS${heapText}`
            );
            $("#pb-device-info").show();
        }
    }

    // ─── Heap boost recommendation (NODE_OPTIONS) ───────────────────────────

    /**
     * Show a one-time tip recommending a larger Node heap when the JS heap
     * ceiling is tight but the machine still has spare RAM to spend.
     * Skips entirely if there's nothing worth recommending or the user has
     * already dismissed it permanently.
     * @param {{ show:boolean, suggestedMB:number, currentLimitMB:number|null, deviceMemoryGB:number, command:string }} boost
     */
    maybeShowHeapBoost(boost) {
        if (!boost?.show) return;
        try {
            if (localStorage.getItem(this._boostDismissKey) === "1") return;
        } catch { /* localStorage unavailable — show anyway */ }
        if ($("#pb-boost-overlay").length) return; // already open
        this._renderHeapBoostModal(boost);
    }

    _renderHeapBoostModal(boost) {
        const self      = this;
        const limitText = boost.currentLimitMB
            ? `${(boost.currentLimitMB / 1024).toFixed(1)} GB`
            : "ตรวจไม่ได้";
        const suggGB    = (boost.suggestedMB / 1024).toFixed(0);
        const cmd       = boost.command;

        const $overlay = $(`
            <div id="pb-boost-overlay">
                <div id="pb-boost-modal" role="dialog" aria-modal="true" aria-labelledby="pb-boost-title">
                    <button type="button" id="pb-boost-close" aria-label="Close">✕</button>
                    <h3 id="pb-boost-title">⚡ เพิ่มหน่วยความจำให้ลื่นขึ้นได้</h3>
                    <p class="pb-boost-desc">
                        เครื่องของคุณมี RAM เหลือพอ (${boost.deviceMemoryGB} GB)
                        แต่เพดาน JS heap ปัจจุบันอยู่ที่ <b>${limitText}</b> เท่านั้น
                        การเพิ่มเพดานเป็น <b>${suggGB} GB</b> จะช่วยให้แชทยาว ๆ ลื่นขึ้น
                        และลดอาการค้าง
                    </p>
                    <p class="pb-boost-desc">
                        รันคำสั่งนี้ใน terminal ของเครื่องที่รัน SillyTavern
                        แล้วเปิดโปรแกรมใหม่:
                    </p>
                    <div class="pb-boost-cmd-row">
                        <code id="pb-boost-cmd">${cmd}</code>
                        <button type="button" id="pb-boost-copy" class="menu_button">คัดลอก</button>
                    </div>
                    <small class="pb-boost-note">
                        * คำสั่งนี้ใช้กับ Linux/macOS (bash) — Windows ใช้
                        <code>setx NODE_OPTIONS "--max-old-space-size=${boost.suggestedMB}"</code>
                    </small>
                    <div class="pb-boost-actions">
                        <label class="checkbox_label" for="pb-boost-dont-show">
                            <input type="checkbox" id="pb-boost-dont-show" />
                            <span><small>ไม่ต้องแสดงอีก</small></span>
                        </label>
                        <button type="button" id="pb-boost-ok" class="menu_button">เข้าใจแล้ว</button>
                    </div>
                </div>
            </div>
        `);

        const close = () => {
            if ($("#pb-boost-dont-show").is(":checked")) {
                try { localStorage.setItem(self._boostDismissKey, "1"); } catch { /* ignore */ }
            }
            $overlay.remove();
        };

        $overlay.find("#pb-boost-copy").on("click", function () {
            const done = () => $(this).text("คัดลอกแล้ว ✓");
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(cmd).then(done).catch(() => {});
            } else {
                // Fallback for non-secure contexts where Clipboard API is blocked.
                const ta = document.createElement("textarea");
                ta.value = cmd;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand("copy"); done(); } catch { /* ignore */ }
                ta.remove();
            }
        });

        $overlay.find("#pb-boost-close, #pb-boost-ok").on("click", close);
        $overlay.on("click", function (e) { if (e.target === this) close(); });

        $("body").append($overlay);
    }
}
