/**
 * Tavily-backed search provider for the DeepSeek Harness web capability seam
 * (`ctx.web`). Calls the Tavily Search REST API and maps its results to the
 * seam's normalized `SearchResult` shape. The provider owns its own `fetch`
 * client; it does not use `ctx.llm`.
 * @module dsh-searchhub/provider
 */

/** Stable id this provider registers under in `ctx.web`. */
export const TAVILY_PROVIDER_ID = 'tavily';

/** Default Tavily Search endpoint. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';

/** Default search depth: `basic` (fast) or `advanced` (deeper, costs more). */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic';

/** Default maximum number of results requested from Tavily. */
export const TAVILY_DEFAULT_MAX_RESULTS = 5;

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-searchhub/1.0.0';

/**
 * One normalized source returned to the web seam. The seam owns the final
 * `maxResults` truncation, so a provider may return up to its own configured
 * `maxResults` and let the seam cap it.
 */
export interface WebSearchSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

/** The normalized search result the web seam consumes. */
export interface WebSearchResult {
  sources: WebSearchSource[];
  truncated: boolean;
}

/** The web seam's search request. */
export interface WebSearchRequest {
  query: string;
  maxResults?: number;
}

/**
 * A single result item as returned by the Tavily Search API.
 * See https://docs.tavily.com/ for the wire format.
 */
interface TavilyResultItem {
  url: string;
  title?: string;
  content?: string;
  published_date?: string;
  score?: number;
}

/** The Tavily Search API response body (subset this provider reads). */
interface TavilyResponse {
  results?: TavilyResultItem[];
}

/** Options resolved for one search operation. */
export interface TavilySearchProviderOptions {
  /** Literal API key, when configured directly (discouraged for open source). */
  apiKey?: string;
  /** Resolve the API key from the credentials service / environment. */
  resolveApiKey?: () => Promise<string | undefined>;
  /** The environment-variable name the key is stored under (for error text). */
  apiKeyEnv: string;
  /** Tavily API base URL; `/search` is appended. */
  baseURL: string;
  /** `basic` or `advanced`. */
  searchDepth: 'basic' | 'advanced';
  /** Maximum results requested from Tavily per query. */
  maxResults: number;
  /** Whether to ask Tavily to include a generated answer (unused by the seam). */
  includeAnswer: boolean;
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Map a Tavily response to the seam's normalized result, deduping by url. */
function mapTavilyResponse(response: TavilyResponse): WebSearchResult {
  const items = response.results ?? [];
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  for (const item of items) {
    if (item.url == null || item.url.length === 0 || seen.has(item.url)) continue;
    seen.add(item.url);
    sources.push({
      url: item.url,
      ...(item.title != null && item.title.length > 0 ? { title: item.title } : {}),
      ...(item.content != null && item.content.length > 0 ? { snippet: item.content } : {}),
      ...(item.published_date != null && item.published_date.length > 0
        ? { publishedAt: item.published_date }
        : {}),
    });
  }
  return { sources, truncated: false };
}

/**
 * The Tavily-backed search provider. Registered into `ctx.web` under
 * {@link TAVILY_PROVIDER_ID}. Failures name the endpoint and tell the model how
 * the user can configure the key.
 */
export class TavilySearchProvider {
  readonly id = TAVILY_PROVIDER_ID;

  constructor(private readonly resolveOptions: () => TavilySearchProviderOptions) {}

  /** The provider is usable when a key is configured and the base URL parses. */
  available(): boolean {
    const options = this.resolveOptions();
    const hasKey = (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined;
    return hasKey && URL.canParse(options.baseURL);
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions();
    const apiKey = await this.apiKey(options, signal);
    const endpoint = `${options.baseURL.replace(/\/$/u, '')}/search`;

    const body = {
      query: request.query,
      search_depth: options.searchDepth,
      include_answer: options.includeAnswer,
      max_results: request.maxResults ?? options.maxResults,
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          // Tavily accepts the key either as a bearer token or in the body.
          // The bearer header is the documented modern form.
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw error;
      throw new Error(`Tavily search request to ${endpoint} failed: ${String(error)}`);
    }

    if (!response.ok) {
      let message = `Tavily API error (HTTP ${response.status})`;
      try {
        const parsed = (await response.json()) as { error?: string; detail?: string };
        const detail = parsed.error ?? parsed.detail;
        if (detail != null && detail.length > 0) message += `: ${detail}`;
      } catch {
        /* ignore body parse errors; the status is enough */
      }
      throw new Error(`${message} (endpoint ${endpoint})`);
    }

    try {
      return mapTavilyResponse((await response.json()) as TavilyResponse);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw error;
      throw new Error(`Tavily returned an unprocessable response body: ${String(error)}`);
    }
  }

  /** Resolve one operation's API key without retaining it on the provider. */
  private async apiKey(
    options: TavilySearchProviderOptions,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey;
    const resolved = await (options.resolveApiKey?.() ?? Promise.resolve(undefined));
    if (resolved !== undefined && resolved.length > 0) return resolved;
    throw new Error(
      `Tavily search has no API key for "${options.apiKeyEnv}"; store it through the ` +
        `credentials service (the web Settings > Plugins > Web search (Tavily) card, ` +
        `or the Models page), export it in the launching environment, or set a literal ` +
        `"apiKey" in the searchhub config.`,
    );
  }
}
