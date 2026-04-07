import React from "react";
import mcpServerIcon from "../../mcpicon.png";

const mcpIconStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  display: "block",
  backgroundColor: "#007ac2",
  WebkitMaskImage: `url(${mcpServerIcon})`,
  maskImage: `url(${mcpServerIcon})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

const actionButtonScale = "l" as const;

export interface AppHeaderProps {
  /** Rendered title text */
  headerTitle: string;
  /** Rendered subtitle text. Pass null or empty to hide. */
  headerSubtitle: string;
  /** CSS font-family for title/subtitle */
  headerFontFamily: string;
  /** CSS background (gradient or hex) for the header bar */
  headerBackground: string;
  /** CSS color for the bottom border */
  headerBorderColor: string;
  /** CSS color for the title */
  headerTextColor: string;
  /** CSS color for the subtitle */
  headerSubtitleColor: string;
  /** Whether the session is signed in and the actions should be shown */
  isSignedIn: boolean;
  /** Whether the map picker / startup screen is showing (hides title copy) */
  isStartupPage: boolean;
  /** App mode — "edit" enables the theme-editor button */
  appMode: "default" | "edit";
  /** Currently loaded WebMap item ID (empty string = none) */
  webMapId: string;
  /** Show the hidden "regenerate embeddings" button */
  showEmbeddingRegenerateButton: boolean;
  /** Whether an embedding operation is in flight */
  isEmbeddingBusy: boolean;
  /** Slot for the account dropdown rendered by the parent */
  accountMenuSlot: React.ReactNode;
  onOpenThemeEditor: () => void;
  onChangeWebMap: () => void;
  onRegenerateEmbeddings: () => void;
  /** Click handler for the MCP button; receives the native mouse event */
  onMcpButtonClick: (event: MouseEvent) => void;
}

/**
 * App header bar.  Renders the title/subtitle copy and the right-side action
 * buttons (theme editor, change map, embeddings, MCP, account menu).
 */
export function AppHeader({
  headerTitle,
  headerSubtitle,
  headerFontFamily,
  headerBackground,
  headerBorderColor,
  headerTextColor,
  headerSubtitleColor,
  isSignedIn,
  isStartupPage,
  appMode,
  webMapId,
  showEmbeddingRegenerateButton,
  isEmbeddingBusy,
  accountMenuSlot,
  onOpenThemeEditor,
  onChangeWebMap,
  onRegenerateEmbeddings,
  onMcpButtonClick,
}: AppHeaderProps) {
  const shouldShowActions = isSignedIn;

  return (
    <div
      slot="header"
      className="app-header-bar"
      style={{
        background: headerBackground,
        borderBottomColor: headerBorderColor,
      }}
    >
      {/* Left: title + subtitle */}
      <div className="app-header-main">
        {!isStartupPage && (
          <div className="app-header-copy">
            <div
              className="app-header-title"
              style={{ color: headerTextColor, fontFamily: headerFontFamily }}
            >
              {headerTitle}
            </div>
            {headerSubtitle && (
              <div
                className="app-header-subtitle"
                style={{
                  color: headerSubtitleColor,
                  fontFamily: headerFontFamily,
                }}
              >
                {headerSubtitle}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: action buttons + account menu */}
      <div className="app-header-right">
        {shouldShowActions && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            {!isStartupPage && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                {appMode === "edit" && (
                  <calcite-button
                    appearance="transparent"
                    icon-start="pencil"
                    scale={actionButtonScale}
                    title="Edit theme"
                    aria-label="Edit theme"
                    className="app-header-icon-button"
                    onClick={onOpenThemeEditor}
                  />
                )}

                <calcite-button
                  appearance="transparent"
                  icon-start="map"
                  scale={actionButtonScale}
                  title={webMapId ? "Change WebMap" : "Load WebMap"}
                  aria-label={webMapId ? "Change WebMap" : "Load WebMap"}
                  className="app-header-icon-button"
                  onClick={onChangeWebMap as any}
                />

                {showEmbeddingRegenerateButton && webMapId && (
                  <calcite-button
                    appearance="transparent"
                    icon-start="reset"
                    scale={actionButtonScale}
                    className="app-header-icon-button"
                    title="Refresh assistant data"
                    aria-label="Refresh assistant data"
                    onClick={() => {
                      if (!isEmbeddingBusy) onRegenerateEmbeddings();
                    }}
                  />
                )}

                <calcite-button
                  appearance="transparent"
                  scale={actionButtonScale}
                  title="Manage MCP servers"
                  aria-label="Manage MCP servers"
                  className="app-header-icon-button"
                  onClick={(event: any) =>
                    onMcpButtonClick(event?.nativeEvent ?? event)
                  }
                >
                  <span aria-hidden="true" style={mcpIconStyle} />
                </calcite-button>
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginLeft: "0.25rem",
              }}
            >
              {accountMenuSlot}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
