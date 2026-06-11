/**
 * Lightweight STAC API client for Microsoft Planetary Computer.
 * Asset URLs are signed transparently via SAS tokens.
 */

// ── Provider registry ─────────────────────────────────────────────────────────

export type StacProvider = "planetary-computer";

export interface StacProviderConfig {
  id: StacProvider;
  label: string;
  baseUrl: string;
  requiresSigning: boolean;
}

export const STAC_PROVIDERS: StacProviderConfig[] = [
  {
    id: "planetary-computer",
    label: "Microsoft Planetary Computer",
    baseUrl: "https://planetarycomputer.microsoft.com/api/stac/v1",
    requiresSigning: true,
  },
];

// ── Collection normalization ───────────────────────────────────────────────────
// Maps user-friendly names → collection IDs per provider.
// Checked case-insensitively; first matching alias wins.

interface CollectionAlias {
  aliases: string[];
  ids: Partial<Record<StacProvider, string>>;
}

const COLLECTION_ALIASES: CollectionAlias[] = [
  {
    aliases: ["sentinel-2", "sentinel 2", "s2", "s-2", "sentinel2"],
    ids: { "planetary-computer": "sentinel-2-l2a" },
  },
  {
    aliases: ["sentinel-1", "sentinel 1", "s1", "sar"],
    ids: { "planetary-computer": "sentinel-1-grd" },
  },
  {
    // Planetary Computer serves Landsat Collection 2 Level-2 (L4–L9) as a single
    // combined collection: landsat-c2-l2. There are no per-satellite collections.
    aliases: [
      "landsat", "landsat-8", "landsat 8", "l8", "oli",
      "landsat-9", "landsat 9", "l9",
    ],
    ids: { "planetary-computer": "landsat-c2-l2" },
  },
  {
    aliases: ["naip", "aerial", "naip imagery"],
    ids: { "planetary-computer": "naip" },
  },
  {
    aliases: ["cop-dem", "copernicus dem", "elevation", "dem", "srtm"],
    ids: { "planetary-computer": "cop-dem-glo-30" },
  },
  {
    aliases: ["modis", "modis ndvi"],
    ids: {
      "planetary-computer": "modis-13A1-061",
    },
  },
  {
    aliases: ["aster"],
    ids: {
      "planetary-computer": "aster-l1t",
    },
  },
];

export function resolveCollectionId(
  userInput: string,
  provider: StacProvider,
): string | null {
  const lower = userInput.trim().toLowerCase();
  for (const entry of COLLECTION_ALIASES) {
    if (entry.aliases.some((a) => lower.includes(a))) {
      return entry.ids[provider] ?? null;
    }
  }
  // If the user typed an exact collection id that looks valid, use it as-is
  if (/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(userInput.trim())) {
    return userInput.trim();
  }
  return null;
}

// ── STAC search parameters ────────────────────────────────────────────────────

export interface StacBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface StacSearchParams {
  provider: StacProvider;
  collections?: string[];      // resolved collection IDs
  bbox?: StacBbox;
  dateRange?: { from?: string; to?: string }; // ISO-8601 dates
  cloudCoverMax?: number;      // 0–100
  limit?: number;
}

// ── STAC item types ───────────────────────────────────────────────────────────

export interface StacAsset {
  href: string;
  type?: string;
  title?: string;
  roles?: string[];
}

export interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
}

export interface StacItem {
  type: "Feature";
  stac_version: string;
  id: string;
  collection?: string;
  geometry: GeoJsonGeometry | null;
  bbox?: number[];
  datetime?: string | null;
  properties: Record<string, unknown>;
  assets: Record<string, StacAsset>;
  links?: Array<{ rel: string; href: string; type?: string; title?: string }>;
}

export interface StacSearchResult {
  items: StacItem[];
  totalMatched?: number;
  provider: StacProvider;
  providerLabel: string;
  /** The datetime range actually used for the search (ISO YYYY-MM-DD). */
  effectiveDateRange: { from: string; to: string };
  /** True when the caller did not specify dates and the default window was applied. */
  dateRangeDefaulted: boolean;
}

