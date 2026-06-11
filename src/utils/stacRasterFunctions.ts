/**
 * STAC raster-function registry for Microsoft Planetary Computer.
 *
 * Each function maps to a set of PC TiTiler tile-endpoint parameters. PC renders the
 * band math / composite server-side and returns colorized PNG tiles, which we load as a
 * WebTileLayer (same path as plain imagery). This is the standard PC/Esri pattern — no
 * SAS auth or client-side multi-COG juggling required.
 *
 * Verified against the live endpoint, e.g. NDVI:
 *   /item/tiles/.../{z}/{x}/{y}?expression=(B08-B04)/(B08+B04)&asset_as_band=true
 *     &rescale=-1,1&colormap_name=rdylgn
 */

import type { StacItem } from "./stacApi";

export interface RasterFunctionDef {
  key: string;
  label: string;
  /** Short description shown to the user. */
  description: string;
  /** Collections this function applies to (collection IDs). Empty = any optical collection. */
  collections?: string[];
  /**
   * Build the PC tile-endpoint query params (everything after `{z}/{x}/{y}?`), excluding
   * the collection/item identity which the caller adds. Returns null if not applicable to
   * the given item (e.g. required bands missing).
   */
  buildParams: (item: StacItem) => URLSearchParams | null;
}

// ── Logical band → per-collection asset name mapping ───────────────────────────
// Index/composite math is expressed in LOGICAL band names (nir, red, green, …).
// Each supported collection maps those to its actual STAC asset keys. This lets
// the same NDVI/NDWI/etc. definition work on Sentinel-2, Landsat, and any future
// collection — instead of hard-coding Sentinel-2's "B08"/"B04" names.

type LogicalBand = "blue" | "green" | "red" | "nir" | "swir16" | "swir22";

const BAND_MAPS: Record<string, Partial<Record<LogicalBand, string>>> = {
  // Sentinel-2 L2A
  "sentinel-2-l2a": {
    blue: "B02", green: "B03", red: "B04", nir: "B08", swir16: "B11", swir22: "B12",
  },
  // Landsat Collection 2 Level-2 (L4–L9), served as named assets on PC
  "landsat-c2-l2": {
    blue: "blue", green: "green", red: "red", nir: "nir08", swir16: "swir16", swir22: "swir22",
  },
};

/** Resolve the asset name for a logical band on a given item's collection, if available. */
function bandAsset(item: StacItem, band: LogicalBand): string | null {
  const map = item.collection ? BAND_MAPS[item.collection] : undefined;
  const assetName = map?.[band];
  if (assetName && item.assets[assetName]?.href != null) return assetName;
  return null;
}

/** Resolve all requested logical bands to asset names; null if any is unavailable. */
function resolveBands(item: StacItem, bands: LogicalBand[]): string[] | null {
  const resolved: string[] = [];
  for (const b of bands) {
    const name = bandAsset(item, b);
    if (!name) return null;
    resolved.push(name);
  }
  return resolved;
}

/** Index function via TiTiler `expression` + `asset_as_band` using two logical bands. */
function indexParams(
  item: StacItem,
  bandA: LogicalBand,
  bandB: LogicalBand,
  colormap: string,
): URLSearchParams | null {
  const resolved = resolveBands(item, [bandA, bandB]);
  if (!resolved) return null;
  const [a, b] = resolved;
  const p = new URLSearchParams();
  p.set("expression", `(${a}-${b})/(${a}+${b})`);
  p.set("asset_as_band", "true");
  p.set("rescale", "-1,1");
  p.set("colormap_name", colormap);
  p.set("format", "png");
  return p;
}

/** Composite function via multiple `assets` params (logical bands) with a shared rescale. */
function compositeParams(
  item: StacItem,
  bands: LogicalBand[],
  rescale = "0,3000",
): URLSearchParams | null {
  const resolved = resolveBands(item, bands);
  if (!resolved) return null;
  const p = new URLSearchParams();
  for (const b of resolved) p.append("assets", b);
  p.set("rescale", rescale);
  p.set("format", "png");
  return p;
}

export const RASTER_FUNCTIONS: RasterFunctionDef[] = [
  {
    key: "ndvi",
    label: "NDVI (vegetation)",
    description: "Normalized Difference Vegetation Index — green = healthy vegetation.",
    buildParams: (item) => indexParams(item, "nir", "red", "rdylgn"),
  },
  {
    key: "ndwi",
    label: "NDWI (water)",
    description: "Normalized Difference Water Index — highlights open water.",
    buildParams: (item) => indexParams(item, "green", "nir", "blues"),
  },
  {
    key: "ndmi",
    label: "NDMI (moisture)",
    description: "Normalized Difference Moisture Index — vegetation/soil water content.",
    buildParams: (item) => indexParams(item, "nir", "swir16", "viridis"),
  },
  {
    key: "false-color",
    label: "False-color (NIR)",
    description: "NIR-red-green composite — vegetation appears red.",
    buildParams: (item) => compositeParams(item, ["nir", "red", "green"]),
  },
  {
    key: "swir",
    label: "SWIR composite",
    description: "SWIR-NIR-red composite — burn scars, geology, moisture.",
    buildParams: (item) => compositeParams(item, ["swir22", "nir", "red"]),
  },
  {
    key: "agriculture",
    label: "Agriculture composite",
    description: "SWIR-NIR-blue composite — crop health and field boundaries.",
    buildParams: (item) => compositeParams(item, ["swir16", "nir", "blue"]),
  },
];

