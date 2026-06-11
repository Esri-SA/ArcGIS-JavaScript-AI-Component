/**
 * STAC-Imagery Agent
 *
 * Natural language → Microsoft Planetary Computer STAC API → imagery on the map.
 * Beyond search, this agent loads specific scenes, applies band indices / composites
 * (NDVI, NDWI, NDMI, false-color, SWIR, agriculture), computes band-index statistics,
 * builds cloud-free mosaics, lists collections, and clears the imagery it added.
 * It automatically uses the current map extent as the bounding box unless the user
 * specifies a different area.
 */

import { StateGraph, Annotation as ANNOTATION, START, END } from "@langchain/langgraph/web";
import { invokeToolPrompt } from "@arcgis/ai-orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { extractLastUserText } from "../utils/agentHelpers";
import {
  searchStac,
  registerStacMosaic,
  resolveCollectionId,
  listStacCollections,
  formatItemDate,
  getCloudCover,
  getBestCogAsset,
  STAC_PROVIDERS,
  type StacItem,
  type StacProvider,
  type StacSearchParams,
} from "../utils/stacApi";
import {
  renderStacItems,
  renderStacMosaic,
  clearStacLayers,
  clearStacMosaic,
  renderStacItemWithFunction,
  loadStacItemImagery,
  clearStacRasterFunctions,
} from "../utils/stacRenderer";
import {
  getRasterFunction,
  listRasterFunctions,
  computeRasterFunctionStatistics,
  RASTER_FUNCTIONS,
  type RasterFunctionDef,
} from "../utils/stacRasterFunctions";

// ── Session store: last results ────────────────────────────────────────────────
// Module-level (single-user browser session). Persists across agent invocations so
// "apply NDVI to result 3" and "apply NDVI to the selected scene" both resolve.
// We do NOT track our own selection: clicking a footprint opens the view's built-in
// popup, and we read the selected scene from view.popup.selectedFeature instead of
// painting a custom symbol or owning a global click handler.

const sessionStore: {
  lastResults: StacItem[];
} = { lastResults: [] };

/** The stac_item_id of the footprint currently open in the map view's popup, if any. */
function getPopupSelectedItemId(): string | null {
  const view = (document.querySelector("#main-map") as any)?.view;
  const id = view?.popup?.selectedFeature?.attributes?.stac_item_id;
  return id != null ? String(id) : null;
}

/** Resolve a scene from the last results by: explicit ID, 1-based result number, or popup selection. */
function resolveTargetItem(opts: {
  itemId?: string | null;
  resultNumber?: number | null;
  useSelected?: boolean;
}): StacItem | null {
  const { lastResults } = sessionStore;

  if (opts.itemId) {
    const byId = lastResults.find((i) => i.id === opts.itemId);
    if (byId) return byId;
  }
  if (opts.resultNumber != null && opts.resultNumber >= 1) {
    const byNum = lastResults[opts.resultNumber - 1];
    if (byNum) return byNum;
  }
  if (opts.useSelected) {
    const selectedId = getPopupSelectedItemId();
    if (selectedId) {
      const bySel = lastResults.find((i) => i.id === selectedId);
      if (bySel) return bySel;
    }
  }
  return null;
}

/**
 * Explain why a scene reference could not be resolved against the current results,
 * distinguishing "no results in memory" (stale/never searched) from "number out of
 * range". Returns null if the reference is actually resolvable. Lets callers give a
 * precise message instead of a generic "couldn't identify the scene".
 */
function explainUnresolvedScene(opts: {
  resultNumber?: number | null;
  useSelected?: boolean;
}): string | null {
  const count = sessionStore.lastResults.length;
  if (count === 0) {
    return (
      "I don't have any imagery results in memory to act on — they may have been cleared " +
      "or this is a fresh session. Run a search first (e.g. _\"show Sentinel-2 over this area\"_), " +
      "then refer to a result by number."
    );
  }
  if (opts.resultNumber != null && opts.resultNumber > count) {
    return (
      `There ${count === 1 ? "is" : "are"} only **${count}** result${count !== 1 ? "s" : ""} ` +
      `in the last search, so result ${opts.resultNumber} doesn't exist. ` +
      `Pick a number between 1 and ${count}.`
    );
  }
  return null;
}

// ── Map extent helper ─────────────────────────────────────────────────────────

interface MapExtentResult {
  west: number;
  south: number;
  east: number;
  north: number;
}

