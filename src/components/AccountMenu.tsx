import React from "react";

export interface AccountMenuProps {
  /** Display name for the signed-in user */
  username: string | null;
  onSignOutClick: () => void;
}

/**
 * A calcite-dropdown showing the current user's name and a sign-out entry.
 */
export function AccountMenu({ username, onSignOutClick }: AccountMenuProps) {
  return (
    <calcite-dropdown placement="bottom-end" type="click" scale="l">
      <calcite-button
        slot="trigger"
        appearance="transparent"
        icon-start="user"
        scale="l"
      >
        {username || "ArcGIS user"}
      </calcite-button>
      <calcite-dropdown-group group-title="Account" selection-mode="none">
        <calcite-dropdown-item
          icon-start="sign-out"
          onClick={onSignOutClick}
        >
          Sign out
        </calcite-dropdown-item>
      </calcite-dropdown-group>
    </calcite-dropdown>
  );
}
