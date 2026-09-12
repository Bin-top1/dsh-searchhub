import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

//#region provider
/**
 * Tavily-backed search provider for the DeepSeek Harness web capability seam
 * (`ctx.web`). Calls the Tavily Search REST API and maps its results to the
 * seam's normalized `SearchResult` shape.
 * @module dsh-searchhub/provider
 */

/** Stable id this provider registers under in `ctx.web`. */
const TAVILY_PROVIDER_ID = "tavily";
/** Default Tavily Search endpoint. */
const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Default search depth. */
const TAVILY_DEFAULT_SEARCH_DEPTH = "basic";
/** Default maximum number of results requested from Tavily. */
const TAVILY_DEFAULT_MAX_RESULTS = 5;
/** Attribution header sent on every request. */
const USER_AGENT = "dsh-searchhub/1.0.0";

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}

/** Map a Tavily response to the seam's normalized result, deduping by url. */
function mapTavilyResponse(response) {
	const items = response.results ?? [];
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const item of items) {
		if (item.url == null || item.url.length === 0 || seen.has(item.url)) continue;
		seen.add(item.url);
		sources.push({
			url: item.url,
			...item.title != null && item.title.length > 0 ? { title: item.title } : {},
			...item.content != null && item.content.length > 0 ? { snippet: item.content } : {},
			...item.published_date != null && item.published_date.length > 0 ? { publishedAt: item.published_date } : {}
		});
	}
	return { sources, truncated: false };
}

/**
 * The Tavily-backed search provider. Registered into `ctx.web` under
 * TAVILY_PROVIDER_ID.
 */
var TavilySearchProvider = class {
	resolveOptions;
	id = TAVILY_PROVIDER_ID;

	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}

	available() {
		const options = this.resolveOptions();
		const hasKey = (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0;
		return hasKey && URL.canParse(options.baseURL);
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		const endpoint = `${options.baseURL.replace(/\/$/u, "")}/search`;
		const body = {
			query: request.query,
			search_depth: options.searchDepth,
			include_answer: options.includeAnswer,
			max_results: request.maxResults ?? options.maxResults
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw error;
			throw new Error(`Tavily search request to ${endpoint} failed: ${String(error)}`);
		}
		if (!response.ok) {
			let message = `Tavily API error (HTTP ${response.status})`;
			try {
				const parsed = await response.json();
				const detail = parsed.error ?? parsed.detail;
				if (detail != null && detail.length > 0) message += `: ${detail}`;
			} catch {}
			throw new Error(`${message} (endpoint ${endpoint})`);
		}
		try {
			return mapTavilyResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw error;
			throw new Error(`Tavily returned an unprocessable response body: ${String(error)}`);
		}
	}

	async apiKey(options, signal) {
		if (signal?.aborted === true) throw new DOMException("aborted", "AbortError");
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		const resolved = await (options.resolveApiKey?.() ?? Promise.resolve(void 0));
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new Error(`Tavily search has no API key for "${options.apiKeyEnv}"; store it through the credentials service (the web Settings > Plugins > Web search (Tavily) card, or the Models page), export it in the launching environment, or set a literal "apiKey" in the searchhub config.`);
	}
};
//#endregion

//#region plugin entry
/** Cordis plugin name used by loader diagnostics. */
const name = "searchhub";
/** The web seam this provider registers into. */
const inject = ["web"];
/**
 * Default credential-reference name the API key is stored under. This is the
 * reference the plugin's own browser-half card writes to, so the host and
 * client agree with zero extra configuration.
 */
const DEFAULT_API_KEY_ENV = "TAVILY_API_KEY";
const SEARCH_BASE_URL_ENV = "TAVILY_BASE_URL";
/**
 * Settings namespace this provider installs under. The plugin's browser half
 * (`lib/client.js`) registers a card into `settings.plugin.item` keyed by this
 * exact namespace, so the DSH web "Plugin configuration" surface renders a
 * native "Tavily web search" card that edits this section.
 */
const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = "searchhub";

/** Config schema — Tavily-native fields, edited by the plugin's own card. */
const Config = z.object({
	apiKey: z.string().role("secret").description("Tavily API key (stored via the credentials service)."),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV).description("Credential reference the Tavily API key is stored under."),
	baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL).description("Tavily API base URL."),
	searchDepth: z.union(["basic", "advanced"]).default(TAVILY_DEFAULT_SEARCH_DEPTH).description("Search depth: basic (fast) or advanced (deeper, costs more credits)."),
	maxResults: z.number().step(1).min(1).max(20).default(TAVILY_DEFAULT_MAX_RESULTS).description("Maximum results requested from Tavily per query."),
	includeAnswer: z.boolean().default(false).description("Ask Tavily to include a generated answer.")
});

/** Project one resolved settings section into provider options. */
function resolveOptions(ctx, config) {
	const envName = config.apiKeyEnv !== void 0 && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV;
	const apiKeyEnv = credentialRef(envName);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ?? TAVILY_DEFAULT_BASE_URL,
		searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
		maxResults: config.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
		includeAnswer: config.includeAnswer ?? false
	};
}

/** Register the Tavily search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, Config, config, {
			setSource: (source) => {
				current = source;
			},
			onChange: () => {}
		});
	});
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
}
//#endregion

export {
	Config,
	TAVILY_DEFAULT_BASE_URL,
	TAVILY_DEFAULT_MAX_RESULTS,
	TAVILY_DEFAULT_SEARCH_DEPTH,
	TAVILY_PROVIDER_ID,
	TavilySearchProvider,
	WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE,
	apply,
	inject,
	name
};