export function getRasterFunction(key: string): RasterFunctionDef | null {
  const lower = key.trim().toLowerCase();
  return (
    RASTER_FUNCTIONS.find((f) => f.key === lower) ??
    RASTER_FUNCTIONS.find((f) => f.label.toLowerCase().includes(lower)) ??
    null
  );
}

/** Human-readable list of available functions, for the agent to surface. */
export function listRasterFunctions(): string {
  return RASTER_FUNCTIONS.map((f) => `- **${f.key}** — ${f.description}`).join("\n");
}

/** Collection IDs for which band-index/composite math is supported. */
export function supportedRasterFunctionCollections(): string[] {
  return Object.keys(BAND_MAPS);
}

/** True if the item's collection has a known logical-band mapping. */
export function collectionSupportsRasterFunctions(item: StacItem): boolean {
  return item.collection != null && item.collection in BAND_MAPS;
}

/**
 * Build the full PC tile URL TEMPLATE ({z}/{x}/{y}) for an item + raster function.
 * Returns null if the function does not apply to this item or it's not a PC item.
 */
export function buildRasterFunctionTileTemplate(
  item: StacItem,
  fn: RasterFunctionDef,
): string | null {
  const params = fn.buildParams(item);
  if (!params) return null;

  const collection = item.collection;
  if (!collection) return null;

  params.set("collection", collection);
  params.set("item", item.id);

  return (
    "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/" +
    `{z}/{x}/{y}@1x?${params.toString()}`
  );
}

// ── Statistics ─────────────────────────────────────────────────────────────────

export interface BandStatistics {
  min: number;
  max: number;
  mean: number;
  median?: number;
  std?: number;
  count?: number;
  valid_percent?: number;
}

export interface RasterFunctionStatsResult {
  success: boolean;
  /** Per-band stats keyed by the band/expression name TiTiler returns. */
  bands?: Record<string, BandStatistics>;
  message?: string;
}

/**
 * Compute summary statistics (min/max/mean/…) for a raster function over a STAC item's
 * full footprint, via Planetary Computer's `/item/statistics` endpoint. PC evaluates the
 * band math server-side. Returns per-band stats keyed by TiTiler's band name.
 */
export async function computeRasterFunctionStatistics(
  item: StacItem,
  fn: RasterFunctionDef,
): Promise<RasterFunctionStatsResult> {
  const params = fn.buildParams(item);
  if (!params) {
    return {
      success: false,
      message: collectionSupportsRasterFunctions(item)
        ? `**${fn.label}** can't be computed for this scene — it lacks the required bands.`
        : `**${fn.label}** statistics aren't supported for \`${item.collection ?? "this collection"}\`.`,
    };
  }
  if (!item.collection) {
    return { success: false, message: "This item has no collection, so statistics can't be computed." };
  }

  // Reuse the tile params (expression / assets / asset_as_band) but drop tile-only keys.
  params.delete("format");
  params.delete("colormap_name");
  params.delete("rescale");
  params.set("collection", item.collection);
  params.set("item", item.id);

  const url =
    "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?" + params.toString();

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { success: false, message: `Statistics request failed (HTTP ${resp.status}): ${detail.slice(0, 160)}` };
    }
    const json: any = await resp.json();
    // PC returns either { properties: { statistics: {...} } } (POST/geojson) or a flat
    // band→stats object (GET over the whole item). Normalize both shapes.
    const raw = json?.properties?.statistics ?? json?.statistics ?? json;
    if (!raw || typeof raw !== "object") {
      return { success: false, message: "Statistics response was empty or in an unexpected format." };
    }
    const bands: Record<string, BandStatistics> = {};
    for (const [bandName, stats] of Object.entries(raw as Record<string, any>)) {
      if (stats && typeof stats === "object" && typeof (stats as any).mean === "number") {
        bands[bandName] = {
          min: (stats as any).min,
          max: (stats as any).max,
          mean: (stats as any).mean,
          median: (stats as any).median,
          std: (stats as any).std,
          count: (stats as any).count,
          valid_percent: (stats as any).valid_percent,
        };
      }
    }
    if (!Object.keys(bands).length) {
      return { success: false, message: "No numeric statistics were returned for this scene." };
    }
    return { success: true, bands };
  } catch (e: any) {
    return { success: false, message: `Statistics request error: ${e?.message ?? String(e)}` };
  }
}
