import React from "react";

interface Props {
  authError: string | null;
  isSigningIn: boolean;
  oauthClientId: string | undefined;
  onSignIn: () => void;
}

export function SignInScreen({ authError, isSigningIn, oauthClientId, onSignIn }: Props) {
  const missingClientId = !oauthClientId;

  const handleClick = () => {
    if (missingClientId) return;
    onSignIn();
  };

  return (
    <div className="centered-screen">
      <calcite-panel heading="Sign in to ArcGIS" class="sign-in-panel">
        <div className="sign-in-body">
          <p className="sign-in-text">
            Sign in first, then you can provide the WebMap item ID.
          </p>
          <p className="sign-in-subtext">
            You will be redirected to the official ArcGIS sign-in page.
          </p>
          {missingClientId && (
            <calcite-notice open kind="danger" style={{ marginBottom: "0.5rem" }}>
              <div slot="message">
                Missing <code>VITE_ARCGIS_OAUTH_APP_ID</code>. Add it to <code>.env.local</code> and restart.
              </div>
            </calcite-notice>
          )}
          {authError && (
            <calcite-notice open kind="danger" style={{ marginBottom: "0.5rem" }}>
              <div slot="message">{authError}</div>
            </calcite-notice>
          )}
          <div className="sign-in-button-row">
            <calcite-button
              appearance="solid"
              kind="brand"
              disabled={missingClientId || isSigningIn ? true : undefined}
              onClick={handleClick}
              style={{ minWidth: "180px" }}
            >
              {isSigningIn ? "Signing in..." : "Sign in"}
            </calcite-button>
          </div>
        </div>
      </calcite-panel>
    </div>
  );
}
