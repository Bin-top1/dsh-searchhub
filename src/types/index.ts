/**
 * Register a Tavily-backed search provider in `ctx.web`. It calls the Tavily
 * Search REST API. The API key is a credential reference (default
 * `TAVILY_API_KEY`) resolved per search, so no secret needs to live in a
 * configuration file, and the web Settings surface can write it.
 * @module dsh-searchhub
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
// Type-only imports that pull in the `Context` augmentations this plugin's
// `apply` relies on (`ctx.settings`, `ctx.web`) — without them cordis's plain
// `Context` has neither property.
import type {} from '@deepseek-ai/dsh-settings';
import type {} from '@deepseek-ai/dsh-web';
import {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TavilySearchProvider,
  type TavilySearchProviderOptions,
} from './provider.js';

export {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_PROVIDER_ID,
} from './provider.js';
export type {
  TavilySearchProviderOptions,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './provider.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'searchhub';

/** The web seam this provider registers into. */
export const inject = ['web'];

/**
 * Default credential-reference name the API key is stored under. The plugin's
 * own browser-half card (`lib/client.js`) writes to this same reference, so the
 * host and client agree with zero extra configuration.
 */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY';

/** Environment variable naming this provider's endpoint. */
const SEARCH_BASE_URL_ENV = 'TAVILY_BASE_URL';

/**
 * Settings namespace this provider installs under. The browser half registers a
 * card into `settings.plugin.item` keyed by this namespace, so the DSH web
 * "Plugin configuration" surface renders a native Tavily card.
 */
export const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = 'searchhub';

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Tavily API key; prefer {@link apiKeyEnv} so no secret enters config files. */
  apiKey?: string;
  /** Credential reference resolved for each search; defaults to `TAVILY_API_KEY`. */
  apiKeyEnv?: string;
  /** Tavily API base URL; `/search` is appended. */
  baseURL?: string;
  /** `basic` (fast) or `advanced` (deeper). Defaults to `basic`. */
  searchDepth?: 'basic' | 'advanced';
  /** Maximum results requested from Tavily per query. Defaults to 5. */
  maxResults?: number;
  /** Ask Tavily to include a generated answer. Defaults to false. */
  includeAnswer?: boolean;
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret').description('Tavily API key (stored via the credentials service).'),
  apiKeyEnv: z
    .string()
    .role('credential-ref')
    .default(DEFAULT_API_KEY_ENV)
    .description('Credential reference the Tavily API key is stored under.'),
  baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL).description('Tavily API base URL.'),
  searchDepth: z
    .union(['basic', 'advanced'])
    .default(TAVILY_DEFAULT_SEARCH_DEPTH)
    .description('Search depth: basic (fast) or advanced (deeper, costs more credits).'),
  maxResults: z
    .number()
    .step(1)
    .min(1)
    .max(20)
    .default(TAVILY_DEFAULT_MAX_RESULTS)
    .description('Maximum results requested from Tavily per query.'),
  includeAnswer: z.boolean().default(false).description('Ask Tavily to include a generated answer.'),
});

/**
 * Project one resolved settings section into the options the provider serves its
 * next search with. Environment fallbacks live here so every value the provider
 * reads is already fully defaulted.
 */
function resolveOptions(ctx: Context, config: Config): TavilySearchProviderOptions {
  const envName =
    config.apiKeyEnv !== undefined && config.apiKeyEnv.length > 0
      ? config.apiKeyEnv
      : DEFAULT_API_KEY_ENV;
  const apiKeyEnv = credentialRef(envName);
  const literalApiKey =
    config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined;
  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials');
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value;
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
    },
    apiKeyEnv,
    baseURL:
      config.baseURL ??
      launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ??
      TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    maxResults: config.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
    includeAnswer: config.includeAnswer ?? false,
  };
}

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current = (): Config => config;

  // Install a Settings card so the web Plugins page can edit endpoint/depth and
  // the UI can write the secret credential referenced by apiKeyEnv.
  ctx.inject(['settings'], (settingsCtx: Context) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source: () => Config) => {
        current = source;
      },
      onChange: () => {},
    });
  });

  ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
}
