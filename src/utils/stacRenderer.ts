/**
 * STAC imagery renderer.
 *
 * Loads STAC items onto the ArcGIS map as:
 *   - ImageryTileLayer (COG) for raster display
 *   - GraphicsLayer  for item bounding-box footprints with rich metadata popups
 *
 * All layers are grouped under a single GroupLayer with a stable ID so they can
 * be replaced cleanly between searches.
 */

import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GroupLayer from "@arcgis/core/layers/GroupLayer";
import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import Extent from "@arcgis/core/geometry/Extent";
import type { StacItem, StacMosaicRegistration } from "./stacApi";
import { getBestCogAsset, getBestThumbnailUrl, formatItemDate, getCloudCover } from "./stacApi";
import {
  buildRasterFunctionTileTemplate,
  collectionSupportsRasterFunctions,
  supportedRasterFunctionCollections,
  type RasterFunctionDef,
} from "./stacRasterFunctions";

// ── Stable layer IDs ──────────────────────────────────────────────────────────

export const STAC_GROUP_LAYER_ID = "stac-results-group";
export const STAC_FOOTPRINT_LAYER_ID = "stac-footprints";
export const STAC_MOSAIC_LAYER_ID = "stac-mosaic";

// True-color render config per collection for the mosaic (which asset(s) to display).
// Sentinel-2 and Landsat both ship a pre-rendered `visual` true-color asset.
const MOSAIC_TRUE_COLOR: Record<string, { assets: string; asset_bidx?: string }> = {
  "sentinel-2-l2a": { assets: "visual", asset_bidx: "visual|1,2,3" },
  "landsat-c2-l2": { assets: "red,green,blue", asset_bidx: undefined },
};

// ── Symbols ───────────────────────────────────────────────────────────────────

const FOOTPRINT_SYMBOL = {
  type: "simple-fill",
  color: [255, 140, 0, 0.06],
  outline: { color: [255, 140, 0, 0.9], width: 1.6 },
};

// ── Popup HTML builder ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:600;background:${color};color:#fff;white-space:nowrap">${esc(text)}</span>`;
}

function kvRow(label: string, value: string): string {
  return `<tr>
    <td style="color:#6a7783;font-size:0.75rem;font-weight:600;padding:3px 8px 3px 0;white-space:nowrap;vertical-align:top">${esc(label)}</td>
    <td style="color:#23313d;font-size:0.80rem;padding:3px 0;vertical-align:top">${esc(value)}</td>
  </tr>`;
}

