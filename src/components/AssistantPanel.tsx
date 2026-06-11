import React, { useEffect } from "react";
import { installAssistantUserBubbleStyler } from "../utils/assistantStyler";
import { ensureAssistantSuggestionsBar, fillAssistantComposer } from "../utils/assistantSuggestions";

// ── Component ─────────────────────────────────────────────────────────────────

export interface AssistantPanelProps {
  webMapId: string;
  mcpHubRefreshToken: number;
  isMapReady: boolean;
  mapLoadError: string | null;
  mapHasOperationalData: boolean;
  isAssistantPrepared: boolean;
  embeddingsStatusMessage: string | null;
  embeddingsError: string | null;
  chatPanelTitle: string;
  chatPanelBackground: string;
  chatChromeColor: string;
  chatMessageColor: string;
  chatPanelBorderColor: string;
  showEmptyMapAssistantNotice: boolean;
  onDismissEmptyMapNotice: () => void;
}

/**
 * The right-side assistant panel: a calcite-shell-panel containing the
 * arcgis-assistant element plus status/error messages and an empty-map notice.
 */
export function AssistantPanel({
  webMapId,
  mcpHubRefreshToken,
  isMapReady,
  mapLoadError,
  mapHasOperationalData,
  isAssistantPrepared,
  embeddingsStatusMessage,
  embeddingsError,
  chatPanelTitle,
  chatPanelBackground,
  chatChromeColor,
  chatMessageColor,
  chatPanelBorderColor,
  showEmptyMapAssistantNotice,
  onDismissEmptyMapNotice,
}: AssistantPanelProps) {
  // Install the bubble-styler / link opener whenever the assistant is rendered,
  // and inject the starter-prompt chip bar just above the composer input.
  useEffect(() => {
    if (!isMapReady || mapLoadError) return;

    const assistant = document.querySelector(
      "arcgis-assistant",
    ) as HTMLElement | null;
    if (!assistant) return;

    const onPick = (prompt: string) => fillAssistantComposer(assistant, prompt);

    // The composer lives inside nested shadow roots that mount asynchronously.
    // The styler already recursively observes those roots, so piggyback on its
    // scan callback to (re)inject the chip bar once the composer DOM exists.
    return installAssistantUserBubbleStyler(assistant, () => {
      ensureAssistantSuggestionsBar(assistant, onPick);
    });
  }, [webMapId, isMapReady, mapLoadError, mcpHubRefreshToken]);

  const shouldRenderAssistant = isMapReady && !mapLoadError;

  return (
    <calcite-shell-panel
      slot="panel-end"
      width="l"
      id="assistant-panel"
      style={{ borderLeft: `1px solid ${chatPanelBorderColor}` }}
    >
      <div
        className="chat-panel-theme"
        style={{
          backgroundColor: chatPanelBackground,
          color: chatMessageColor,
          borderColor: chatPanelBorderColor,
        }}
      >
        {mapLoadError ? (
          <calcite-notice open kind="danger">
            <div slot="title">Map failed to load</div>
            <div slot="message">{mapLoadError}</div>
          </calcite-notice>
        ) : !isMapReady ? (
          <calcite-notice open kind="info">
            <div slot="title">Loading map</div>
            <div slot="message">The assistant will appear after the WebMap view is ready.</div>
          </calcite-notice>
        ) : (
          <>
            {!mapHasOperationalData && showEmptyMapAssistantNotice && (
              <calcite-notice open kind="info" closable onCalciteNoticeClose={onDismissEmptyMapNotice}>
                <div slot="message">
                  This map is empty, so map navigation and data exploration stay disabled until layers or tables are added. MCP and custom assistant workflows are still available.
                </div>
              </calcite-notice>
            )}

            {mapHasOperationalData && !isAssistantPrepared && !embeddingsError && (
              <calcite-notice open kind="info">
                <div slot="title">Preparing map-aware assistant tools</div>
                <div slot="message">
                  {embeddingsStatusMessage || "Map-specific assistant data is still being prepared. MCP and custom assistant workflows remain available."}
                </div>
              </calcite-notice>
            )}

            {shouldRenderAssistant && (
              <arcgis-assistant
                key={`${webMapId || "no-map"}:${mcpHubRefreshToken}`}
                reference-element="#main-map"
                heading={chatPanelTitle}
                class="chat-panel-theme__assistant"
                style={{
                  backgroundColor: chatPanelBackground,
                  color: chatMessageColor,
                  border: "none",
                  borderRadius: "14px",
                  padding: 0,
                  ["--app-chat-panel-bg" as string]: chatPanelBackground,
                  ["--app-chat-chrome-text" as string]: chatChromeColor,
                  ["--app-chat-message-text" as string]: chatMessageColor,
                  ["--app-chat-panel-border" as string]: chatPanelBorderColor,
                } as React.CSSProperties}
              >
                <arcgis-assistant-help-agent></arcgis-assistant-help-agent>
                <arcgis-assistant-navigation-agent></arcgis-assistant-navigation-agent>
                <arcgis-assistant-data-exploration-agent></arcgis-assistant-data-exploration-agent>
                {/* Custom agents are appended programmatically by useAssistantSetup */}
              </arcgis-assistant>
            )}
          </>
        )}

        {embeddingsError && (
          <calcite-notice open kind="danger">
            <div slot="message">{embeddingsError}</div>
          </calcite-notice>
        )}
      </div>
    </calcite-shell-panel>
  );
}