// ── Planetary Computer signing ────────────────────────────────────────────────
// Planetary Computer API URLs (preview.png, tilejson.json) are public CORS-safe endpoints
// that don't need SAS signing. Raw Azure Blob URLs would need signing, but ArcGIS
// ImageryTileLayer strips SAS query params anyway — making signing both rate-limited
// (429) and ineffective. No signing is performed.

// ── Core search ───────────────────────────────────────────────────────────────

export async function searchStac(params: StacSearchParams): Promise<StacSearchResult> {
  const providerConfig = STAC_PROVIDERS.find((p) => p.id === params.provider)!;
  const limit = Math.min(params.limit ?? 12, 50);

  const body: Record<string, unknown> = { limit };

  if (params.collections?.length) {
    body.collections = params.collections;
  }

  if (params.bbox) {
    const { west, south, east, north } = params.bbox;
    body.bbox = [west, south, east, north];
  }

  // Datetime range. Default to the last year when unspecified — every STAC search example
  // in the PC docs includes a datetime, and it lets pgSTAC prune partitions instead of
  // scanning the whole archive.
  const to = params.dateRange?.to ?? new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
  const from = params.dateRange?.from ?? defaultFrom.toISOString().slice(0, 10);
  body.datetime = `${from}/${to}`;
  const dateRangeDefaulted = params.dateRange?.from == null && params.dateRange?.to == null;

  // Cloud cover filter via the STAC Query extension. The comparison value MUST be a
  // STRING, not a number — pgSTAC only uses its property index when the value is a string
  // (this is why pystac-client sends all query values as strings). Passing a JSON number
  // forces a full archive scan and reliably times out (HTTP 504).
  // Also: do NOT send `filter-lang: cql2-json` alongside `query` — pgSTAC rejects both
  // together ("Query extension is not available when using pgstac with cql2").
  if (params.cloudCoverMax != null) {
    body.query = { "eo:cloud_cover": { lte: String(params.cloudCoverMax) } };
  }

  // The PC /search endpoint occasionally returns a transient 504 under load. Retry once.
  let resp = await fetch(`${providerConfig.baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (resp.status === 504) {
    resp = await fetch(`${providerConfig.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`STAC search failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const items: StacItem[] = Array.isArray(json?.features) ? json.features : [];

  return {
    items,
    totalMatched: json?.context?.matched ?? json?.numberMatched ?? undefined,
    provider: params.provider,
    providerLabel: providerConfig.label,
    effectiveDateRange: { from, to },
    dateRangeDefaulted,
  };
}

// ── Mosaic registration ────────────────────────────────────────────────────────
// A mosaic renders the WHOLE result set as one seamless layer (cloud-free composite
// when sorted by cloud cover), instead of stacking individual scene layers. PC's
// /mosaic/register returns a searchId; tiles are then served from a tilejson endpoint.

export interface StacMosaicRegistration {
  searchId: string;
  /** Base tilejson URL (render params still need to be appended by the caller). */
  tilejsonUrl: string;
  provider: StacProvider;
  providerLabel: string;
}

const PC_DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1";

/**
 * Register a mosaic search with Planetary Computer. The search is sorted by ascending
 * cloud cover so the mosaic favors the clearest pixels. Only supported for PC.
 */
export async function registerStacMosaic(params: StacSearchParams): Promise<StacMosaicRegistration> {
  const providerConfig = STAC_PROVIDERS.find((p) => p.id === params.provider)!;

  const body: Record<string, unknown> = {
    // Sort clearest-first so the mosaic's top-of-stack pixels are the least cloudy.
    sortby: [{ field: "eo:cloud_cover", direction: "asc" }],
  };
  if (params.collections?.length) body.collections = params.collections;
  if (params.bbox) {
    const { west, south, east, north } = params.bbox;
    body.bbox = [west, south, east, north];
  }
  const to = params.dateRange?.to ?? new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
  const from = params.dateRange?.from ?? defaultFrom.toISOString().slice(0, 10);
  body.datetime = `${from}/${to}`;
  if (params.cloudCoverMax != null) {
    body.query = { "eo:cloud_cover": { lte: String(params.cloudCoverMax) } };
  }

  const resp = await fetch(`${PC_DATA_API}/mosaic/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Mosaic registration failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await resp.json();
  const searchId: string | undefined = json?.id;
  if (!searchId) throw new Error("Mosaic registration returned no search id.");

  const tilejsonLink = Array.isArray(json?.links)
    ? json.links.find((l: any) => l?.rel === "tilejson")?.href
    : undefined;
  const tilejsonUrl =
    (typeof tilejsonLink === "string" && tilejsonLink) ||
    `${PC_DATA_API}/mosaic/${searchId}/tilejson.json`;

  return {
    searchId,
    tilejsonUrl,
    provider: params.provider,
    providerLabel: providerConfig.label,
  };
}

// ── Collection listing ────────────────────────────────────────────────────────

export interface StacCollection {
  id: string;
  title?: string;
  description?: string;
}

export async function listStacCollections(provider: StacProvider): Promise<StacCollection[]> {
  const providerConfig = STAC_PROVIDERS.find((p) => p.id === provider)!;
  try {
    const resp = await fetch(`${providerConfig.baseUrl}/collections`);
    if (!resp.ok) return [];
    const json = await resp.json();
    const raw = Array.isArray(json?.collections) ? json.collections : [];
    return raw.map((c: any) => ({
      id: String(c.id ?? ""),
      title: c.title ? String(c.title) : undefined,
      description: c.description ? String(c.description).slice(0, 200) : undefined,
    })).filter((c: StacCollection) => c.id);
  } catch {
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the best browser-renderable thumbnail URL for a STAC item.
 * Priority: item links thumbnail (CORS-safe API endpoint) → thumbnail asset (JPEG/PNG/WEBP)
 * → rendered_preview asset → overview asset.
 * Deliberately excludes COG/TIFF assets — browsers cannot render them as <img>.
 */
export function getBestThumbnailUrl(item: StacItem): string | null {
  // 1. Prefer the thumbnail link served by the STAC API itself (CORS-safe).
  // Skip "preview" links that point to an interactive map page (not a raw image).
  const thumbLink = item.links?.find(
    (l) =>
      l.rel === "thumbnail" &&
      l.href &&
      !l.href.includes("/item/map") &&
      !l.href.includes("/explorer"),
  );
  if (thumbLink?.href) return thumbLink.href;

  // 2. Thumbnail/preview assets that are browser-renderable image types.
  // rendered_preview on Planetary Computer is a PNG served from their API (CORS-safe).
  const browserImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  for (const key of ["rendered_preview", "thumbnail", "overview"]) {
    const asset = item.assets[key];
    if (asset && browserImageTypes.some((t) => asset.type?.startsWith(t))) {
      return asset.href;
    }
  }

  // 3. Any asset explicitly typed as a browser image (not TIFF)
  for (const asset of Object.values(item.assets)) {
    if (
      asset.type &&
      browserImageTypes.some((t) => asset.type!.startsWith(t)) &&
      !asset.type.includes("tiff")
    ) {
      return asset.href;
    }
  }

  return null;
}

/** Return the best COG (Cloud Optimized GeoTIFF) asset href for loading as ImageryTileLayer. */
export function getBestCogAsset(item: StacItem): StacAsset | null {
  const cogMime = "image/tiff; application=geotiff; profile=cloud-optimized";

  // Prefer visual/TCI band composite
  for (const key of ["visual", "tci", "true_color"]) {
    const a = item.assets[key];
    if (a && (a.type === cogMime || a.roles?.includes("overview"))) return a;
  }

  // Any COG by MIME
  for (const asset of Object.values(item.assets)) {
    if (asset.type === cogMime) return asset;
  }

  // Any GeoTIFF with "data" role
  for (const asset of Object.values(item.assets)) {
    if (asset.type?.includes("tiff") && asset.roles?.includes("data")) return asset;
  }

  return null;
}

/** Format item datetime for display. */
export function formatItemDate(item: StacItem): string {
  const dt = item.properties["datetime"] ?? item.properties["start_datetime"];
  if (!dt || typeof dt !== "string") return "Unknown date";
  try {
    return new Date(dt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(dt).slice(0, 10);
  }
}

/** Extract cloud cover percentage (0–100) from item properties. */
export function getCloudCover(item: StacItem): number | null {
  const cc = item.properties["eo:cloud_cover"];
  if (cc == null) return null;
  const n = Number(cc);
  return isNaN(n) ? null : Math.round(n * 10) / 10;
}
