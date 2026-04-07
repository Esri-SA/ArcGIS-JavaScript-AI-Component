import { useCallback, useEffect, useState } from "react";
import esriConfig from "@arcgis/core/config";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import { getCredential, initializeOAuth } from "../utils/arcgisOnline";

export interface AuthState {
  isSignedIn: boolean;
  currentUser: string | null;
  authError: string | null;
  isSigningIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
}

export function useAuth(oauthClientId: string | undefined, portalUrl: string): AuthState {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    esriConfig.portalUrl = portalUrl;
    initializeOAuth(oauthClientId, portalUrl);
    const sharingUrl = `${portalUrl}/sharing/rest`;
    void IdentityManager.checkSignInStatus(sharingUrl)
      .then((cred) => {
        setIsSignedIn(true);
        setCurrentUser(cred?.userId ?? null);
      })
      .catch(() => {
        setIsSignedIn(false);
        setCurrentUser(null);
      });
  }, [oauthClientId, portalUrl]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const cred = await getCredential(oauthClientId, portalUrl);
      setIsSignedIn(true);
      setCurrentUser(cred.username);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Sign in failed.";
      setAuthError(message);
      setIsSignedIn(false);
      setCurrentUser(null);
    } finally {
      setIsSigningIn(false);
    }
  }, [oauthClientId, portalUrl]);

  const signOut = useCallback(() => {
    IdentityManager.destroyCredentials();
    setIsSignedIn(false);
    setCurrentUser(null);
    setAuthError(null);
  }, []);

  return { isSignedIn, currentUser, authError, isSigningIn, signIn, signOut };
}
