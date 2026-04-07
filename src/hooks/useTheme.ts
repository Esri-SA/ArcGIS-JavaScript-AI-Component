import { useCallback, useState } from "react";

const THEME_STORAGE_KEY = "arcgis-demo-theme";

function loadSavedTheme(): Partial<ThemeSnapshot> {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ThemeSnapshot>) : {};
  } catch {
    return {};
  }
}

export function saveTheme(snapshot: ThemeSnapshot): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage quota or private browsing — ignore
  }
}

export interface ThemeState {
  headerTitle: string;
  headerSubtitle: string;
  headerFontFamily: string;
  headerBackground: string;
  headerBorderColor: string;
  headerTextColor: string;
  headerSubtitleColor: string;
  chatPanelTitle: string;
  chatPanelBackground: string;
  chatChromeColor: string;
  chatMessageColor: string;
  chatPanelBorderColor: string;
  setHeaderTitle: (v: string) => void;
  setHeaderSubtitle: (v: string) => void;
  setHeaderFontFamily: (v: string) => void;
  setHeaderBackground: (v: string) => void;
  setHeaderBorderColor: (v: string) => void;
  setHeaderTextColor: (v: string) => void;
  setHeaderSubtitleColor: (v: string) => void;
  setChatPanelTitle: (v: string) => void;
  setChatPanelBackground: (v: string) => void;
  setChatChromeColor: (v: string) => void;
  setChatMessageColor: (v: string) => void;
  setChatPanelBorderColor: (v: string) => void;
  applySnapshot: (s: ThemeSnapshot) => void;
  snapshot: () => ThemeSnapshot;
  save: () => void;
}

export interface ThemeSnapshot {
  headerTitle: string;
  headerSubtitle: string;
  headerFontFamily: string;
  headerBackground: string;
  headerBorderColor: string;
  headerTextColor: string;
  headerSubtitleColor: string;
  chatPanelTitle: string;
  chatPanelBackground: string;
  chatChromeColor: string;
  chatMessageColor: string;
  chatPanelBorderColor: string;
}

export const HEADER_FONT_OPTIONS = [
  { label: "Aptos", value: '"Aptos", "Segoe UI", sans-serif' },
  { label: "Arial", value: 'Arial, "Helvetica Neue", sans-serif' },
  { label: "Arial Black", value: '"Arial Black", Gadget, sans-serif' },
  { label: "Avenir Next", value: '"Avenir Next", "Segoe UI", sans-serif' },
  { label: "Book Antiqua", value: '"Book Antiqua", Palatino, serif' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "DIN Next", value: '"DIN Next", "Avenir Next", sans-serif' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Arial, sans-serif' },
  { label: "Lucida Console", value: '"Lucida Console", Monaco, monospace' },
  { label: "Noto Sans", value: '"Noto Sans", "Helvetica Neue", sans-serif' },
  { label: "Palatino", value: 'Palatino, "Book Antiqua", serif' },
  { label: "Segoe UI", value: '"Segoe UI", Arial, sans-serif' },
  { label: "Tahoma", value: 'Tahoma, "Segoe UI", sans-serif' },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Trebuchet MS", value: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Monospace", value: '"Menlo", "SFMono-Regular", monospace' },
];

export function useTheme(appName: string): ThemeState {
  const defaultTitle = appName;
  const defaultSubtitle = "Map exploration, MCP-assisted research, and feature editing in one workspace.";
  const defaultBackground = "linear-gradient(90deg, #f6fbff 0%, #fffaf2 100%)";
  const defaultBorder = "#d8e4ee";

  // Load any previously saved theme from localStorage so settings survive refresh.
  const saved = loadSavedTheme();

  const [headerTitle, setHeaderTitle] = useState(saved.headerTitle ?? defaultTitle);
  const [headerSubtitle, setHeaderSubtitle] = useState(saved.headerSubtitle ?? defaultSubtitle);
  const [headerFontFamily, setHeaderFontFamily] = useState(saved.headerFontFamily ?? HEADER_FONT_OPTIONS[0].value);
  const [headerBackground, setHeaderBackground] = useState(saved.headerBackground ?? defaultBackground);
  const [headerBorderColor, setHeaderBorderColor] = useState(saved.headerBorderColor ?? defaultBorder);
  const [headerTextColor, setHeaderTextColor] = useState(saved.headerTextColor ?? "#203040");
  const [headerSubtitleColor, setHeaderSubtitleColor] = useState(saved.headerSubtitleColor ?? "#5a6a79");
  const [chatPanelTitle, setChatPanelTitle] = useState(saved.chatPanelTitle ?? appName);
  const [chatPanelBackground, setChatPanelBackground] = useState(saved.chatPanelBackground ?? "#ffffff");
  const [chatChromeColor, setChatChromeColor] = useState(saved.chatChromeColor ?? "#395164");
  const [chatMessageColor, setChatMessageColor] = useState(saved.chatMessageColor ?? "#203040");
  const [chatPanelBorderColor, setChatPanelBorderColor] = useState(saved.chatPanelBorderColor ?? "#d8e4ee");

  const snapshot = useCallback(
    (): ThemeSnapshot => ({
      headerTitle,
      headerSubtitle,
      headerFontFamily,
      headerBackground,
      headerBorderColor,
      headerTextColor,
      headerSubtitleColor,
      chatPanelTitle,
      chatPanelBackground,
      chatChromeColor,
      chatMessageColor,
      chatPanelBorderColor,
    }),
    [
      headerTitle, headerSubtitle, headerFontFamily, headerBackground,
      headerBorderColor, headerTextColor, headerSubtitleColor,
      chatPanelTitle, chatPanelBackground, chatChromeColor, chatMessageColor, chatPanelBorderColor,
    ],
  );

  const applySnapshot = useCallback((s: ThemeSnapshot) => {
    setHeaderTitle(s.headerTitle);
    setHeaderSubtitle(s.headerSubtitle);
    setHeaderFontFamily(s.headerFontFamily);
    setHeaderBackground(s.headerBackground);
    setHeaderBorderColor(s.headerBorderColor);
    setHeaderTextColor(s.headerTextColor);
    setHeaderSubtitleColor(s.headerSubtitleColor);
    setChatPanelTitle(s.chatPanelTitle);
    setChatPanelBackground(s.chatPanelBackground);
    setChatChromeColor(s.chatChromeColor);
    setChatMessageColor(s.chatMessageColor);
    setChatPanelBorderColor(s.chatPanelBorderColor);
  }, []);

  const save = useCallback(() => saveTheme(snapshot()), [snapshot]);

  return {
    headerTitle, headerSubtitle, headerFontFamily, headerBackground,
    headerBorderColor, headerTextColor, headerSubtitleColor,
    chatPanelTitle, chatPanelBackground, chatChromeColor, chatMessageColor, chatPanelBorderColor,
    setHeaderTitle, setHeaderSubtitle, setHeaderFontFamily, setHeaderBackground,
    setHeaderBorderColor, setHeaderTextColor, setHeaderSubtitleColor,
    setChatPanelTitle, setChatPanelBackground, setChatChromeColor, setChatMessageColor, setChatPanelBorderColor,
    applySnapshot,
    snapshot,
    save,
  };
}