function getMapExtentViaWebMercatorUtils(): MapExtentResult | null {
  // Attempt to resolve extent via the ArcGIS module system if available
  try {
    const mapEl = document.querySelector("#main-map") as any;
    const view = mapEl?.view;
    if (!view) return null;
    const extent = view.extent;
    if (!extent) return null;

    // If already geographic
    if (extent.spatialReference?.wkid === 4326 || !extent.spatialReference?.isWebMercator) {
      return {
        west: Math.max(-180, Math.min(180, extent.xmin)),
        south: Math.max(-90, Math.min(90, extent.ymin)),
        east: Math.max(-180, Math.min(180, extent.xmax)),
        north: Math.max(-90, Math.min(90, extent.ymax)),
      };
    }

    // Web Mercator → geographic conversion constants
    const R = 6378137;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toXMin = (lon: number) => R * toRad(lon);
    const toYMin = (lat: number) =>
      R * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));
    const fromX = (x: number) => (x / R) * (180 / Math.PI);
    const fromY = (y: number) =>
      (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

    // Only convert if values look like meters (Web Mercator range ~±20M)
    if (Math.abs(extent.xmin) > 181) {
      return {
        west: Math.max(-180, Math.min(180, fromX(extent.xmin))),
        south: Math.max(-90, Math.min(90, fromY(extent.ymin))),
        east: Math.max(-180, Math.min(180, fromX(extent.xmax))),
        north: Math.max(-90, Math.min(90, fromY(extent.ymax))),
      };
    }

    return {
      west: Math.max(-180, Math.min(180, extent.xmin)),
      south: Math.max(-90, Math.min(90, extent.ymin)),
      east: Math.max(-180, Math.min(180, extent.xmax)),
      north: Math.max(-90, Math.min(90, extent.ymax)),
    };
  } catch {
    return null;
  }
}

// ── Extraction tool ───────────────────────────────────────────────────────────