function buildItemPopupContent(item: StacItem, providerLabel: string): string {
  const props = item.properties;
  const date = formatItemDate(item);
  const cloudCover = getCloudCover(item);
  const collection = item.collection ?? (props["collection"] as string) ?? "";

  const thumbnailUrl = getBestThumbnailUrl(item);
  const cogAsset = getBestCogAsset(item);

  // --- Badge row ---
  const badges: string[] = [];
  if (cloudCover != null) {
    const cc = cloudCover;
    const bgColor = cc <= 10 ? "#1a8a3a" : cc <= 30 ? "#e8920a" : "#c0392b";
    badges.push(badge(`☁ ${cc}% cloud`, bgColor));
  }
  if (collection) badges.push(badge(collection, "#005e95"));

  // --- Metadata rows ---
  const rows: string[] = [];
  rows.push(kvRow("Date", date));
  rows.push(kvRow("Item ID", item.id));
  if (collection) rows.push(kvRow("Collection", collection));
  if (cloudCover != null) rows.push(kvRow("Cloud Cover", `${cloudCover}%`));

  const platform = props["platform"] ?? props["constellation"];
  if (platform) rows.push(kvRow("Platform", String(platform)));

  const gsd = props["gsd"];
  if (gsd != null) rows.push(kvRow("GSD", `${gsd} m`));

  const epsg = props["proj:epsg"];
  if (epsg != null) rows.push(kvRow("EPSG", String(epsg)));

  // --- Links ---
  const links: string[] = [];
  if (cogAsset) {
    links.push(
      `<a href="${esc(cogAsset.href)}" target="_blank" rel="noopener noreferrer"
         style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:#005e95;
                text-decoration:none;padding:4px 8px;border:1px solid #c7dbe8;border-radius:8px;
                background:#f6fbff">COG Asset</a>`,
    );
  }

  const selfLink = item.links?.find((l) => l.rel === "self");
  if (selfLink) {
    links.push(
      `<a href="${esc(selfLink.href)}" target="_blank" rel="noopener noreferrer"
         style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:#005e95;
                text-decoration:none;padding:4px 8px;border:1px solid #c7dbe8;border-radius:8px;
                background:#f6fbff">STAC Item</a>`,
    );
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:340px">
  ${thumbnailUrl
    ? `<img src="${esc(thumbnailUrl)}" crossorigin="anonymous"
           style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;margin-bottom:10px;background:#e8edf2"
           loading="lazy"
           onerror="this.style.display='none'">`
    : ""}
  ${badges.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${badges.join("")}</div>` : ""}
  <table style="border-collapse:collapse;width:100%;margin-bottom:10px">
    ${rows.join("")}
  </table>
  <div style="font-size:0.72rem;color:#8a9099;margin-bottom:6px">${esc(providerLabel)}</div>
  ${links.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${links.join("")}</div>` : ""}
</div>`;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function itemToPolygon(item: StacItem): Polygon | Extent | null {
  const geom = item.geometry as any;
  if (geom?.type === "Polygon" && Array.isArray(geom.coordinates)) {
    try {
      return new Polygon({
        rings: (geom as any).coordinates,
        spatialReference: { wkid: 4326 },
      });
    } catch {
      // fall through to bbox
    }
  }

  if (geom?.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    try {
      const rings = geom.coordinates.flat(1);
      return new Polygon({ rings, spatialReference: { wkid: 4326 } });
    } catch {
      // fall through
    }
  }

  // Use bbox
  const bb = item.bbox;
  if (Array.isArray(bb) && bb.length >= 4) {
    const [xmin, ymin, xmax, ymax] = bb;
    return new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } });
  }

  return null;
}

// ── View accessor ─────────────────────────────────────────────────────────────

function getMapView(): any {
  const mapEl = document.querySelector("#main-map") as any;
  return mapEl?.view ?? null;
}

// ── Clear existing STAC layers ────────────────────────────────────────────────

export function clearStacLayers(): void {
  const view = getMapView();
  if (!view?.map) return;

  const layers = view.map.layers?.toArray?.() ?? [];
  for (const layer of layers) {
    const lid = String(layer?.id ?? "");
    if (
      lid === STAC_GROUP_LAYER_ID ||
      lid === STAC_FOOTPRINT_LAYER_ID ||
      lid === STAC_MOSAIC_LAYER_ID ||
      lid.startsWith("stac-imagery-") ||
      lid.startsWith(STAC_RASTERFN_LAYER_PREFIX)
    ) {
      view.map.remove(layer);
    }
  }
}

// ── Main render function ──────────────────────────────────────────────────────

export interface StacRenderOptions {
  /** Load the best COG as ImageryTileLayer for each item (may be slow for many items). */
  loadImagery?: boolean;
  /** Maximum number of imagery layers to load (default 3 to avoid overwhelming the map). */
  maxImageryLayers?: number;
  providerLabel: string;
  /**
   * Remove previously-rendered STAC layers before adding the new ones. Default true.
   * Set false to keep prior footprints/imagery on the map (additive search).
   */
  clearPrevious?: boolean;
}

export interface StacRenderResult {
  footprintsAdded: number;
  imageryLayersAdded: number;
  warnings: string[];
}

export async function renderStacItems(
  items: StacItem[],
  options: StacRenderOptions,
): Promise<StacRenderResult> {
  const view = getMapView();
  if (!view?.map) {
    return { footprintsAdded: 0, imageryLayersAdded: 0, warnings: ["Map view not available."] };
  }

  if (options.clearPrevious ?? true) {
    clearStacLayers();
  }

  const result: StacRenderResult = { footprintsAdded: 0, imageryLayersAdded: 0, warnings: [] };
  const maxImagery = options.maxImageryLayers ?? 3;
  const groupLayers: any[] = [];

  // ── 1. Footprint graphics layer ───────────────────────────────────────────
  const footprintGraphics: Graphic[] = [];

  for (const item of items) {
    const polygon = itemToPolygon(item);
    if (!polygon) continue;

    const graphic = new Graphic({
      geometry: polygon as any,
      symbol: FOOTPRINT_SYMBOL as any,
      attributes: { stac_item_id: item.id },
      popupTemplate: {
        title: `${item.collection ? `[${item.collection}] ` : ""}${formatItemDate(item)} — ${item.id}`,
        content: buildItemPopupContent(item, options.providerLabel),
        outFields: ["*"],
      } as any,
    });
    footprintGraphics.push(graphic);
    result.footprintsAdded++;
  }

  if (footprintGraphics.length) {
    const footprintsLayer = new GraphicsLayer({
      id: STAC_FOOTPRINT_LAYER_ID,
      title: "STAC Footprints",
      graphics: footprintGraphics,
      listMode: "show",
    } as any);
    groupLayers.push(footprintsLayer);
  }

  // ── 2. Imagery tile layers (best items only) ─────────────────────────────
  // The Planetary Computer `tilejson` asset is a metadata endpoint that returns JSON
  // describing the actual {z}/{x}/{y} tile URLs — it is NOT itself a tile or raster URL.
  // Feeding it to ImageryTileLayer fails (ArcGIS strips its query params and the layerview
  // errors out, which previously broke the whole map view). Instead: fetch the tilejson,
  // read tiles[0], and load it as a WebTileLayer (designed for XYZ tile templates).
  if (options.loadImagery) {
    const itemsWithTiles = items
      .slice(0, maxImagery * 3)
      .filter((item) => item.assets["tilejson"]?.href != null)
      .slice(0, maxImagery);

    for (const item of itemsWithTiles) {
      const tilejsonUrl = item.assets["tilejson"].href;
      try {
        const tj = await fetch(tilejsonUrl).then((r) => (r.ok ? r.json() : null));
        const template: string | undefined = Array.isArray(tj?.tiles) ? tj.tiles[0] : undefined;
        if (!template) {
          result.warnings.push(`No tile template for ${item.id}.`);
          continue;
        }

        // Constrain the layer to the item footprint (tilejson `bounds` = [w,s,e,n] in
        // lon/lat). Each STAC item only has tiles within its footprint; without this,
        // ArcGIS requests tiles outside the data at low zoom and floods the console with
        // 404s. Fall back to the item bbox if tilejson omits bounds.
        const b: number[] | undefined =
          Array.isArray(tj?.bounds) && tj.bounds.length >= 4 ? tj.bounds : item.bbox;
        const fullExtent = b
          ? new Extent({ xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3], spatialReference: { wkid: 4326 } })
          : undefined;

        const tileLayer = await createPcTileLayer(template, {
          id: `stac-imagery-${item.id.slice(0, 24)}`,
          title: `${item.collection ?? "STAC"} — ${formatItemDate(item)}`,
          opacity: 0.9,
          fullExtent,
          geoBounds: b,
          maxZoom: typeof tj?.maxzoom === "number" ? tj.maxzoom : undefined,
        });
        groupLayers.push(tileLayer);
        result.imageryLayersAdded++;
      } catch (e: any) {
        result.warnings.push(`Could not load imagery for ${item.id}: ${e?.message ?? String(e)}`);
      }
    }

    if (itemsWithTiles.length === 0 && options.loadImagery) {
      result.warnings.push("No tile server URLs found in the returned items.");
    }
  }

  // ── 3. Add all as a GroupLayer ────────────────────────────────────────────
  if (!groupLayers.length) return result;

  const group = new GroupLayer({
    id: STAC_GROUP_LAYER_ID,
    title: "STAC Results",
    listMode: "show",
    visibilityMode: "independent",
    layers: groupLayers,
  });

  view.map.add(group);

  // Zoom to footprints
  if (footprintGraphics.length) {
    try {
      await view.goTo(footprintGraphics, {
        animate: true,
        duration: footprintGraphics.length <= 2 ? 380 : 600,
      });
    } catch {
      // ignore navigation errors
    }
  }

  return result;
}

// ── Load imagery for a single already-found scene ─────────────────────────────
// Used by the "load <scene> on map" flow: render just this item's true-color
// tiles without clearing footprints or running a new search. Keeps the footprint
// layer intact so selection/highlight still works.

export async function loadStacItemImagery(
  item: StacItem,
  providerLabel: string,
): Promise<RasterFunctionRenderResult> {
  const view = getMapView();
  if (!view?.map) return { success: false, message: "Map view not available." };

  const tilejsonUrl = item.assets["tilejson"]?.href;
  if (!tilejsonUrl) {
    return {
      success: false,
      message:
        `Scene \`${item.id}\` has no tile server (tilejson) asset, so its true-color ` +
        `imagery can't be loaded. You can still apply a raster function (e.g. NDVI) to it.`,
    };
  }

  let template: string | undefined;
  let bounds: number[] | undefined;
  let maxZoom: number | undefined;
  try {
    const tj = await fetch(tilejsonUrl).then((r) => (r.ok ? r.json() : null));
    template = Array.isArray(tj?.tiles) ? tj.tiles[0] : undefined;
    bounds = Array.isArray(tj?.bounds) && tj.bounds.length >= 4 ? tj.bounds : item.bbox;
    maxZoom = typeof tj?.maxzoom === "number" ? tj.maxzoom : undefined;
  } catch (e: any) {
    return { success: false, message: `Failed to fetch tile info for \`${item.id}\`: ${e?.message ?? e}` };
  }
  if (!template) {
    return { success: false, message: `No tile template available for scene \`${item.id}\`.` };
  }

  const fullExtent = bounds
    ? new Extent({ xmin: bounds[0], ymin: bounds[1], xmax: bounds[2], ymax: bounds[3], spatialReference: { wkid: 4326 } })
    : undefined;

  const layerId = `stac-imagery-${item.id.slice(0, 24)}`;
  const existing = view.map.findLayerById(layerId);
  if (existing) view.map.remove(existing);

  try {
    const tileLayer = await createPcTileLayer(template, {
      id: layerId,
      title: `${item.collection ?? "STAC"} — ${formatItemDate(item)}`,
      opacity: 0.95,
      fullExtent,
      geoBounds: bounds,
      maxZoom,
    });
    view.map.add(tileLayer);
    if (fullExtent) {
      try {
        await view.goTo(fullExtent, { animate: true, duration: 500 });
      } catch {
        // ignore navigation errors
      }
    }
    return {
      success: true,
      message: `Loaded true-color imagery for scene \`${item.id}\` (${item.collection ?? providerLabel}) onto the map.`,
    };
  } catch (e: any) {
    return { success: false, message: `Could not load imagery for \`${item.id}\`: ${e?.message ?? String(e)}` };
  }
}

