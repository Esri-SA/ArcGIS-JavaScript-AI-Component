import React from "react";

export interface SignOutDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * A simple confirmation dialog for signing out of the app session.
 */
export function SignOutDialog({ open, onClose, onConfirm }: SignOutDialogProps) {
  if (!open) return null;

  return (
    <calcite-dialog
      open
      overlay-positioning="fixed"
      heading="Sign out"
      onCalciteDialogClose={onClose}
    >
      <div style={{ padding: "0.75rem 0" }}>
        Do you want to sign out of this app session?
      </div>
      <calcite-button
        slot="footer-start"
        appearance="outline"
        kind="neutral"
        onClick={onClose}
      >
        Cancel
      </calcite-button>
      <calcite-button
        slot="footer-end"
        appearance="solid"
        kind="danger"
        onClick={onConfirm}
      >
        Sign out
      </calcite-button>
    </calcite-dialog>
  );
}