const stacQueryTool = tool(
  async (args) => JSON.stringify(args),
  {
    name: "extract_stac_query",
    description:
      "Extract all parameters needed to search for satellite/aerial imagery from the user's message.",
    schema: z.object({
      collections: z
        .array(z.string())
        .max(4)
        .describe(
          "Satellite/imagery collections the user wants. Examples: 'sentinel-2', 'landsat', 'naip', 'sentinel-1'. " +
          "Use common names — they will be resolved to provider-specific collection IDs. Empty if not specified.",
        ),
      provider: z
        .enum(["planetary-computer"])
        .describe("STAC provider. Always 'planetary-computer' — Microsoft Planetary Computer."),
      cloudCoverMax: z
        .number()
        .min(0)
        .max(100)
        .nullable()
        .describe(
          "Maximum cloud cover percentage (0–100). Use null if not specified by the user.",
        ),
      dateFrom: z
        .string()
        .nullable()
        .describe("Start date ISO-8601 (YYYY-MM-DD). Null if not specified."),
      dateTo: z
        .string()
        .nullable()
        .describe("End date ISO-8601 (YYYY-MM-DD). Null if not specified."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(24)
        .describe("Number of items to return (default 8, max 24)."),
      loadImagery: z
        .boolean()
        .describe(
          "True if the user explicitly wants to load/display/render the imagery on the map. " +
          "False (default) if they just want to search/list/explore items.",
        ),
      useMapExtent: z
        .boolean()
        .describe(
          "True (default) if the search should be restricted to the current map view extent. " +
          "False only if the user explicitly asks for a different area or global search.",
        ),
      clearPrevious: z
        .boolean()
        .describe(
          "Whether to clear previously-shown STAC results before showing the new ones. " +
          "True (default) — a new search replaces the prior results. " +
          "False ONLY if the user explicitly wants to ADD to / keep the existing results " +
          "(e.g. 'also show…', 'add Landsat too', 'keep the current ones').",
        ),
    }),
  },
);

const rasterFnTool = tool(
  async (args) => JSON.stringify(args),
  {
    name: "extract_raster_function",
    description:
      "Extract which raster function/band-index to apply and which scene to apply it to, " +
      "from the user's message about previously-found imagery results.",
    schema: z.object({
      functionKey: z
        .enum(RASTER_FUNCTIONS.map((f) => f.key) as [string, ...string[]])
        .describe(
          "The raster function to apply: " +
          RASTER_FUNCTIONS.map((f) => `'${f.key}' (${f.label})`).join(", ") + ".",
        ),
      resultNumber: z
        .number()
        .int()
        .min(1)
        .nullable()
        .describe(
          "1-based index of the scene in the last results list, if the user referred to it " +
          "by number (e.g. 'result 3', 'the second one'). Null otherwise.",
        ),
      itemId: z
        .string()
        .nullable()
        .describe("Exact STAC item ID if the user pasted/typed one. Null otherwise."),
      useSelected: z
        .boolean()
        .describe(
          "True if the user referred to the currently-selected/clicked scene " +
          "(e.g. 'this scene', 'the selected one', 'the one I clicked'). Default false.",
        ),
    }),
  },
);

// ── Intent classification ──────────────────────────────────────────────────────
// A single upfront LLM call decides which action the message wants, replacing a
// stack of brittle regexes. Regex is kept only as a fallback when the LLM call fails.

type StacAction =
  | "search"
  | "mosaic"
  | "load_scene"
  | "apply_function"
  | "function_statistics"
  | "list_collections"
  | "list_functions"
  | "clear";

const STAC_ACTIONS: [StacAction, ...StacAction[]] = [
  "search",
  "mosaic",
  "load_scene",
  "apply_function",
  "function_statistics",
  "list_collections",
  "list_functions",
  "clear",
];

const intentTool = tool(
  async (args) => JSON.stringify(args),
  {
    name: "classify_stac_intent",
    description:
      "Classify what the user wants to do with satellite/aerial imagery, so the right " +
      "handler runs. Choose the single best-fitting action.",
    schema: z.object({
      action: z.enum(STAC_ACTIONS).describe(
        "The action the user wants:\n" +
        "- 'search': find/show NEW imagery as individual scene footprints (by collection, area, date, cloud cover). The default for any request that names a satellite/collection or asks to find imagery, even if it also says 'load'/'show'.\n" +
        "- 'mosaic': build a single seamless / cloud-free MOSAIC or COMPOSITE across the whole area, rather than individual scenes. Triggers on 'mosaic', 'composite of the area', 'cloud-free mosaic', 'seamless image', 'stitch', 'blend the scenes'.\n" +
        "- 'load_scene': display a SPECIFIC already-found scene's true-color imagery, referenced by result number, pasted item ID, or current selection — with NO new collection/satellite named.\n" +
        "- 'apply_function': apply a band index / composite (NDVI, NDWI, NDMI, false-color, SWIR, agriculture) to an already-found scene, producing a colorized layer.\n" +
        "- 'function_statistics': report NUMERIC statistics (mean/min/max/median) of a band index over an already-found scene — the user wants numbers, not a layer.\n" +
        "- 'list_collections': list the available imagery collections/datasets.\n" +
        "- 'list_functions': list the available raster functions / band indices.\n" +
        "- 'clear': remove satellite/STAC imagery this agent added — footprints, COG scenes, raster-function (NDVI/etc.) layers, or the mosaic. Covers 'remove the mosaic', 'remove the sentinel-2 layer', 'clear the imagery', 'hide the satellite layers', and a general 'clear the map' / 'remove all layers' when it refers to the imagery shown.",
      ),
    }),
  },
);

/** Regex fallback classifier — mirrors the former hard-coded triage. */
function classifyStacIntentByRegex(text: string): StacAction {
  const t = text.trim();
  if (
    /list.*(collection|dataset|catalog)/i.test(t) ||
    /what.*(collection|satellite|sensor)/i.test(t) ||
    /available.*(collection|imagery)/i.test(t)
  ) return "list_collections";

  // Clearing/removing imagery this agent added. Covers the layer names we create
  // (mosaic, NDVI/raster-function, footprints, sentinel/landsat scene layers) plus
  // a bare "clear the map" / "remove all layers".
  if (
    /\b(clear|remove|hide|delete|get rid of)\b/i.test(t) &&
    /\b(stac|imagery|imag|satellite|aerial|results?|mosaic|composite|footprints?|scenes?|ndvi|ndwi|ndmi|raster function|band index|sentinel|landsat|naip|layers?|the map)\b/i.test(t)
  ) return "clear";

  if (/(list|what|which|available).*(raster function|band index|indices|ndvi)/i.test(t)) {
    return "list_functions";
  }

  if (/\b(mosaic|seamless|stitch|cloud[- ]?free (image|composite|mosaic)|composite of (the|this) (area|region|extent))\b/i.test(t)) {
    return "mosaic";
  }

  const mentionsFunction =
    /\b(ndvi|ndwi|ndmi|false[- ]?color|swir|agriculture|raster function|band index)\b/i.test(t);
  const mentionsSceneRef = /\b(selected|this|that|result|scene|item|the one)\b/i.test(t);
  const mentionsStats =
    /\b(stat|statistic|statistics|mean|average|avg|median|min(?:imum)?|max(?:imum)?|std|stddev|histogram|value|values|how (?:much|high|low))\b/i.test(t);
  if (mentionsFunction && mentionsStats && mentionsSceneRef) return "function_statistics";

  const mentionsApplyVerb = /\b(apply|compute|run|calculate|render|generate|composite)\b/i.test(t);
  if (mentionsFunction && (mentionsApplyVerb || mentionsSceneRef)) return "apply_function";

  const mentionsCollection =
    /\b(sentinel|landsat|naip|modis|aster|copernicus|s1|s2|l8|l9|imagery|satellite|aerial)\b/i.test(t);
  const mentionsLoadVerb = /\b(load|display|show|add|render|put)\b/i.test(t);
  const hasExplicitId = /\b[A-Z0-9]{3,}(?:_[A-Z0-9]+){2,}\b/.test(t);
  const hasResultRef =
    /\b(result|scene|item|#)\s*#?\s*\d{1,2}\b/i.test(t) ||
    /\b\d{1,2}(st|nd|rd|th)\b/i.test(t) ||
    /\b(selected|clicked)\b/i.test(t);
  if (mentionsLoadVerb && (hasExplicitId || hasResultRef) && !mentionsCollection) return "load_scene";

  return "search";
}

/** Classify intent via the LLM, falling back to regex on any failure. */
async function classifyStacIntent(text: string): Promise<StacAction> {
  try {
    const response = await invokeToolPrompt({
      promptText:
        "Classify the user's imagery request into one action by calling classify_stac_intent. " +
        "If the message names a satellite or collection (Sentinel, Landsat, NAIP, …) or asks to " +
        "find imagery, prefer 'search' even if it also says load/show.",
      messages: [new HumanMessage(text || "search imagery")],
      tools: [intentTool],
      temperature: 0,
    });
    const call = (Array.isArray((response as any)?.tool_calls) ? (response as any).tool_calls : [])
      .find((tc: any) => tc?.name === "classify_stac_intent");
    const action = call?.args?.action as StacAction | undefined;
    if (action && STAC_ACTIONS.includes(action)) return action;
  } catch {
    // fall through
  }
  return classifyStacIntentByRegex(text);
}

// ── Provider is always Planetary Computer ─────────────────────────────────────

const PROVIDER: StacProvider = "planetary-computer";

// ── Result summary builder ────────────────────────────────────────────────────

function buildResultSummary(
  items: StacItem[],
  providerLabel: string,
  totalMatched: number | undefined,
  renderResult: { footprintsAdded: number; imageryLayersAdded: number; warnings: string[] },
  params: StacSearchParams,
  dateInfo: { from: string; to: string; defaulted: boolean },
): string {
  // When the user gave no date range, we searched the last 12 months. Say so
  // explicitly — otherwise an empty result reads as "no such imagery exists"
  // rather than "none in the assumed window".
  const defaultRangeNote = dateInfo.defaulted
    ? `No date range was specified, so I searched the last 12 months (${dateInfo.from} → ${dateInfo.to}). `
    : "";

  if (!items.length) {
    return (
      "No imagery items found matching your criteria. " +
      defaultRangeNote +
      "Try " +
      (dateInfo.defaulted ? "specifying or " : "") +
      "expanding the date range, increasing the cloud cover limit, " +
      "zooming out on the map, or using a different collection."
    );
  }

  const lines: string[] = [];

  const collectionNames = (params.collections ?? []).join(", ") || "all collections";
  lines.push(
    `Found **${items.length}** item${items.length !== 1 ? "s" : ""}` +
    (totalMatched != null && totalMatched > items.length
      ? ` (${totalMatched} total matched)`
      : "") +
    ` from **${providerLabel}** — ${collectionNames}` +
    (dateInfo.defaulted ? ` (last 12 months: ${dateInfo.from} → ${dateInfo.to})` : "") +
    `.`,
  );

  // Top items summary
  const topItems = items.slice(0, 5);
  const itemLines = topItems.map((item: any, i: number) => {
    const date = formatItemDate(item);
    const cc = getCloudCover(item);
    const ccStr = cc != null ? ` · ☁ ${cc}%` : "";
    const hasCog = getBestCogAsset(item) != null ? " · COG ✓" : "";
    return `${i + 1}. **${item.collection ?? "item"}** — ${date}${ccStr}${hasCog}  \n   ID: \`${item.id}\``;
  });
  lines.push(...itemLines);
  if (items.length > 5) lines.push(`_…and ${items.length - 5} more._`);

  // Render summary
  if (renderResult.footprintsAdded > 0) {
    lines.push(
      `\n**${renderResult.footprintsAdded}** item footprint${renderResult.footprintsAdded !== 1 ? "s" : ""} added to the map. Click any footprint to see full metadata.`,
    );
    // Surface the follow-up actions now that results exist (these can't be cold-start
    // starter chips since they need results in memory).
    lines.push(
      "**Next, try:**  \n" +
      "· _\"load result 1 on the map\"_ — show a scene's true-color imagery  \n" +
      "· _\"apply NDVI to result 1\"_ — map vegetation (also NDWI, NDMI, false-color, …)  \n" +
      "· _\"what's the mean NDVI of result 1\"_ — band-index statistics  \n" +
      "· _\"build a cloud-free mosaic of this area\"_ — one seamless composite",
    );
  }
  if (renderResult.imageryLayersAdded > 0) {
    lines.push(
      `**${renderResult.imageryLayersAdded}** COG imagery layer${renderResult.imageryLayersAdded !== 1 ? "s" : ""} loaded on the map.`,
    );
  }
  if (renderResult.warnings.length) {
    lines.push(`_Note: ${renderResult.warnings.join(" ")}_ `);
  }

  return lines.join("\n\n");
}

// ── Collection listing helper ─────────────────────────────────────────────────

async function handleCollectionListRequest(provider: StacProvider): Promise<string> {
  const config = STAC_PROVIDERS.find((p) => p.id === provider)!;
  const collections = await listStacCollections(provider);
  if (!collections.length) {
    return `Could not retrieve the collection list from ${config.label}. The service may be temporarily unavailable.`;
  }
  const lines = [
    `Available collections on **${config.label}** (${collections.length} total):`,
    "",
    ...collections
      .slice(0, 30)
      .map((c) => `- **${c.id}**${c.title ? ` — ${c.title}` : ""}`),
  ];
  if (collections.length > 30) lines.push(`_…and ${collections.length - 30} more._`);
  return lines.join("\n");
}

// ── Raster function helpers ────────────────────────────────────────────────────

/**
 * Resolve the (raster function, target scene) pair referenced in the user's message
 * against the last results — shared by the "apply" and "statistics" flows. Returns
 * either the resolved pair, or an `error` string ready to send back to the user.
 */
async function resolveFunctionAndScene(
  text: string,
): Promise<{ fn: RasterFunctionDef; target: StacItem } | { error: string }> {
  if (!sessionStore.lastResults.length) {
    return {
      error:
        "There are no imagery results to work with yet. " +
        "Search for imagery first (e.g. _\"show Sentinel-2 over this area\"_), then try again.",
    };
  }

  let functionKey: string | null = null;
  let resultNumber: number | null = null;
  let itemId: string | null = null;
  let useSelected = false;

  try {
    const response = await invokeToolPrompt({
      promptText:
        "Extract the raster function and target scene from the user's message and call " +
        "extract_raster_function. The user is referring to imagery results already shown.",
      messages: [new HumanMessage(text)],
      tools: [rasterFnTool],
      temperature: 0,
    });
    const call = (Array.isArray((response as any)?.tool_calls)
      ? (response as any).tool_calls
      : []
    ).find((tc: any) => tc?.name === "extract_raster_function");
    if (call?.args) {
      functionKey = call.args.functionKey ?? null;
      resultNumber = call.args.resultNumber ?? null;
      itemId = call.args.itemId ?? null;
      useSelected = call.args.useSelected ?? false;
    }
  } catch {
    // fall through to regex fallback
  }

  // Regex fallback for the function key if the LLM call failed.
  if (!functionKey) {
    const m = text.match(/\b(ndvi|ndwi|ndmi|false[- ]?color|swir|agriculture)\b/i);
    if (m) functionKey = m[1].toLowerCase().replace(/\s/g, "-");
  }

  const fn = functionKey ? getRasterFunction(functionKey) : null;
  if (!fn) {
    return {
      error:
        "I couldn't tell which raster function you want. Available options:\n\n" +
        listRasterFunctions(),
    };
  }

  // Resolve the target scene. If the user explicitly referenced selection, prefer it.
  const target = resolveTargetItem({
    itemId,
    resultNumber: useSelected ? null : resultNumber,
    useSelected,
  });

  if (!target) {
    if (useSelected && !getPopupSelectedItemId()) {
      return { error: "No scene is selected. Click a footprint on the map to open its popup first, then ask again." };
    }
    const explanation = explainUnresolvedScene({ resultNumber, useSelected });
    if (explanation) return { error: explanation };
    return {
      error:
        "I couldn't identify which scene to use. Refer to it by number " +
        "(e.g. _\"apply NDVI to result 2\"_), paste its item ID, or click a footprint and say " +
        "_\"apply NDVI to the selected scene\"_.",
    };
  }

  return { fn, target };
}

async function handleRasterFunctionRequest(text: string): Promise<string> {
  const resolved = await resolveFunctionAndScene(text);
  if ("error" in resolved) return resolved.error;
  const result = await renderStacItemWithFunction(resolved.target, resolved.fn);
  return result.message;
}

/** Format a number compactly for stats display. */
function fmtStat(n: number | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.001 || abs >= 100000)) return n.toExponential(2);
  return (Math.round(n * 1000) / 1000).toString();
}

