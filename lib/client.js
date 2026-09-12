// Browser half of the Tavily web-search plugin for DeepSeek Harness.
//
// Registers a native "Tavily web search" card into the DSH web
// "Plugin configuration" surface (Settings -> Plugins), keyed by the
// `searchhub` settings namespace the host half installs.
//
// This file is served to the browser as a CLASSIC SCRIPT whose only top-level
// statement is a single `window.__ModuleLoader__.load(...)` registration. ALL
		// work -- including <style> injection -- happens lazily inside the factory
// closure when the module is materialized. React and the JSX runtime are
// HOST-PROVIDED seed modules obtained through the factory's synchronous
// `require`; they must never be bundled here.
window.__ModuleLoader__.load({
	id: "dsh-searchhub",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const useState = React.useState;
		const jsxRuntime = require("react/jsx-runtime");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;

		//#region constants
		/** Settings namespace this card edits (must match the host half). */
		const TAVILY_NS = "searchhub";
		/** Locale dictionary namespace this card owns. */
		const NS = "searchhub";
		/** Default credential reference the API key is stored under. */
		const API_KEY_REF_DEFAULT = "TAVILY_API_KEY";
		/**
		 * Provider registry. SearchHub is a hub: today it ships the Tavily
		 * provider, and this table is the single place future providers get
		 * added (id, display label, key prefix, console URL, credential ref).
		 * The card renders whichever provider is ACTIVE_PROVIDER below.
		 */
		const PROVIDERS = {
			tavily: {
				id: "tavily",
				label: "Tavily",
				keyPrefix: "tvly",
				consoleUrl: "https://app.tavily.com/",
				consoleHost: "app.tavily.com",
				credentialRef: "TAVILY_API_KEY",
			},
		};
		/** The provider this build activates. Add more to PROVIDERS, then swap. */
		const ACTIVE_PROVIDER = PROVIDERS.tavily;
		//#endregion

		//#region scoped styles (injected lazily at materialization)
		const CSS_TAG_ID = "dsh-searchhub/card.css";
		const css = [
			".tvly_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;overflow:hidden;transition:border-color .16s,background .16s}",
			".tvly_card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".tvly_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".tvly_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}",
			".tvly_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".tvly_headText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0}",
			".tvly_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;display:flex;align-items:center;gap:8px}",
			".tvly_dot{flex:none;display:block;align-self:center;color:var(--dsw-alias-label-dimmed)}",
			".tvly_dotUnset{color:#e5484d}",
			".tvly_dotOk{color:#30a46c}",
			".tvly_desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".tvly_subtitle{font-weight:500;font-size:12px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:1px 8px;line-height:16px}",
			".tvly_providerRow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
			".tvly_providerLabel{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
			".tvly_providerValue{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);border-radius:6px;padding:2px 10px}",
			".tvly_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".tvly_chevronOpen{transform:rotate(180deg)}",
			".tvly_pending{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;flex:none;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}",
			".tvly_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
			".tvly_field{display:flex;flex-direction:column;gap:6px;padding:12px 0 6px}",
			".tvly_label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}",
			".tvly_badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}",
			".tvly_badgeMuted{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}",
			".tvly_input{height:34px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font:inherit;font-size:13px;line-height:1.5}",
			".tvly_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".tvly_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".tvly_inputErr{border-color:var(--dsw-alias-label-error)}",
			".tvly_inputErr:focus-visible{border-color:var(--dsw-alias-label-error)}",
			".tvly_inputWrap{position:relative;display:flex;align-items:center}",
			".tvly_inputWrap .tvly_input{flex:1;width:100%}",
			".tvly_inputWithBtn{padding-right:40px}",
			".tvly_input::-ms-reveal,.tvly_input::-ms-clear{display:none}",
			".tvly_eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color .16s ease,background .16s ease,transform .12s ease}",
			".tvly_eye:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform)}",
			".tvly_eye:active:not(:disabled){transform:translateY(-50%) scale(.9)}",
			".tvly_eye:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;color:var(--dsw-alias-label-primary)}",
			".tvly_eye:disabled{opacity:.4;cursor:default}",
			".tvly_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".tvly_link{color:var(--dsw-alias-brand-primary);font-weight:500;text-decoration:none;cursor:pointer;position:relative;border-radius:3px;padding:0 1px;transition:color .18s ease,transform .18s ease;background-image:linear-gradient(currentColor,currentColor);background-repeat:no-repeat;background-position:0 100%;background-size:0% 1.5px}",
			".tvly_link:hover{color:var(--dsw-alias-brand-primary-hover,var(--dsw-alias-brand-primary));transform:translateY(-1px);background-size:100% 1.5px}",
			".tvly_link:active{transform:translateY(0)}",
			".tvly_link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;background-size:100% 1.5px}",
			".tvly_err{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}",
			".tvly_footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding:12px 0 4px}",
			".tvly_btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
			".tvly_btnGhost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
			".tvly_btnGhost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".tvly_btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
			".tvly_btn:disabled{opacity:.4;cursor:default}",
		].join("");
		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-searchhub";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locale bundles
		const en = {
			title: "SearchHub",
			subtitle: "Web search",
			description: "Give the built-in web_search tool a real search backend, so it no longer spends paid model turns. Configure the active provider below.",
			providerWord: "Provider",
			apiKeyWord: "API key",
			apiKeyHint: "Stored through the credentials service, never in a settings file. Leave blank to keep the current key.",
			apiKeySet: "Key configured",
			apiKeyUnset: "No key yet",
			getKeyPrefix: "Get a free key at ",
			getKeySuffix: ".",
			apiKeyInvalidPrefix: "Invalid key: a ",
			apiKeyInvalidSuffix: " API key must start with ",
			showKey: "Show key",
			hideKey: "Hide key",
			expand: "Show settings",
			collapse: "Hide settings",
			unsaved: "Unsaved",
			save: "Save",
			saving: "Saving\u2026",
			discard: "Discard",
			saveFailed: "The deployment did not accept this key.",
		};
		const zh = {
			title: "SearchHub",
			subtitle: "\u7f51\u9875\u641c\u7d22",
			description: "\u4e3a\u5185\u7f6e\u7684 web_search \u5de5\u5177\u63a5\u5165\u771f\u6b63\u7684\u641c\u7d22\u670d\u52a1\uff0c\u4e0d\u518d\u6d88\u8017\u4ed8\u8d39\u7684\u6a21\u578b\u8c03\u7528\u3002\u5728\u4e0b\u65b9\u914d\u7f6e\u5f53\u524d\u641c\u7d22\u670d\u52a1\u5546\u3002",
			providerWord: "\u641c\u7d22\u670d\u52a1\u5546",
			apiKeyWord: "API \u5bc6\u94a5",
			apiKeyHint: "\u901a\u8fc7\u51ed\u636e\u670d\u52a1\u52a0\u5bc6\u5b58\u50a8\uff0c\u4e0d\u5199\u5165\u914d\u7f6e\u6587\u4ef6\u3002\u7559\u7a7a\u5219\u4fdd\u7559\u5f53\u524d\u5bc6\u94a5\u3002",
			apiKeySet: "\u5df2\u914d\u7f6e\u5bc6\u94a5",
			apiKeyUnset: "\u5c1a\u672a\u914d\u7f6e",
			getKeyPrefix: "\u5728 ",
			getKeySuffix: " \u514d\u8d39\u83b7\u53d6\u5bc6\u94a5\u3002",
			apiKeyInvalidPrefix: "\u65e0\u6548\u7684\u5bc6\u94a5\uff1a",
			apiKeyInvalidSuffix: " API \u5bc6\u94a5\u5fc5\u987b\u4ee5\u6b64\u5f00\u5934\uff1a",
			showKey: "\u663e\u793a\u5bc6\u94a5",
			hideKey: "\u9690\u85cf\u5bc6\u94a5",
			expand: "\u5c55\u5f00\u8bbe\u7f6e",
			collapse: "\u6536\u8d77\u8bbe\u7f6e",
			unsaved: "\u672a\u4fdd\u5b58",
			save: "\u4fdd\u5b58",
			saving: "\u4fdd\u5b58\u4e2d\u2026",
			discard: "\u653e\u5f03",
			saveFailed: "\u90e8\u7f72\u672a\u63a5\u53d7\u6b64\u5bc6\u94a5\u3002",
		};
		//#endregion

		//#region minimal snapshot store: { getSnapshot, subscribe, set }
		function createStore(initial) {
			let snapshot = initial;
			const listeners = new Set();
			return {
				getSnapshot() { return snapshot; },
				subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
				set(next) {
					if (next === snapshot) return;
					snapshot = next;
					for (const fn of listeners) fn();
				},
			};
		}
		//#endregion

		//#region controller: bridges the settings scope + credentials domain onto the store
		class TavilyCardController {
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.stagedKey = null; // null = untouched
				this.saving = false;
				this.failed = false;
				this.credential = { ref: this.refOf(), configured: false, writable: true };
				this.store = createStore(this.projection());
				scope.subscribe(() => { this.store.set(this.projection()); this.readCredential(); });
				this.readCredential();
			}
			refOf() {
				const declared = this.scope.getSnapshot().value?.apiKeyEnv;
				return declared !== undefined && declared.length > 0 ? declared : API_KEY_REF_DEFAULT;
			}
			projection() {
				const snap = this.scope.getSnapshot();
				const staged = this.stagedKey;
				const invalid = this.isInvalid(staged);
				return {
					available: snap.status === "ready",
					writable: (snap.writable ?? true) && (this.credential.writable ?? true),
					apiKey: staged ?? "",
					apiKeyConfigured: this.credential.configured,
					keyStatus: this.keyStatus(staged, invalid),
					invalid: invalid,
					dirty: staged !== null && staged.trim() !== "" && !invalid,
					saving: this.saving,
					failed: this.failed,
				};
			}
			// A Tavily key always begins with "tvly". Anything else that has been
			// typed is treated as an invalid key. Pure format check: zero network,
			// never stale. An empty / untouched field is not "invalid" (it is just
			// unset), so we do not flag it.
			isInvalid(staged) {
				if (staged === null) return false;
				const v = staged.trim();
				if (v === "") return false;
					return !v.toLowerCase().startsWith(ACTIVE_PROVIDER.keyPrefix.toLowerCase());
			}
			// Status dot: "unset" (red, nothing configured) |
			// "invalid" (red, typed value is not a tvly- key) | "ok" (green).
			// While editing, judge the live input; otherwise fall back to whether a
			// key is configured (the stored value cannot be re-read for its format).
			keyStatus(staged, invalid) {
				if (staged !== null && staged.trim() !== "") {
					return invalid ? "invalid" : "ok";
				}
				return this.credential.configured ? "ok" : "unset";
			}
			async readCredential() {
				const ref = this.refOf();
				if (ref !== this.credential.ref) {
					this.credential = { ref, configured: false, writable: true };
					this.store.set(this.projection());
				}
				try {
					const resp = await this.ctx.remote.credentials.describe([ref]);
					if (!resp || !resp.ok || ref !== this.refOf()) return;
					const view = resp.value[ref];
					this.credential = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true };
					this.store.set(this.projection());
				} catch { /* transport hiccup: keep last known state */ }
			}
			edit(field, text) {
				if (field !== "apiKey") return;
				this.stagedKey = text;
				this.failed = false;
				this.store.set(this.projection());
			}
			discard() {
				this.stagedKey = null;
				this.failed = false;
				this.store.set(this.projection());
			}
			async save() {
				const value = (this.stagedKey ?? "").trim();
				if (value === "" || this.saving) return;
					if (!value.toLowerCase().startsWith(ACTIVE_PROVIDER.keyPrefix.toLowerCase())) return; // guard: never save an invalid key
				this.saving = true;
				this.failed = false;
				this.store.set(this.projection());
				try {
					await this.ctx.remote.credentials.set(this.refOf(), value);
					await this.readCredential();
					this.stagedKey = null;
				} catch {
					this.failed = true;
				}
				this.saving = false;
				this.store.set(this.projection());
			}
			inject() {
				return {
					hooks: { tavilyCard: this.store }, // -> prop `useTavilyCard`
					edit: (f, t) => this.edit(f, t),
					save: () => this.save(),
					discard: () => this.discard(),
				};
			}
		}
		//#endregion

		//#region chevron icon (inline SVG, no external icon dependency)
		function Chevron(open) {
			return jsx("svg", {
				className: "tvly_chevron " + (open ? "tvly_chevronOpen" : ""),
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: jsx("path", {
					d: "M4 6l4 4 4-4",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			});
		}
		//#endregion

		//#region eye icons (inline SVG, no external icon dependency)
		function Eye() {
			return jsxs("svg", {
				width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true,
				children: [
					jsx("path", { d: "M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }),
					jsx("circle", { cx: 8, cy: 8, r: 2, stroke: "currentColor", strokeWidth: 1.3 }),
				],
			});
		}
		function EyeOff() {
			return jsxs("svg", {
				width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true,
				children: [
					jsx("path", { d: "M6.2 3.7A6.3 6.3 0 0 1 8 3.5C12.2 3.5 14.5 8 14.5 8a10.6 10.6 0 0 1-2 2.5M4 4.6A10.7 10.7 0 0 0 1.5 8S3.8 12.5 8 12.5c.9 0 1.7-.2 2.4-.5", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }),
					jsx("path", { d: "M2 2l12 12", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
				],
			});
		}
		function Dot(cls) {
			return jsx("svg", {
				width: 9, height: 9, viewBox: "0 0 10 10", className: "tvly_dot " + cls, "aria-hidden": true,
				children: jsx("circle", { cx: 5, cy: 5, r: 5, fill: "currentColor" }),
			});
		}
		//#endregion
		
		//#region card component
		function TavilyCard(props) {
			const t = props.t;
			const state = props.useTavilyCard((s) => s);
			ensureStyles();
			const [open, setOpen] = useState(false);
			const [revealed, setRevealed] = useState(false);
			if (!state.available) return null;
			const configured = state.apiKeyConfigured;
			const disabled = !state.writable || state.saving;
			const title = t("title");
			const providerLabel = ACTIVE_PROVIDER.label;
			const dotClass = state.keyStatus === "ok" ? "tvly_dotOk" : "tvly_dotUnset";
			return jsxs("li", {
				className: "tvly_card " + (open ? "tvly_cardOpen" : ""),
				children: [
					jsxs("button", {
						type: "button",
						className: "tvly_header",
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + title,
						onClick: () => setOpen(!open),
						children: [
							jsxs("span", { className: "tvly_headText", children: [
								jsxs("span", { className: "tvly_name", children: [
									title,
									jsx("span", { className: "tvly_subtitle", children: t("subtitle") }),
									Dot(dotClass),
								] }),
								jsx("span", { className: "tvly_desc", children: t("description") }),
							] }),
							state.dirty ? jsx("span", { className: "tvly_pending", children: t("unsaved") }) : null,
							Chevron(open),
						],
					}),
					open ? jsxs("div", { className: "tvly_body", children: [
						jsxs("div", { className: "tvly_providerRow", children: [
							jsx("span", { className: "tvly_providerLabel", children: t("providerWord") }),
							jsx("span", { className: "tvly_providerValue", children: providerLabel }),
						] }),
						jsxs("div", { className: "tvly_field", children: [
							jsxs("label", { className: "tvly_label", htmlFor: "tvly-api-key", children: [
								jsx("span", { children: providerLabel + " " + t("apiKeyWord") }),
								jsx("span", {
									className: configured ? "tvly_badge" : "tvly_badgeMuted",
									children: configured ? t("apiKeySet") : t("apiKeyUnset"),
								}),
							] }),
						jsxs("div", { className: "tvly_inputWrap", children: [
							jsx("input", {
								id: "tvly-api-key",
								className: "tvly_input tvly_inputWithBtn" + (state.invalid ? " tvly_inputErr" : ""),
								type: revealed ? "text" : "password",
								"aria-invalid": state.invalid ? true : undefined,
								autoComplete: "off",
								spellCheck: false,
								placeholder: ACTIVE_PROVIDER.keyPrefix + "-\u2026",
								"aria-label": providerLabel + " " + t("apiKeyWord"),
								value: state.apiKey,
								disabled: disabled,
								onChange: (e) => props.edit("apiKey", e.target.value),
							}),
							jsx("button", {
								type: "button",
								className: "tvly_eye",
								tabIndex: disabled ? -1 : 0,
								disabled: disabled,
								"aria-label": t(revealed ? "hideKey" : "showKey"),
								title: t(revealed ? "hideKey" : "showKey"),
								onClick: () => setRevealed(!revealed),
								children: revealed ? EyeOff() : Eye(),
							}),
						] }),
						(state.invalid || state.failed)
							? jsx("p", {
								className: "tvly_err",
								children: state.invalid
									? t("apiKeyInvalidPrefix") + providerLabel + t("apiKeyInvalidSuffix") + "\u201c" + ACTIVE_PROVIDER.keyPrefix + "\u201d\u3002"
									: t("saveFailed"),
							  })
							: jsxs("p", {
								className: "tvly_hint",
								children: [
									t("apiKeyHint") + " " + t("getKeyPrefix"),
									jsx("a", {
										className: "tvly_link",
										href: ACTIVE_PROVIDER.consoleUrl,
										target: "_blank",
										rel: "noopener noreferrer",
										children: ACTIVE_PROVIDER.consoleHost,
									}),
									t("getKeySuffix"),
								],
							  }),
						] }),
						jsxs("div", { className: "tvly_footer", children: [
							jsx("button", {
								type: "button",
								className: "tvly_btn tvly_btnGhost",
								disabled: !state.dirty || state.saving,
								onClick: props.discard,
								children: t("discard"),
							}),
							jsx("button", {
								type: "button",
								className: "tvly_btn tvly_btnPrimary",
								disabled: !state.dirty || state.saving,
								onClick: props.save,
								children: t(state.saving ? "saving" : "save"),
							}),
						] }),
					] }) : null,
				],
			});
		}
		//#endregion

		//#region Cordis plugin
		const inject = ["slots", "locale", "remote", "remote.credentials", "settingsScope"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), "searchhub: dictionaries");

			const tavily = new TavilyCardController(ctx.settingsScope.bind({ namespace: TAVILY_NS }), ctx);

			ctx.effect(
				() => ctx.remote.$on("credentials/reference-updated", () => tavily.readCredential()),
				"searchhub: credential invalidations",
			);

			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: TAVILY_NS,
					locale: NS,
					inject: () => tavily.inject(),
				}, TavilyCard);
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
