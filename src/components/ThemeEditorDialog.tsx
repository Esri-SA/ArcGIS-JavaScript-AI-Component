import React from "react";
import type { ThemeState } from "../hooks/useTheme";
import type { ThemeSnapshot } from "../hooks/useTheme";
import { HEADER_FONT_OPTIONS } from "../hooks/useTheme";

interface Props {
  open: boolean;
  theme: ThemeState;
  onDone: () => void;
  onCancel: (snapshot: ThemeSnapshot) => void;
  snapshotRef: React.RefObject<ThemeSnapshot | null>;
}

export function ThemeEditorDialog({ open, theme, onDone, onCancel, snapshotRef }: Props) {
  if (!open) return null;

  const handleCancel = () => {
    if (snapshotRef.current) {
      onCancel(snapshotRef.current);
    } else {
      onDone();
    }
  };

  return (
    <calcite-dialog
      open
      overlay-positioning="fixed"
      heading="Edit theme"
      width="m"
      onCalciteDialogClose={handleCancel}
    >
      <div className="theme-editor-dialog">
        <div className="theme-editor-grid theme-editor-grid--text">
          <label className="theme-editor-field theme-editor-field--wide">
            <span>Title</span>
            <input
              type="text"
              className="theme-editor-text-input"
              value={theme.headerTitle}
              placeholder="Header title"
              onChange={(e) => theme.setHeaderTitle(e.target.value)}
            />
          </label>
          <label className="theme-editor-field theme-editor-field--wide">
            <span>Subtitle</span>
            <input
              type="text"
              className="theme-editor-text-input"
              value={theme.headerSubtitle}
              placeholder="Header subtitle"
              onChange={(e) => theme.setHeaderSubtitle(e.target.value)}
            />
          </label>
          <label className="theme-editor-field theme-editor-field--wide">
            <span>Font</span>
            <select
              className="theme-editor-text-input"
              value={theme.headerFontFamily}
              onChange={(e) => theme.setHeaderFontFamily(e.target.value)}
            >
              {HEADER_FONT_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="theme-editor-section-label">Header</div>
        <div className="theme-editor-grid">
          <label className="theme-editor-color-field">
            <span>Title</span>
            <input type="color" value={theme.headerTextColor} onChange={(e) => theme.setHeaderTextColor(e.target.value)} />
          </label>
          <label className="theme-editor-color-field">
            <span>Subtitle</span>
            <input type="color" value={theme.headerSubtitleColor} onChange={(e) => theme.setHeaderSubtitleColor(e.target.value)} />
          </label>
          <label className="theme-editor-color-field">
            <span>Background</span>
            <input
              type="color"
              value={theme.headerBackground.startsWith("#") ? theme.headerBackground : "#f6fbff"}
              onChange={(e) => theme.setHeaderBackground(e.target.value)}
            />
          </label>
          <label className="theme-editor-color-field">
            <span>Border</span>
            <input type="color" value={theme.headerBorderColor} onChange={(e) => theme.setHeaderBorderColor(e.target.value)} />
          </label>
        </div>

        <div className="theme-editor-section-label">Chat panel</div>
        <div className="theme-editor-grid theme-editor-grid--text">
          <label className="theme-editor-field theme-editor-field--wide">
            <span>Panel title</span>
            <input
              type="text"
              className="theme-editor-text-input"
              value={theme.chatPanelTitle}
              placeholder="Chat panel title"
              onChange={(e) => theme.setChatPanelTitle(e.target.value)}
            />
          </label>
        </div>
        <div className="theme-editor-grid">
          <label className="theme-editor-color-field">
            <span>Background</span>
            <input type="color" value={theme.chatPanelBackground} onChange={(e) => theme.setChatPanelBackground(e.target.value)} />
          </label>
          <label className="theme-editor-color-field">
            <span>Title + input</span>
            <input type="color" value={theme.chatChromeColor} onChange={(e) => theme.setChatChromeColor(e.target.value)} />
          </label>
          <label className="theme-editor-color-field">
            <span>Chat</span>
            <input type="color" value={theme.chatMessageColor} onChange={(e) => theme.setChatMessageColor(e.target.value)} />
          </label>
          <label className="theme-editor-color-field">
            <span>Border</span>
            <input type="color" value={theme.chatPanelBorderColor} onChange={(e) => theme.setChatPanelBorderColor(e.target.value)} />
          </label>
        </div>
      </div>

      <calcite-button slot="footer-start" appearance="outline" kind="neutral" onClick={handleCancel}>
        Cancel
      </calcite-button>
      <calcite-button slot="footer-end" appearance="solid" kind="brand" onClick={onDone}>
        Done
      </calcite-button>
    </calcite-dialog>
  );
}
