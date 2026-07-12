/**
 * @module SettingsPanel
 * UI bindings for the extension settings panel.
 * Uses native ST .inline-drawer (same as other extension menus).
 */
export class SettingsPanel {
    constructor(state, actions) {
        this.state = state;
        this.actions = actions;
        this.EXT_PATH = actions.EXT_PATH;
        this._ramTimer = null;
        this._livePaused = false;
        this._boostDismissKey = "pb-heap-boost-dismissed";
    }

    async load() {
        try {
            // ST already injects settings.html via manifest "settings".
            // Only fetch/append manually if missing (older ST / race).
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

            // Native ST .inline-drawer-toggle handles open/collapse.
            this._bindUI();
            this._startRamMonitor();
        } catch (err) {
            console.warn(`[⚡ PerfBoost] Could not load settings panel:`, err);
        }
    }

    _bindUI() {
        const {
            cfg, saveSettings, startModules, destroyModules, detectDevice,
            restartModule, applyPhoneSaver, applyStHints, forceMemoryClean,
            applyTierClass,
        } = this.actions;
        const self = this;

        $("#pb-enabled").on("change", function () {
            cfg().enabled = this.checked;
            saveSettings();
            this.checked ? startModules() : destroyModules();
        });

        $("#pb-auto-detect").on("change", async function () {
            cfg().autoDetect = this.checked;
            saveSettings();
            if (this.checked) {
                await detectDevice();
                self.sync();
            }
        });

        $("#pb-device-tier").on("change", function () {
            cfg().deviceTier = this.value;
            if (this.value !== "auto") {
                self.state.appliedTier = this.value;
                applyTierClass(this.value);
            }
            saveSettings();
        });

        const moduleToggles = {
            "#pb-virtual-scroll":    "messageVirtualization",
            "#pb-lazy-images":       "imageOptimizer",
            "#pb-scroll-optimizer":  "scrollOptimizer",
            "#pb-reduce-animations": "animationReducer",
            "#pb-memory-monitor":    "memoryManager",
            "#pb-st-core-hints":     "stCoreHints",
            "#pb-idle-guard":        "idleGuard",
            "#pb-dom-janitor":       "domJanitor",
        };

        for (const [sel, modName] of Object.entries(moduleToggles)) {
            $(sel).on("change", function () {
                cfg()[modName] ??= {};
                cfg()[modName].enabled = this.checked;
                saveSettings();
                restartModule(modName);
                if (modName === "animationReducer") self._updateAnimSubState();
            });
        }

        $("#pb-aggressive-mode").on("change", function () {
            cfg().messageVirtualization.aggressiveMode = this.checked;
            saveSettings();
            self.state.modules.messageVirtualization?.setAggressiveMode?.(this.checked);
        });

        $("#pb-collapse-media").on("change", function () {
            cfg().domJanitor ??= {};
            cfg().domJanitor.collapseOldMedia = this.checked;
            saveSettings();
            if (self.state.modules.domJanitor) {
                self.state.modules.domJanitor.cfg.collapseOldMedia = this.checked;
            }
        });

        $("#pb-freeze-bg").on("change", function () {
            cfg().idleGuard ??= {};
            cfg().idleGuard.freezeBackground = this.checked;
            saveSettings();
            self.state.modules.idleGuard?.setFreezeBackground?.(this.checked);
        });

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

        $("#pb-heap-threshold").on("input", function () {
            const pct = parseInt(this.value, 10);
            $("#pb-heap-threshold-val").text(`${pct}%`);
            cfg().memoryManager.heapThreshold = pct / 100;
            self._renderRamStats();
        }).on("change", function () {
            saveSettings();
        });

        $("#pb-msg-threshold").on("input", function () {
            const n = parseInt(this.value, 10);
            $("#pb-msg-threshold-val").text(String(n));
            cfg().memoryManager.messageCountThreshold = n;
        }).on("change", function () {
            saveSettings();
        });

        // div.menu_button — keep inner <span> markup
        $("#pb-redetect-btn").on("click", async function () {
            const $btn = $(this);
            $btn.addClass("disabled").css("pointer-events", "none");
            $btn.find("span").last().text("Detecting…");
            try {
                await detectDevice();
                self.sync();
            } finally {
                $btn.removeClass("disabled").css("pointer-events", "");
                $btn.find("span").last().text("Re-detect Device");
            }
        });

        $("#pb-phone-saver-btn").on("click", async function () {
            const $btn = $(this);
            $btn.addClass("disabled").css("pointer-events", "none");
            $btn.find("span").text("Applying…");
            try {
                await applyPhoneSaver?.();
            } finally {
                $btn.removeClass("disabled").css("pointer-events", "");
                $btn.find("span").text("📱 Phone Saver");
                self.sync();
            }
        });

        $("#pb-apply-st-hints-btn").on("click", function () {
            const applied = applyStHints?.();
            if (applied) {
                toastr?.success(
                    `ST tips applied (tier ${self.state.appliedTier || "low"}).`,
                    "Performance Boost",
                    { timeOut: 2500, positionClass: "toast-bottom-right" },
                );
            } else {
                toastr?.warning("ST Core Hints module not ready.", "Performance Boost");
            }
        });

        $("#pb-force-clean-btn").on("click", function () {
            forceMemoryClean?.();
            self._renderRamStats();
        });
    }