// ── Render a registered mosaic as one seamless layer ──────────────────────────

export interface MosaicRenderResult {
  success: boolean;
  message: string;
}

/**
 * Render a registered PC mosaic (the whole search result set, cloud-sorted) as a single
 * true-color tile layer. `collections` is the resolved collection list from the search;
 * the first one with a known true-color render config is used. Replaces any prior mosaic
 * but leaves footprints/other STAC layers intact.
 */
export async function renderStacMosaic(
  registration: StacMosaicRegistration,
  collections: string[],
  bbox: { west: number; south: number; east: number; north: number } | undefined,
): Promise<MosaicRenderResult> {
  const view = getMapView();
  if (!view?.map) return { success: false, message: "Map view not available." };

  const collection = collections.find((c) => c in MOSAIC_TRUE_COLOR);
  if (!collection) {
    return {
      success: false,
      message:
        "Mosaics currently support true-color rendering only for Sentinel-2 and Landsat. " +
        "Search one of those collections to build a mosaic.",
    };
  }

  const renderCfg = MOSAIC_TRUE_COLOR[collection];
  const params = new URLSearchParams();
  params.set("collection", collection);
  params.set("assets", renderCfg.assets);
  if (renderCfg.asset_bidx) params.set("asset_bidx", renderCfg.asset_bidx);

  const tilejsonUrl = `${registration.tilejsonUrl}?${params.toString()}`;

  let template: string | undefined;
  let bounds: number[] | undefined;
  let maxZoom: number | undefined;
  try {
    const tj = await fetch(tilejsonUrl).then((r) => (r.ok ? r.json() : null));
    template = Array.isArray(tj?.tiles) ? tj.tiles[0] : undefined;
    bounds =
      Array.isArray(tj?.bounds) && tj.bounds.length >= 4
        ? tj.bounds
        : bbox
        ? [bbox.west, bbox.south, bbox.east, bbox.north]
        : undefined;
    maxZoom = typeof tj?.maxzoom === "number" ? tj.maxzoom : undefined;
  } catch (e: any) {
    return { success: false, message: `Failed to fetch mosaic tile info: ${e?.message ?? e}` };
  }
  if (!template) {
    return { success: false, message: "The mosaic returned no tile template." };
  }

  const fullExtent = bounds
    ? new Extent({ xmin: bounds[0], ymin: bounds[1], xmax: bounds[2], ymax: bounds[3], spatialReference: { wkid: 4326 } })
    : undefined;

  const existing = view.map.findLayerById(STAC_MOSAIC_LAYER_ID);
  if (existing) view.map.remove(existing);

  try {
    const layer = await createPcTileLayer(template, {
      id: STAC_MOSAIC_LAYER_ID,
      title: `${collection} mosaic (cloud-sorted)`,
      opacity: 1,
      fullExtent,
      geoBounds: bounds,
      maxZoom,
    });
    view.map.add(layer);
    if (fullExtent) {
      try {
        await view.goTo(fullExtent, { animate: true, duration: 500 });
      } catch {
        // ignore navigation errors
      }
    }
    return {
      success: true,
      message: `Loaded a cloud-sorted **${collection}** mosaic across your search area onto the map.`,
    };
  } catch (e: any) {
    return { success: false, message: `Could not load the mosaic: ${e?.message ?? String(e)}` };
  }
}