async function handleRasterStatisticsRequest(text: string): Promise<string> {
  const resolved = await resolveFunctionAndScene(text);
  if ("error" in resolved) return resolved.error;
  const { fn, target } = resolved;

  const stats = await computeRasterFunctionStatistics(target, fn);
  if (!stats.success || !stats.bands) {
    return stats.message ?? `Could not compute **${fn.label}** statistics for this scene.`;
  }

  const lines: string[] = [
    `**${fn.label}** statistics for scene \`${target.id}\`` +
    `${target.collection ? ` (${target.collection})` : ""}, over its full footprint:`,
    "",
  ];
  for (const [band, s] of Object.entries(stats.bands)) {
    const bandLabel = Object.keys(stats.bands).length > 1 ? `**${band}** — ` : "";
    lines.push(
      `${bandLabel}mean **${fmtStat(s.mean)}**, ` +
      `min ${fmtStat(s.min)}, max ${fmtStat(s.max)}` +
      (s.median != null ? `, median ${fmtStat(s.median)}` : "") +
      (s.std != null ? `, σ ${fmtStat(s.std)}` : "") +
      (s.valid_percent != null ? ` · ${fmtStat(s.valid_percent)}% valid pixels` : ""),
    );
  }
  return lines.join("\n");
}

// ── Load-specific-scene helper ─────────────────────────────────────────────────

