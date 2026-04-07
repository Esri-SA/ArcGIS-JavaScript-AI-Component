import React, { useRef } from "react";

interface Props {
  inputWebMapId: string;
  onLoadMap: (id: string) => void;
  onNewMap: () => void;
}

export function MapPickerScreen({ inputWebMapId, onLoadMap, onNewMap }: Props) {
  const inputRef = useRef<HTMLElement & { value?: string }>(null);

  const handleLoad = () => {
    const id = (inputRef.current?.value ?? inputWebMapId).trim();
    if (id) onLoadMap(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLoad();
  };

  return (
    <div className="centered-screen">
      <calcite-panel heading="Load Web Map" class="map-picker-panel">
        <div className="panel-body">
          <div className="map-picker-stack">
            <calcite-label>
              Web Map ID
              <calcite-input
                ref={inputRef}
                placeholder="Enter web map item ID"
                clearable
                onKeyDown={handleKeyDown}
              />
            </calcite-label>
            <calcite-button appearance="solid" kind="brand" width="full" onClick={handleLoad}>
              Load map
            </calcite-button>
            <calcite-button appearance="outline" width="full" onClick={onNewMap}>
              New map
            </calcite-button>
            <p className="map-picker-hint">
              New Map creates a fresh Web Map item in ArcGIS Online immediately, then opens it here
              for editing.
            </p>
          </div>
        </div>
      </calcite-panel>
    </div>
  );
}