    _startRamMonitor() {
        this._renderRamStats();
        clearInterval(this._ramTimer);
        this._ramTimer = setInterval(() => {
            if (this._livePaused || document.hidden) return;
            if ($("#pb-settings-panel").length === 0) return;
            this._renderRamStats();
        }, 2000);
    }

    pauseLiveUi() {
        this._livePaused = true;
    }

    resumeLiveUi() {
        this._livePaused = false;
        this._renderRamStats();
    }

    stopRamMonitor() {
        clearInterval(this._ramTimer);
        this._ramTimer = null;
    }

    _readMemStats() {
        const cfg = this.actions.cfg();
        const threshold = cfg.memoryManager?.heapThreshold ?? 0.75;
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
            $("#pb-ram-threshold-marker").css("left", "75%");
            return;
        }

        const pct = Math.min(100, Math.round(s.ratio * 100));
        $("#pb-ram-heap-text").text(
            `${s.usedMB.toFixed(0)} / ${s.limitMB.toFixed(0)} MB · ${pct}%`,
        );

        const $fill = $("#pb-ram-bar-fill").css("width", `${pct}%`);
        const thr = Math.round(s.threshold * 100);
        $fill.removeClass("pb-ram-ok pb-ram-warn pb-ram-danger");
        if (pct >= thr)      $fill.addClass("pb-ram-danger");
        else if (pct >= 60)  $fill.addClass("pb-ram-warn");
        else                 $fill.addClass("pb-ram-ok");

        $("#pb-ram-threshold-marker").css("left", `${thr}%`);
    }

    _updateAnimSubState() {
        const on = !!this.actions.cfg().animationReducer?.enabled;
        $("#pb-anim-suboptions").toggleClass("pb-disabled", !on);
        $("#pb-anim-suboptions input").prop("disabled", !on);
    }

    _updateTierChip() {
        const tier = this.state.appliedTier;
        const $chip = $("#pb-tier-chip");
        if (!tier || !$chip.length) return;
        const labels = { low: "LOW", medium: "MED", good: "GOOD", high: "HIGH" };
        $chip
            .text(labels[tier] || tier.toUpperCase())
            .attr("class", `pb-tier-chip pb-chip-${tier}`)
            .prop("hidden", false);
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
        setCheck("#pb-st-core-hints",      s.stCoreHints?.enabled !== false);
        setCheck("#pb-idle-guard",         s.idleGuard?.enabled !== false);
        setCheck("#pb-freeze-bg",          s.idleGuard?.freezeBackground);
        setCheck("#pb-dom-janitor",        s.domJanitor?.enabled !== false);
        setCheck("#pb-collapse-media",     s.domJanitor?.collapseOldMedia);

        $("#pb-device-tier").val(s.deviceTier);

        const thrPct = Math.round((s.memoryManager?.heapThreshold ?? 0.75) * 100);
        $("#pb-heap-threshold").val(thrPct);
        $("#pb-heap-threshold-val").text(`${thrPct}%`);

        const msgThr = s.memoryManager?.messageCountThreshold ?? 300;
        $("#pb-msg-threshold").val(msgThr);
        $("#pb-msg-threshold-val").text(String(msgThr));

        this._updateAnimSubState();
        this._renderRamStats();
        this._updateTierChip();

        if (this.state.deviceProfile) {
            const p = this.state.deviceProfile;
            const label    = p.tierLabel ? ` (${p.tierLabel})` : "";
            const tierText = `${p.tier.toUpperCase()}${label}`;
            const scoreText = (typeof p.score === "number") ? ` · score ${p.score}/16` : "";
            const type      = p.isMobile ? "📱 Mobile" : "🖥️ Desktop";
            const heapText  = p.heapLimitMB
                ? ` · heap ${(p.heapLimitMB / 1024).toFixed(1)} GB`
                : "";
            const srcText   = p.tierSource === "heap" ? " (from heap)"
                : p.tierSource === "mobile-ram" ? " (mobile RAM floor)"
                : scoreText;
            const connText  = p.connection?.effectiveType
                ? ` · net ${p.connection.effectiveType}${p.connection.saveData ? " save-data" : ""}`
                : "";
            $("#pb-device-info-text").text(
                `${tierText} tier${srcText} · ${p.memory} GB RAM · ${p.cores} cores · ${type} · ~${p.fps} FPS${heapText}${connText}`,
            );
            $("#pb-device-info").show();
        }
    }

    maybeShowHeapBoost(boost) {
        if (!boost?.show) return;
        try {
            if (localStorage.getItem(this._boostDismissKey) === "1") return;
        } catch { /* localStorage unavailable — show anyway */ }
        if ($("#pb-boost-overlay").length) return;
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
                        <code id="pb-boost-cmd"></code>
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

        $overlay.find("#pb-boost-cmd").text(cmd);

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
