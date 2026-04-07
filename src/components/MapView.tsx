import React, { useEffect } from "react";

interface MapViewProps {
  webMapId: string;
  mapElementRef: React.RefObject<HTMLElement & Record<string, unknown>>;
  homeElementRef: React.RefObject<HTMLElement & Record<string, unknown>>;
}

/**
 * Renders the arcgis-map element with its default widget slots.
 * Also manages mutual-exclusion between the three expand widgets so that
 * opening one automatically collapses the others.
 */
export function MapView({ webMapId, mapElementRef, homeElementRef }: MapViewProps) {
  const layersExpandRef = React.useRef<HTMLElement & { expanded?: boolean }>(null);
  const basemapExpandRef = React.useRef<HTMLElement & { expanded?: boolean }>(null);
  const legendExpandRef = React.useRef<HTMLElement & { expanded?: boolean }>(null);

  // Collapse sibling expands when one opens
  useEffect(() => {
    const expandEls = [
      layersExpandRef.current,
      basemapExpandRef.current,
      legendExpandRef.current,
    ];
    const cleanups: (() => void)[] = [];

    expandEls.forEach((el, i) => {
      if (!el) return;
      const others = expandEls.filter((_, j) => j !== i);
      const handler = (event: Event) => {
        const e = event as CustomEvent<{ name: string }>;
        if (e.detail?.name === "expanded" && el.expanded) {
          others.forEach((other) => {
            if (other) other.expanded = false;
          });
        }
      };
      el.addEventListener("arcgisPropertyChange", handler);
      cleanups.push(() => el.removeEventListener("arcgisPropertyChange", handler));
    });

    return () => cleanups.forEach((fn) => fn());
  }, [webMapId]);

  return (
    <arcgis-map
      key={webMapId || "empty-webmap"}
      ref={mapElementRef as React.Ref<any>}
      id="main-map"
    >
      <arcgis-zoom slot="top-left" />
      <arcgis-home ref={homeElementRef as React.Ref<any>} slot="top-left" />
      <arcgis-expand
        ref={layersExpandRef as React.Ref<any>}
        slot="top-left"
        expand-icon="layers"
        collapse-icon="x"
      >
        <arcgis-layer-list />
      </arcgis-expand>
      <arcgis-expand
        ref={basemapExpandRef as React.Ref<any>}
        slot="top-left"
        expand-icon="basemap"
        collapse-icon="x"
      >
        <arcgis-basemap-gallery />
      </arcgis-expand>
      <arcgis-expand
        ref={legendExpandRef as React.Ref<any>}
        slot="bottom-left"
        expand-icon="legend"
        collapse-icon="x"
      >
        <arcgis-legend />
      </arcgis-expand>
    </arcgis-map>
  );
}
