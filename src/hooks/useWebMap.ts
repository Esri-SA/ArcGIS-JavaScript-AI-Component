import { useCallback, useEffect, useRef, useState } from "react";
import WebMap from "@arcgis/core/WebMap";
import { fetchPortalItemTitle, getCredential } from "../utils/arcgisOnline";

const LAST_WEBMAP_STORAGE_KEY = "arcgis-assistant:last-webmap";

function getLoadedWebMapItemId(mapElement: HTMLElement & Record<string, unknown>): string {
  return String(
    (mapElement as any)?.map?.portalItem?.id ??
    (mapElement as any)?.view?.map?.portalItem?.id ??
    "",
  ).trim();
}

function cloneTarget(target: unknown): unknown {
  if (!target) return null;
  return typeof (target as any).clone === "function" ? (target as any).clone() : target;
}

function resolveSavedWebMapNavigationTarget(map: unknown): unknown {
  const m = map as any;
  return (
    cloneTarget(m?.initialViewProperties?.viewpoint) ??
    cloneTarget(m?.initialViewProperties?.targetGeometry) ??
    cloneTarget(m?.portalItem?.extent) ??
    cloneTarget(m?.initialExtent) ??
    null
  );
}

export interface WebMapState {
  webMapId: string;
  inputWebMapId: string;
  currentMapTitle: string | null;
  isMapReady: boolean;
  mapHasOperationalData: boolean;
  mapLoadError: string | null;
  mapElementRef: React.RefObject<HTMLElement & Record<string, unknown>>;
  homeElementRef: React.RefObject<HTMLElement & Record<string, unknown>>;
  setInputWebMapId: (value: string) => void;
  loadMap: (id: string) => void;
  clearMap: () => void;
}

