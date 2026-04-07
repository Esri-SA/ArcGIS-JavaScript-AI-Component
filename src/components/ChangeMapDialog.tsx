import React, { useRef } from "react";

interface Props {
  open: boolean;
  currentWebMapId: string;
  currentMapTitle: string | null;
  onClose: () => void;
  onLoad: (id: string) => void;
  onNewMap: () => void;
}

export function ChangeMapDialog({
  open,
  currentWebMapId,
  currentMapTitle,
  onClose,
  onLoad,
  onNewMap,
}: Props) {
  const inputRef = useRef<HTMLElement & { value?: string }>(null);
  const [value, setValueState] = React.useState("");

  const handleLoad = () => {
    const trimmed = (inputRef.current?.value ?? value).trim();
    if (!trimmed) return;
    onLoad(trimmed);
    setValueState("");
  };

  if (!open) return null;

  return (
    <calcite-dialog
      open
      overlay-positioning="fixed"
      heading="Change Web Map"
      onCalciteDialogClose={onClose}
    >
      <div className="change-map-dialog-body">
        {currentWebMapId && (
          <div className="change-map-current">
            <div className="change-map-current__label">Current map</div>
            {currentMapTitle && (
              <div className="change-map-current__title">{currentMapTitle}</div>
            )}
            <div className="change-map-current__id">{currentWebMapId}</div>
          </div>
        )}
        <calcite-label>
          New Web Map Item ID
          <calcite-input
            ref={inputRef}
            type="text"
            placeholder="Enter web map item ID"
            value={value}
            clearable
            onCalciteInputInput={(e: any) => setValueState(e?.target?.value ?? "")}
            onCalciteInputChange={(e: any) => setValueState(e?.target?.value ?? "")}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter" && value.trim()) handleLoad();
            }}
          />
        </calcite-label>
      </div>
      <calcite-button
        slot="footer-start"
        appearance="outline"
        kind="neutral"
        onClick={() => { onClose(); onNewMap(); }}
      >
        New map
      </calcite-button>
      <calcite-button slot="footer-start" appearance="outline" kind="neutral" onClick={onClose}>
        Cancel
      </calcite-button>
      <calcite-button slot="footer-end" appearance="solid" kind="brand" onClick={handleLoad}>
        Load map
      </calcite-button>
    </calcite-dialog>
  );
}
