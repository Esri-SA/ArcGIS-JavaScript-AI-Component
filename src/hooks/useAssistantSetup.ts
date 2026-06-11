import { useCallback, useEffect, useRef, useState } from "react";
import { getCredential, generateAndSaveWebMapEmbeddings, getWebMapEmbeddingsStatus } from "../utils/arcgisOnline";
import {
  refreshMcpAgentDescription,
  registerMcpPassthroughAgent,
} from "../agents/McpPassthroughAgent";
import { registerCreateFeatureLayerAgent } from "../agents/CreateFeatureLayerAgent";
import { registerManageFeatureLayerAgent } from "../agents/ManageFeatureLayerAgent";
import { registerFeatureLayerCapabilitiesAgent } from "../agents/AllCapabilitiesAgent";
import { registerAddLayerToMapAgent } from "../agents/AddLayerToMapAgent";
import { registerStacSearchAgent } from "../agents/StacSearchAgent";

function toAssistantPreparationErrorMessage(message: string): string {
  if (/eligible layers or fields|generate embeddings|embedding/i.test(message)) {
    return "This map does not yet have supported data for assistant setup.";
  }
  return message.replace(/embeddings?/gi, "assistant data");
}

export interface AssistantSetupState {
  isAssistantPrepared: boolean;
  isEmbeddingBusy: boolean;
  embeddingsStatusMessage: string | null;
  embeddingsError: string | null;
  showEmbeddingRegenerateButton: boolean;
  setShowEmbeddingRegenerateButton: React.Dispatch<React.SetStateAction<boolean>>;
  ensureEmbeddings: (forceRegenerate?: boolean) => Promise<void>;
  mcpHubRefreshToken: number;
  refreshMcpHub: () => void;
}

export function useAssistantSetup(
  webMapId: string,
  isMapReady: boolean,
  mapHasOperationalData: boolean,
  mapLoadError: string | null,
  isSignedIn: boolean,
  oauthClientId: string | undefined,
  portalUrl: string,
  mcpBaseUrl: string,
): AssistantSetupState {
  const [isAssistantPrepared, setIsAssistantPrepared] = useState(false);
  const [isEmbeddingBusy, setIsEmbeddingBusy] = useState(false);
  const [embeddingsStatusMessage, setEmbeddingsStatusMessage] = useState<string | null>(null);
  const [embeddingsError, setEmbeddingsError] = useState<string | null>(null);
  const [showEmbeddingRegenerateButton, setShowEmbeddingRegenerateButton] = useState(false);
  const [mcpHubRefreshToken, setMcpHubRefreshToken] = useState(0);

  const autoCheckedMapIdRef = useRef<string | null>(null);

  const refreshMcpHub = useCallback(() => {
    setMcpHubRefreshToken((v) => v + 1);
  }, []);

  // Reset assistant state when webMapId changes
  useEffect(() => {
    setIsAssistantPrepared(false);
    setEmbeddingsStatusMessage(null);
    setEmbeddingsError(null);
    autoCheckedMapIdRef.current = null;
  }, [webMapId]);

  // Register all custom agents on the assistant element when map is ready
  useEffect(() => {
    if (!webMapId || !isMapReady) return;
    const assistant = document.querySelector("arcgis-assistant") as HTMLElement | null;
    if (!assistant) return;

    registerCreateFeatureLayerAgent(assistant, { oauthClientId, portalUrl, layerName: "Locations" });
    registerManageFeatureLayerAgent(assistant);
    registerAddLayerToMapAgent(assistant);
    registerFeatureLayerCapabilitiesAgent(assistant);
    registerStacSearchAgent(assistant);
    registerMcpPassthroughAgent(assistant, { baseUrl: mcpBaseUrl, serverName: "MCP Hub" });
    void refreshMcpAgentDescription(assistant);
  }, [webMapId, isMapReady, mcpHubRefreshToken, oauthClientId, portalUrl, mcpBaseUrl]);

  const ensureEmbeddings = useCallback(
    async (forceRegenerate = false) => {
      if (!webMapId || !mapHasOperationalData) {
        setIsEmbeddingBusy(false);
        setIsAssistantPrepared(false);
        setEmbeddingsStatusMessage(null);
        setEmbeddingsError(null);
        return;
      }

      setEmbeddingsError(null);
      setIsAssistantPrepared(false);
      setIsEmbeddingBusy(true);

      try {
        const cred = await getCredential(oauthClientId, portalUrl);

        if (!forceRegenerate) {
          setEmbeddingsStatusMessage("Preparing assistant for this map...");
          const status = await getWebMapEmbeddingsStatus(portalUrl, cred.token, webMapId);
          if (status.exists) {
            setIsAssistantPrepared(true);
            setEmbeddingsStatusMessage("Assistant is ready for this map.");
            autoCheckedMapIdRef.current = webMapId;
            return;
          }
        }

        setEmbeddingsStatusMessage(
          forceRegenerate
            ? "Refreshing assistant data for this map..."
            : "Preparing assistant data for this map...",
        );

        const result = await generateAndSaveWebMapEmbeddings({
          portalUrl,
          token: cred.token,
          webMapItemId: webMapId,
          removeExisting: true,
        });

        if (!result.success) throw new Error(result.message || "Failed to generate embeddings.");

        setIsAssistantPrepared(true);
        setEmbeddingsStatusMessage("Assistant is ready for this map.");
        autoCheckedMapIdRef.current = webMapId;
      } catch (error: unknown) {
        setIsAssistantPrepared(false);
        const raw = error instanceof Error ? error.message : "Unable to prepare the assistant for this map.";
        setEmbeddingsError(toAssistantPreparationErrorMessage(raw));
        setEmbeddingsStatusMessage(null);
      } finally {
        setIsEmbeddingBusy(false);
      }
    },
    [webMapId, mapHasOperationalData, oauthClientId, portalUrl],
  );

  // Auto-trigger embedding check when the map is ready with data
  useEffect(() => {
    if (!isSignedIn || !webMapId || !isMapReady || mapLoadError || !mapHasOperationalData) return;
    if (autoCheckedMapIdRef.current === webMapId) return;
    void ensureEmbeddings(false);
  }, [webMapId, ensureEmbeddings, isMapReady, isSignedIn, mapHasOperationalData, mapLoadError]);

  return {
    isAssistantPrepared,
    isEmbeddingBusy,
    embeddingsStatusMessage,
    embeddingsError,
    showEmbeddingRegenerateButton,
    setShowEmbeddingRegenerateButton,
    ensureEmbeddings,
    mcpHubRefreshToken,
    refreshMcpHub,
  };
}