export function useWebMap(
  isSignedIn: boolean,
  oauthClientId: string | undefined,
  portalUrl: string,
): WebMapState {
  const [webMapId, setWebMapId] = useState("");
  const [inputWebMapId, setInputWebMapId] = useState("");
  const [currentMapTitle, setCurrentMapTitle] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapHasOperationalData, setMapHasOperationalData] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  const mapElementRef = useRef<HTMLElement & Record<string, unknown>>(null);
  const homeElementRef = useRef<HTMLElement & Record<string, unknown>>(null);
  const autoCheckedMapIdRef = useRef<string | null>(null);

  const loadMap = useCallback((id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setWebMapId(trimmed);
    setInputWebMapId(trimmed);
    setCurrentMapTitle(null);
    autoCheckedMapIdRef.current = null;
  }, []);

  const clearMap = useCallback(() => {
    setWebMapId("");
    setInputWebMapId("");
    setCurrentMapTitle(null);
    setIsMapReady(false);
    setMapHasOperationalData(false);
    setMapLoadError(null);
    autoCheckedMapIdRef.current = null;
  }, []);

  // Restore last map from localStorage on sign-in
  useEffect(() => {
    if (!isSignedIn || webMapId) return;
    const stored = window.localStorage.getItem(LAST_WEBMAP_STORAGE_KEY)?.trim();
    if (stored) loadMap(stored);
  }, [isSignedIn, webMapId, loadMap]);

  // Persist / clear last map in localStorage
  useEffect(() => {
    if (!isSignedIn) return;
    if (webMapId && mapHasOperationalData) {
      window.localStorage.setItem(LAST_WEBMAP_STORAGE_KEY, webMapId);
    } else {
      window.localStorage.removeItem(LAST_WEBMAP_STORAGE_KEY);
    }
  }, [isSignedIn, mapHasOperationalData, webMapId]);

  // Reset map state when webMapId changes
  useEffect(() => {
    if (!webMapId) return;
    setIsMapReady(false);
    setMapHasOperationalData(false);
    setMapLoadError(null);
  }, [webMapId]);

  // Wire up the arcgis-map element once webMapId is set
  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement || !webMapId) return;

    let cancelled = false;

    const requestedMap = new WebMap({ portalItem: { id: webMapId } as any });
    (mapElement as any).map = requestedMap;

    const handleViewReady = () => {
      if (getLoadedWebMapItemId(mapElement) !== webMapId || cancelled) return;
      setIsMapReady(true);
      setMapLoadError(null);
    };

    const handleError = (event: Event) => {
      if (cancelled) return;
      const msg: string =
        (event as CustomEvent)?.detail?.error?.message ??
        (event as CustomEvent)?.detail?.message ??
        "Failed to load the WebMap.";
      setIsMapReady(false);
      setMapLoadError(msg);
    };

    mapElement.addEventListener("arcgisViewReadyChange", handleViewReady);
    mapElement.addEventListener("arcgisViewReadyError", handleError);
    mapElement.addEventListener("arcgisLoadError", handleError);

    // Polling fallback for edge cases where the event already fired
    const poll = async () => {
      for (let i = 0; i < 120 && !cancelled; i++) {
        if (
          getLoadedWebMapItemId(mapElement) === webMapId &&
          ((mapElement as any).ready || (mapElement as any).view)
        ) {
          handleViewReady();
          return;
        }
        await new Promise((r) => window.setTimeout(r, 100));
      }
    };
    void poll();

    return () => {
      cancelled = true;
      mapElement.removeEventListener("arcgisViewReadyChange", handleViewReady);
      mapElement.removeEventListener("arcgisViewReadyError", handleError);
      mapElement.removeEventListener("arcgisLoadError", handleError);
    };
  }, [webMapId]);

  // Track operational data (layers/tables)
  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement || !webMapId || !isMapReady) return;

    const map = (mapElement as any).map ?? (mapElement as any).view?.map;
    const layers = map?.layers;
    const tables = map?.tables;

    const update = () => {
      const layerCount = layers?.length ?? layers?.toArray?.().length ?? 0;
      const tableCount = tables?.length ?? tables?.toArray?.().length ?? 0;
      setMapHasOperationalData(layerCount + tableCount > 0);
    };
    update();

    const lh = layers?.on?.("change", update);
    const th = tables?.on?.("change", update);
    return () => {
      lh?.remove?.();
      th?.remove?.();
    };
  }, [webMapId, isMapReady]);

  // Sync home button viewpoint to the saved map viewpoint
  useEffect(() => {
    const mapElement = mapElementRef.current;
    const homeElement = homeElementRef.current;
    const view = (mapElement as any)?.view;
    if (!mapElement || !homeElement || !webMapId || !isMapReady || !view) return;

    let cancelled = false;

    void (async () => {
      try {
        await view.when();
        const map = view.map;
        if (typeof map?.load === "function") await map.load();
        const target = resolveSavedWebMapNavigationTarget(map);
        if (target) await view.goTo(target, { animate: false });
      } catch {
        // Navigation timing noise — ignore
      }
      if (cancelled) return;
      const vp = view.viewpoint;
      if (vp) (homeElement as any).viewpoint = typeof vp.clone === "function" ? vp.clone() : vp;
    })();

    return () => { cancelled = true; };
  }, [webMapId, isMapReady]);

  // Fetch portal item title whenever webMapId changes
  useEffect(() => {
    if (!webMapId) { setCurrentMapTitle(null); return; }
    let cancelled = false;

    void (async () => {
      try {
        const cred = isSignedIn ? await getCredential(oauthClientId, portalUrl) : null;
        const title = await fetchPortalItemTitle(portalUrl, webMapId, cred?.token);
        if (!cancelled) setCurrentMapTitle(title);
      } catch {
        if (!cancelled) setCurrentMapTitle(null);
      }
    })();

    return () => { cancelled = true; };
  }, [webMapId, isSignedIn, oauthClientId, portalUrl]);

  return {
    webMapId,
    inputWebMapId,
    currentMapTitle,
    isMapReady,
    mapHasOperationalData,
    mapLoadError,
    mapElementRef,
    homeElementRef,
    setInputWebMapId,
    loadMap,
    clearMap,
  };
}