/** Remove the mosaic layer from the map. */
export function clearStacMosaic(): void {
  const view = getMapView();
  if (!view?.map) return;
  const existing = view.map.findLayerById(STAC_MOSAIC_LAYER_ID);
  if (existing) view.map.remove(existing);
}

// ── PC tile layer factory (BaseTileLayer) ─────────────────────────────────────
// WebTileLayer mangles the heavily-encoded PC tile templates (it can double-encode the
// query string and silently request nothing). A BaseTileLayer subclass that builds the
// tile URL itself avoids all template-parsing quirks — this is Esri's documented pattern
// for custom tile sources. Built lazily so @arcgis/core BaseTileLayer is only imported
// when imagery is actually loaded.

interface PcTileLayerOpts {
  id: string;
  title: string;
  opacity?: number;
  fullExtent?: Extent;
  /** Geographic footprint bounds [west, south, east, north] in lon/lat, for tile culling. */
  geoBounds?: number[];
  /** Highest zoom the source actually has tiles for; tiles beyond this are skipped. */
  maxZoom?: number;
}

// Web Mercator tile (z/x/y) → geographic bounds [west, south, east, north].
function tileToGeoBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (xt: number) => (xt / n) * 360 - 180;
  const lat = (yt: number) => {
    const m = Math.PI - (2 * Math.PI * yt) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m)));
  };
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

