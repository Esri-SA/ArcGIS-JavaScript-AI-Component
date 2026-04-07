import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWebMap } from "./hooks/useWebMap";
import { useAssistantSetup } from "./hooks/useAssistantSetup";
import { useTheme, type ThemeSnapshot } from "./hooks/useTheme";
import { SignInScreen } from "./components/SignInScreen";
import { MapPickerScreen } from "./components/MapPickerScreen";
import { MapView } from "./components/MapView";
import { AssistantPanel } from "./components/AssistantPanel";
import { AppHeader } from "./components/AppHeader";
import { AccountMenu } from "./components/AccountMenu";
import { SignOutDialog } from "./components/SignOutDialog";
import { ThemeEditorDialog } from "./components/ThemeEditorDialog";
import { ChangeMapDialog } from "./components/ChangeMapDialog";
import { NewMapDialog } from "./components/NewMapDialog";
import HubServerManager from "./components/HubServerManager";
import { resolveArcgisMcpBaseUrl } from "./utils/arcgisMcp";

// ---------------------------------------------------------------------------
// App-level helpers
// ---------------------------------------------------------------------------

function getClientQueryParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function resolveAppMode(params: URLSearchParams): "default" | "edit" {
  return params.get("mode")?.trim().toLowerCase() === "edit" ? "edit" : "default";
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const clientParams = getClientQueryParams();
  const appMode = resolveAppMode(clientParams);

  const appName =
    (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() ||
    "ArcGIS Agent Components Demo";
  const portalUrl =
    (import.meta.env.VITE_ARCGIS_PORTAL_URL as string | undefined)?.trim() ||
    "https://www.arcgis.com";
  const oauthClientId = (
    import.meta.env.VITE_ARCGIS_OAUTH_APP_ID as string | undefined
  )?.trim();
  const mcpBaseUrl = resolveArcgisMcpBaseUrl();

  // Hooks
  const auth = useAuth(oauthClientId, portalUrl);
  const webMap = useWebMap(auth.isSignedIn, oauthClientId, portalUrl);
  const assistant = useAssistantSetup(
    webMap.webMapId,
    webMap.isMapReady,
    webMap.mapHasOperationalData,
    webMap.mapLoadError,
    auth.isSignedIn,
    oauthClientId,
    portalUrl,
    mcpBaseUrl,
  );
  const theme = useTheme(appName);

  // Transient dialog state
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showHubManager, setShowHubManager] = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [themeEditorKey, setThemeEditorKey] = useState(0);
  const [showChangeMapDialog, setShowChangeMapDialog] = useState(false);
  const [showNewMapDialog, setShowNewMapDialog] = useState(false);
  const [showEmptyMapAssistantNotice, setShowEmptyMapAssistantNotice] = useState(true);

  const themeEditorSnapshotRef = useRef<ThemeSnapshot | null>(null);

  // Reset empty-map notice when map changes
  useEffect(() => {
    setShowEmptyMapAssistantNotice(true);
  }, [webMap.webMapId]);

  // Sync document title
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  // ---------------------------------------------------------------------------
  // Dialog helpers
  // ---------------------------------------------------------------------------

  const closeAllDialogs = useCallback(() => {
    setShowSignOutConfirm(false);
    setShowHubManager(false);
    setShowThemeEditor(false);
    setShowChangeMapDialog(false);
    setShowNewMapDialog(false);
  }, []);

  const handleOpenThemeEditor = useCallback(() => {
    closeAllDialogs();
    themeEditorSnapshotRef.current = theme.snapshot();
    setThemeEditorKey((k) => k + 1);
    setShowThemeEditor(true);
  }, [closeAllDialogs, theme]);

  const handleCloseThemeEditor = useCallback(() => {
    theme.save();
    setShowThemeEditor(false);
    themeEditorSnapshotRef.current = null;
  }, [theme]);

  const handleCancelThemeEditor = useCallback(() => {
    if (themeEditorSnapshotRef.current) {
      theme.applySnapshot(themeEditorSnapshotRef.current);
    }
    setShowThemeEditor(false);
    themeEditorSnapshotRef.current = null;
  }, [theme]);

  const handleChangeWebMapClick = useCallback(() => {
    closeAllDialogs();
    setShowChangeMapDialog(true);
  }, [closeAllDialogs]);

  const handleMcpButtonClick = useCallback(
    (event?: MouseEvent) => {
      // Easter egg: Command+Shift+click (macOS) / Control+Shift+click toggles regenerate button.
      const isMac =
        typeof navigator !== "undefined" &&
        /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");
      const hasUnlockModifiers = Boolean(
        event?.shiftKey && (isMac ? event?.metaKey : event?.ctrlKey),
      );

      if (hasUnlockModifiers) {
        assistant.setShowEmbeddingRegenerateButton((prev) => !prev);
        return;
      }

      closeAllDialogs();
      setShowHubManager(true);
    },
    [closeAllDialogs, assistant],
  );

  const handleSignOut = useCallback(() => {
    auth.signOut();
    webMap.clearMap();
    setShowSignOutConfirm(false);
  }, [auth, webMap]);

  const handleNewMapCreated = useCallback(
    (itemId: string, _title: string) => {
      webMap.loadMap(itemId);
      setShowNewMapDialog(false);
    },
    [webMap],
  );

  // ---------------------------------------------------------------------------
  // Derived flags
  // ---------------------------------------------------------------------------
  const isStartupPage = auth.isSignedIn && !webMap.webMapId;
  const handleHubManagerClose = useCallback(() => setShowHubManager(false), []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <calcite-shell
      style={{ height: "100vh" }}
      className={`app-shell app-shell--${appMode}${isStartupPage ? " app-shell--startup" : ""}`}
    >
      <AppHeader
        headerTitle={theme.headerTitle}
        headerSubtitle={theme.headerSubtitle}
        headerFontFamily={theme.headerFontFamily}
        headerBackground={theme.headerBackground}
        headerBorderColor={theme.headerBorderColor}
        headerTextColor={theme.headerTextColor}
        headerSubtitleColor={theme.headerSubtitleColor}
        isSignedIn={auth.isSignedIn}
        isStartupPage={isStartupPage}
        appMode={appMode}
        webMapId={webMap.webMapId}
        showEmbeddingRegenerateButton={assistant.showEmbeddingRegenerateButton}
        isEmbeddingBusy={assistant.isEmbeddingBusy}
        accountMenuSlot={
          auth.isSignedIn ? (
            <AccountMenu
              username={auth.currentUser}
              onSignOutClick={() => {
                closeAllDialogs();
                setShowSignOutConfirm(true);
              }}
            />
          ) : null
        }
        onOpenThemeEditor={handleOpenThemeEditor}
        onChangeWebMap={handleChangeWebMapClick}
        onRegenerateEmbeddings={() => void assistant.ensureEmbeddings(true)}
        onMcpButtonClick={handleMcpButtonClick}
      />

      {/* ---- Screens ---- */}
      {!auth.isSignedIn ? (
        <SignInScreen
          authError={auth.authError}
          isSigningIn={auth.isSigningIn}
          oauthClientId={oauthClientId}
          onSignIn={() => void auth.signIn()}
        />
      ) : isStartupPage ? (
        <MapPickerScreen
          inputWebMapId={webMap.inputWebMapId}
          onLoadMap={(id) => webMap.loadMap(id)}
          onNewMap={() => setShowNewMapDialog(true)}
        />
      ) : (
        <>
          <MapView
            webMapId={webMap.webMapId}
            mapElementRef={webMap.mapElementRef}
            homeElementRef={webMap.homeElementRef}
          />
          <AssistantPanel
            webMapId={webMap.webMapId}
            mcpHubRefreshToken={assistant.mcpHubRefreshToken}
            isMapReady={webMap.isMapReady}
            mapLoadError={webMap.mapLoadError}
            mapHasOperationalData={webMap.mapHasOperationalData}
            isAssistantPrepared={assistant.isAssistantPrepared}
            embeddingsStatusMessage={assistant.embeddingsStatusMessage}
            embeddingsError={assistant.embeddingsError}
            chatPanelTitle={theme.chatPanelTitle}
            chatPanelBackground={theme.chatPanelBackground}
            chatChromeColor={theme.chatChromeColor}
            chatMessageColor={theme.chatMessageColor}
            chatPanelBorderColor={theme.chatPanelBorderColor}
            showEmptyMapAssistantNotice={showEmptyMapAssistantNotice}
            onDismissEmptyMapNotice={() => setShowEmptyMapAssistantNotice(false)}
          />
        </>
      )}

      {/* ---- Dialogs ---- */}
      <SignOutDialog
        open={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleSignOut}
      />

      <ThemeEditorDialog
        key={themeEditorKey}
        open={showThemeEditor}
        theme={theme}
        snapshotRef={themeEditorSnapshotRef}
        onDone={handleCloseThemeEditor}
        onCancel={handleCancelThemeEditor}
      />

      <ChangeMapDialog
        open={showChangeMapDialog}
        currentWebMapId={webMap.webMapId}
        currentMapTitle={webMap.currentMapTitle}
        onClose={() => setShowChangeMapDialog(false)}
        onLoad={(id) => {
          setShowChangeMapDialog(false);
          webMap.loadMap(id);
        }}
        onNewMap={() => {
          setShowChangeMapDialog(false);
          setShowNewMapDialog(true);
        }}
      />

      <NewMapDialog
        open={showNewMapDialog}
        oauthClientId={oauthClientId}
        portalUrl={portalUrl}
        onClose={() => setShowNewMapDialog(false)}
        onCreated={handleNewMapCreated}
      />

      <HubServerManager
        open={showHubManager}
        onClose={handleHubManagerClose}
        onServersChanged={assistant.refreshMcpHub}
      />
    </calcite-shell>
  );
}