/**
 * Handle "load <scene> on the map" for a scene already present in the last
 * results — by pasted item ID, 1-based result number, or current selection.
 * Renders just that item's true-color imagery; does NOT run a new search.
 * Returns null if no existing scene could be resolved (caller falls back to search).
 */
async function handleLoadSceneRequest(text: string): Promise<string | null> {
  if (!sessionStore.lastResults.length) return null;

  // 1. Explicit item ID anywhere in the text (matches the IDs we display, e.g.
  //    S2B_MSIL2A_20260527T073609_R092_T38RLQ_20260527T095450 or Landsat IDs).
  const idMatch = text.match(/\b([A-Z0-9]{3,}(?:_[A-Z0-9]+){2,})\b/);
  let target = idMatch ? resolveTargetItem({ itemId: idMatch[1] }) : null;

  // 2. Result number ("result 3", "the 2nd one", "#4").
  if (!target) {
    const numMatch = text.match(/\b(?:result|item|scene|#)\s*#?\s*(\d{1,2})\b/i)
      ?? text.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/i);
    const n = numMatch ? parseInt(numMatch[1], 10) : NaN;
    if (!isNaN(n)) target = resolveTargetItem({ resultNumber: n });
  }

  // 3. Current popup selection — only on an explicit selection word, and only if a
  //    footprint popup is actually open. Vague "this/that" is excluded here because
  //    it usually refers to the map area ("this extent"), not a scene.
  if (!target && /\b(selected|clicked)\b/i.test(text)) {
    target = resolveTargetItem({ useSelected: true });
  }

  if (!target) return null;
  const result = await loadStacItemImagery(target, "Microsoft Planetary Computer");
  return result.message;
}

// ── Shared search-parameter extraction ─────────────────────────────────────────

interface QueryIntent {
  collections: string[];
  cloudCoverMax: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
  loadImagery: boolean;
  useMapExtent: boolean;
  clearPrevious: boolean;
}

interface ExtractedSearch {
  intent: QueryIntent;
  searchParams: StacSearchParams;
  resolvedCollections: string[];
  unresolvedCollections: string[];
  mapExtentMissing: boolean;
}

/**
 * Extract STAC search parameters from the user's message via the LLM tool, resolve
 * collection aliases, and apply the current map extent. Shared by the search and
 * mosaic flows so both interpret the request identically.
 */
async function extractSearchIntent(text: string): Promise<ExtractedSearch> {
  let intent: QueryIntent = {
    collections: [],
    cloudCoverMax: null,
    dateFrom: null,
    dateTo: null,
    limit: 8,
    loadImagery: false,
    useMapExtent: true,
    clearPrevious: true,
  };

  try {
    const response = await invokeToolPrompt({
      promptText:
        "You are a satellite imagery search assistant. " +
        "Extract all search parameters from the user's message and call extract_stac_query. " +
        "Today's date is " + new Date().toISOString().slice(0, 10) + ". " +
        "If the user mentions 'last month', 'this year', 'recent', etc., resolve to absolute dates. " +
        "Set cloudCoverMax to about 20 whenever the user asks for low-cloud / clear imagery in ANY phrasing — " +
        "e.g. 'clear', 'low cloud', 'cloud-free', 'mostly cloud-free', 'hardly any clouds', 'few clouds', 'minimal cloud', 'no clouds'. " +
        "If they give an explicit percentage, use that instead. " +
        "Default limit to 8 unless specified. " +
        "Default useMapExtent to true. Default loadImagery to false unless user says 'load', 'display', 'show on map', 'render'.",
      messages: [new HumanMessage(text || "search stac imagery")],
      tools: [stacQueryTool],
      temperature: 0,
    });

    const call = (Array.isArray((response as any)?.tool_calls)
      ? (response as any).tool_calls
      : []
    ).find((tc: any) => tc?.name === "extract_stac_query");

    if (call?.args) {
      intent = { ...intent, ...call.args };
    }
  } catch {
    // continue with defaults
  }

  const resolvedCollections: string[] = [];
  const unresolvedCollections: string[] = [];
  for (const col of intent.collections) {
    const resolved = resolveCollectionId(col, PROVIDER);
    if (resolved) resolvedCollections.push(resolved);
    else unresolvedCollections.push(col);
  }

  const mapExtent = intent.useMapExtent ? getMapExtentViaWebMercatorUtils() : null;

  const searchParams: StacSearchParams = {
    provider: PROVIDER,
    collections: resolvedCollections.length ? resolvedCollections : undefined,
    bbox: mapExtent ?? undefined,
    dateRange:
      intent.dateFrom || intent.dateTo
        ? { from: intent.dateFrom ?? undefined, to: intent.dateTo ?? undefined }
        : undefined,
    cloudCoverMax: intent.cloudCoverMax ?? undefined,
    limit: intent.limit,
  };

  return {
    intent,
    searchParams,
    resolvedCollections,
    unresolvedCollections,
    mapExtentMissing: intent.useMapExtent && !mapExtent,
  };
}

/** Handle a mosaic request: register the search as a PC mosaic and render it seamlessly. */
async function handleMosaicRequest(text: string): Promise<string> {
  const { searchParams, resolvedCollections, unresolvedCollections, mapExtentMissing } =
    await extractSearchIntent(text);

  if (!resolvedCollections.length) {
    return (
      "To build a mosaic I need to know which collection to use. " +
      "Try e.g. _\"build a cloud-free Sentinel-2 mosaic of this area\"_." +
      (unresolvedCollections.length
        ? ` (Couldn't resolve: ${unresolvedCollections.join(", ")}.)`
        : "")
    );
  }

  let registration;
  try {
    registration = await registerStacMosaic(searchParams);
  } catch (err: any) {
    return `Mosaic registration failed: ${err?.message ?? String(err)}`;
  }

  const result = await renderStacMosaic(registration, resolvedCollections, searchParams.bbox);
  let message = result.message;
  if (mapExtentMissing) {
    message += "\n\n_Note: map extent wasn't available, so the mosaic covers the collection's default area._";
  }
  return message;
}

/**
 * Handle a clear/remove request. If the user names a specific layer type (mosaic,
 * raster function/NDVI), remove just that; otherwise clear all STAC imagery.
 */
function handleClearRequest(text: string): string {
  const t = text.toLowerCase();
  const wantsMosaic = /\b(mosaic|composite|seamless)\b/.test(t);
  const wantsRasterFn = /\b(ndvi|ndwi|ndmi|raster function|band index|false[- ]?color|swir|agriculture)\b/.test(t);
  // "all", "everything", "the map", "results", or no specific target → clear everything.
  const wantsAll = /\b(all|everything|the map|results?|imagery|satellite|stac)\b/.test(t);

  // Targeted removals only when a specific layer is named AND the user didn't say "all".
  if (!wantsAll && (wantsMosaic || wantsRasterFn)) {
    const cleared: string[] = [];
    if (wantsMosaic) { clearStacMosaic(); cleared.push("mosaic"); }
    if (wantsRasterFn) { clearStacRasterFunctions(); cleared.push("raster-function layer(s)"); }
    return `Removed the ${cleared.join(" and ")} from the map.`;
  }

  clearStacLayers();
  clearStacRasterFunctions();
  return "Cleared the satellite imagery layers (footprints, scenes, mosaic, and raster functions) from the map.";
}

// ── Agent registration ────────────────────────────────────────────────────────

export function registerStacSearchAgent(assistant: HTMLElement) {
  const agentId = "stac-imagery-agent";

  const createGraph = () => {
    const state = ANNOTATION.Root({
      messages: ANNOTATION({
        reducer: (cur: any[] = [], update: any) => [...cur, update],
        default: () => [],
      }),
      outputMessage: ANNOTATION({
        reducer: (_: string = "", update: any) =>
          typeof update === "string" && update.trim() ? update : _,
        default: () => "",
      }),
    });

    async function stacSearchNode(s: any) {
      try {
      const text = extractLastUserText(s);

      // ── Classify intent (LLM, regex fallback) and dispatch ──────────────
      const action = await classifyStacIntent(text);

      if (action === "list_collections") {
        return { outputMessage: await handleCollectionListRequest(PROVIDER) };
      }

      if (action === "clear") {
        return { outputMessage: handleClearRequest(text) };
      }

      if (action === "list_functions") {
        return {
          outputMessage:
            "Available raster functions you can apply to a scene from your results:\n\n" +
            listRasterFunctions() +
            "\n\nApply one by saying e.g. _\"apply NDVI to result 2\"_ or clicking a footprint then _\"apply NDVI to the selected scene\"_.",
        };
      }

      if (action === "function_statistics") {
        return { outputMessage: await handleRasterStatisticsRequest(text) };
      }

      if (action === "apply_function") {
        return { outputMessage: await handleRasterFunctionRequest(text) };
      }

      if (action === "load_scene") {
        // handleLoadSceneRequest returns null if no concrete scene resolves —
        // in that case we fall through to a normal search rather than erroring.
        const loadResult = await handleLoadSceneRequest(text);
        if (loadResult) return { outputMessage: loadResult };
      }

      if (action === "mosaic") {
        return { outputMessage: await handleMosaicRequest(text) };
      }

      // ── Default action: search. Extract params (shared with mosaic path) ──
      const {
        intent,
        searchParams,
        resolvedCollections,
        unresolvedCollections,
        mapExtentMissing,
      } = await extractSearchIntent(text);

      // ── Execute search ──────────────────────────────────────────────────
      let searchResult: Awaited<ReturnType<typeof searchStac>>;
      try {
        searchResult = await searchStac(searchParams);
      } catch (err: any) {
        return {
          outputMessage:
            `STAC search failed: ${err?.message ?? String(err)}\n\n` +
            "Try a different collection name or expand your map view.",
        };
      }

      const { items, totalMatched, providerLabel, effectiveDateRange, dateRangeDefaulted } = searchResult;

      // Remember results for later raster-function / selection requests.
      sessionStore.lastResults = items;

      // ── Render on map ───────────────────────────────────────────────────
      // Clicking a footprint opens the view's built-in popup; "the selected scene"
      // is read from view.popup.selectedFeature — no custom click handler needed.
      const renderResult = await renderStacItems(items, {
        loadImagery: intent.loadImagery,
        maxImageryLayers: 3,
        providerLabel,
        clearPrevious: intent.clearPrevious,
      });

      // ── Build response text ─────────────────────────────────────────────
      const warnings: string[] = [...renderResult.warnings];
      if (unresolvedCollections.length) {
        warnings.push(
          `Could not resolve collection(s): ${unresolvedCollections.join(", ")}. ` +
          `Ask me to "list available collections" to see what's available on ${providerLabel}.`,
        );
      }
      if (mapExtentMissing) {
        warnings.push("Map extent not available — search was performed without a spatial filter.");
      }

      const outputMessage = buildResultSummary(
        items as any,
        providerLabel,
        totalMatched,
        { ...renderResult, warnings },
        searchParams,
        { from: effectiveDateRange.from, to: effectiveDateRange.to, defaulted: dateRangeDefaulted },
      );

      return { outputMessage };
      } catch (err: any) {
        return {
          outputMessage:
            `Sorry, something went wrong: ${err?.message ?? String(err)}\n\n` +
            "Please try again or rephrase your request.",
        };
      }
    }

    return new StateGraph(state)
      .addNode("stacSearchNode", stacSearchNode)
      .addEdge(START, "stacSearchNode")
      .addEdge("stacSearchNode", END);
  };

  const agent = {
    id: agentId,
    name: "STAC-Imagery",
    description:
      "Search and load satellite or aerial imagery from Microsoft Planetary Computer STAC catalog. " +
      "Use for: finding Sentinel-2, Landsat, NAIP, Sentinel-1, or other satellite imagery items; filtering by cloud cover, date range, or map extent; " +
      "displaying imagery footprints on the map; loading COG imagery layers; loading a specific found scene by result number, item ID, or selection; listing available collections; " +
      "applying raster functions / band indices (NDVI, NDWI, NDMI, false-color, SWIR, agriculture composites) to a found scene; " +
      "computing summary statistics (mean/min/max/median) of a band index over a found scene; " +
      "building a seamless cloud-free mosaic / composite across the whole search area (Sentinel-2 or Landsat); " +
      "removing / clearing imagery this agent added to the map — footprints, COG scenes, raster-function layers, or the mosaic (by name or all at once). " +
      "Triggers on: 'find imagery', 'show satellite data', 'sentinel-2', 'landsat', 'NAIP', 'low cloud cover imagery', 'stac search', 'load COG', 'planetary computer', " +
      "'apply NDVI', 'compute NDWI', 'false-color composite', 'raster function', 'band index', 'mean NDVI', 'average NDVI', 'NDVI statistics', 'NDWI value', " +
      "'remove the mosaic', 'clear the imagery', 'remove sentinel-2 layer', 'hide the satellite layers', 'clear stac results', 'remove the NDVI layer'. " +
      "Use this for removing satellite/STAC imagery layers it created — NOT the built-in help agent. " +
      "Do NOT use for: adding ArcGIS Online feature layers, web maps, or non-imagery data.",
    createGraph,
    workspace: {},
  } as any;

  const existing = assistant.querySelector(`[data-agent-id="${agentId}"]`);
  if (existing) existing.remove();

  const agentEl = document.createElement("arcgis-assistant-agent") as any;
  agentEl.setAttribute("data-agent-id", agentId);
  agentEl.agent = agent;
  assistant.appendChild(agentEl);
}