async function createPcTileLayer(template: string, opts: PcTileLayerOpts): Promise<any> {
  const [{ default: BaseTileLayer }, { default: TileInfo }] =
    await Promise.all([
      import("@arcgis/core/layers/BaseTileLayer"),
      import("@arcgis/core/layers/support/TileInfo"),
    ]);

  const geoBounds = opts.geoBounds;
  const maxZoom = opts.maxZoom;

  // Resolve {z}/{x}/{y} (and {level}/{col}/{row}) without touching the encoded query string.
  const buildUrl = (level: number, row: number, col: number): string =>
    template
      .replace(/\{z\}/g, String(level))
      .replace(/\{level\}/g, String(level))
      .replace(/\{x\}/g, String(col))
      .replace(/\{col\}/g, String(col))
      .replace(/\{y\}/g, String(row))
      .replace(/\{row\}/g, String(row));

  const PcTileLayer = (BaseTileLayer as any).createSubclass({
    getTileUrl(level: number, row: number, col: number) {
      return buildUrl(level, row, col);
    },
    async fetchTile(level: number, row: number, col: number, options: any) {
      const blank = () => {
        const { tileInfo } = this as any;
        const size = tileInfo?.size?.[0] ?? 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        return canvas;
      };

      // Cull tiles that can only 404, BEFORE hitting the network — this is what
      // stops the console flood on deep zoom:
      //   1. Past the source's max zoom (overzoom beyond available resolution).
      //   2. Outside the item footprint (the tile grid around a small scene
      //      includes many no-data tiles at high zoom).
      if (maxZoom != null && level > maxZoom) return blank();
      if (geoBounds) {
        const [tw, ts, te, tn] = tileToGeoBounds(level, col, row);
        const [fw, fs, fe, fn] = geoBounds;
        const intersects = tw < fe && te > fw && ts < fn && tn > fs;
        if (!intersects) return blank();
      }

      const url = buildUrl(level, row, col);
      // Use native fetch — NOT esriRequest — for these PC tile URLs. esriRequest
      // re-serializes the query string, converting the `+` spaces in the tilejson
      // `color_formula` into literal `%2B`, which PC's TiTiler reads as plus signs
      // and rejects with HTTP 500. Native fetch sends the template byte-for-byte.
      try {
        const resp = await fetch(url, { signal: options?.signal });
        if (!resp.ok) return blank();
        const blob = await resp.blob();
        if (typeof createImageBitmap === "function") {
          return await createImageBitmap(blob);
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = URL.createObjectURL(blob);
        await img.decode().catch(() => undefined);
        return img;
      } catch {
        return blank();
      }
    },
  });

  // fullExtent must be in the SAME spatial reference as tileInfo (Web Mercator). The item
  // bbox is WGS84; mixing them yields an empty visible area and the view schedules NO tile
  // fetches (layer loads but stays blank). Project the extent to 3857; if projection isn't
  // ready, omit fullExtent entirely — out-of-footprint tiles already fall back to a blank
  // canvas, so we don't strictly need it.
  let projectedExtent: Extent | undefined;
  if (opts.fullExtent) {
    try {
      const { geographicToWebMercator } = await import(
        "@arcgis/core/geometry/support/webMercatorUtils"
      );
      projectedExtent = geographicToWebMercator(opts.fullExtent) as Extent;
    } catch {
      projectedExtent = undefined;
    }
  }

  return new PcTileLayer({
    id: opts.id,
    title: opts.title,
    listMode: "show",
    opacity: opts.opacity ?? 0.95,
    // BaseTileLayer needs an explicit tileInfo (unlike WebTileLayer it doesn't inherit one).
    // Without it the view never schedules tile fetches — the layer "loads" but stays blank.
    tileInfo: TileInfo.create({ spatialReference: { wkid: 3857 } as any }),
    ...(projectedExtent ? { fullExtent: projectedExtent } : {}),
  });
}

// ── Apply a raster function to a single scene ──────────────────────────────────

export const STAC_RASTERFN_LAYER_PREFIX = "stac-rasterfn-";

export interface RasterFunctionRenderResult {
  success: boolean;
  message: string;
}

/**
 * Render one STAC item with a raster function (NDVI, composite, etc.) as a custom
 * BaseTileLayer. PC computes the band math server-side; we load the resulting colorized
 * tiles. The layer's fullExtent is projected to Web Mercator to match its tileInfo so the
 * view actually schedules tile fetches.
 */
export async function renderStacItemWithFunction(
  item: StacItem,
  fn: RasterFunctionDef,
): Promise<RasterFunctionRenderResult> {
  const view = getMapView();
  if (!view?.map) {
    return { success: false, message: "Map view not available." };
  }

  const template = buildRasterFunctionTileTemplate(item, fn);
  if (!template) {
    // Distinguish "collection isn't supported for band math" from "this specific
    // scene is missing a band" — they need different user guidance.
    if (!collectionSupportsRasterFunctions(item)) {
      return {
        success: false,
        message:
          `**${fn.label}** can't be applied to \`${item.collection ?? "this scene"}\` — ` +
          `band-index math is currently supported only for: ` +
          supportedRasterFunctionCollections().map((c) => `\`${c}\``).join(", ") + ". " +
          "Search Sentinel-2 or Landsat imagery to use raster functions.",
      };
    }
    return {
      success: false,
      message: `**${fn.label}** can't be applied to this scene — it lacks the required bands.`,
    };
  }

  // Footprint extent so ArcGIS only requests in-bounds tiles.
  let fullExtent: Extent | undefined;
  if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
    const [xmin, ymin, xmax, ymax] = item.bbox;
    fullExtent = new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } });
  }

  const layerId = `${STAC_RASTERFN_LAYER_PREFIX}${fn.key}-${item.id.slice(0, 20)}`;

  // Remove an existing layer for the same scene+function so re-applying replaces it.
  const existing = view.map.findLayerById(layerId);
  if (existing) view.map.remove(existing);

  try {
    const layer = await createPcTileLayer(template, {
      id: layerId,
      title: `${fn.label} — ${item.id.slice(0, 18)} — ${formatItemDate(item)}`,
      opacity: 0.95,
      fullExtent,
      geoBounds:
        Array.isArray(item.bbox) && item.bbox.length >= 4
          ? (item.bbox as number[])
          : undefined,
    });

    view.map.add(layer);
    try {
      if (typeof (layer as any).load === "function") await (layer as any).load();
    } catch (loadErr) {
      return {
        success: false,
        message: `The **${fn.label}** layer failed to load: ${(loadErr as any)?.message ?? loadErr}`,
      };
    }

    if (fullExtent) {
      try {
        await view.goTo(fullExtent, { animate: true, duration: 500 });
      } catch {
        // ignore navigation errors
      }
    }

    return {
      success: true,
      message: `Applied **${fn.label}** to scene \`${item.id}\` and added it to the map.`,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `Could not apply **${fn.label}**: ${e?.message ?? String(e)}`,
    };
  }
}

/** Remove all raster-function layers from the map. */
export function clearStacRasterFunctions(): void {
  const view = getMapView();
  if (!view?.map) return;
  const layers = view.map.layers?.toArray?.() ?? [];
  for (const layer of layers) {
    if (String(layer?.id ?? "").startsWith(STAC_RASTERFN_LAYER_PREFIX)) {
      view.map.remove(layer);
    }
  }
}
