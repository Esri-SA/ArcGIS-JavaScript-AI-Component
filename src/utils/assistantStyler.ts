// CSS injected into shadow roots of arcgis-assistant and its chat cards.

const ASSISTANT_USER_BUBBLE_STYLE_ID = "assistant-user-bubble-wrap-style";
const ASSISTANT_USER_BUBBLE_CSS = `
.assistant-chat-card__prompt-container {
  max-width: min(100%, 34rem) !important;
  width: auto !important;
  box-sizing: border-box;
  align-items: flex-start;
}

.assistant-chat-card__prompt-container > div:first-child {
  min-width: 0;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.45;
}
`;

const ASSISTANT_THEME_STYLE_ID = "assistant-theme-style";
const ASSISTANT_THEME_CSS = `
:host {
  display: block;
  height: 100%;
  min-height: 0;
  --calcite-color-background: var(--app-chat-panel-bg, #ffffff);
  --calcite-color-background-2: var(--app-chat-panel-bg, #ffffff);
  --calcite-color-foreground-1: var(--app-chat-panel-bg, #ffffff);
  --calcite-color-foreground-2: var(--app-chat-panel-bg, #ffffff);
  --calcite-color-text-1: var(--app-chat-message-text, #203040);
  --calcite-color-text-2: var(--app-chat-message-text, #203040);
  --calcite-color-border-1: var(--app-chat-panel-border, #d8e4ee);
  background: var(--app-chat-panel-bg, #ffffff);
  color: var(--app-chat-message-text, #203040);
}

[class*="container"],
[class*="panel"],
[class*="content"],
[class*="shell"],
[class*="messages"],
[class*="body"] {
  min-height: 0 !important;
  background: var(--app-chat-panel-bg, #ffffff) !important;
  color: var(--app-chat-message-text, #203040) !important;
  border-color: var(--app-chat-panel-border, #d8e4ee) !important;
}

[class*="header"],
[class*="footer"],
[class*="composer"],
[class*="prompt"] {
  position: relative;
  z-index: 1;
  background: var(--app-chat-panel-bg, #ffffff) !important;
  color: var(--app-chat-chrome-text, #395164) !important;
  border-color: var(--app-chat-panel-border, #d8e4ee) !important;
}

[class*="header"] *,
[class*="footer"] *,
[class*="composer"] *,
[class*="prompt"] *,
textarea,
input::placeholder {
  color: var(--app-chat-chrome-text, #395164) !important;
}

arcgis-assistant-chat-card,
[class*="message"],
[class*="response"],
[class*="body"] {
  color: var(--app-chat-message-text, #203040) !important;
}

button,
calcite-button {
  color: inherit;
}
`;

// ── Shadow DOM helpers ────────────────────────────────────────────────────────

function ensureAssistantUserBubbleStyle(cardElement: Element): void {
  const sr = (cardElement as HTMLElement).shadowRoot;
  if (!sr || sr.getElementById(ASSISTANT_USER_BUBBLE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ASSISTANT_USER_BUBBLE_STYLE_ID;
  style.textContent = ASSISTANT_USER_BUBBLE_CSS;
  sr.appendChild(style);
}

function ensureAssistantThemeStyle(element: Element): void {
  const sr = (element as HTMLElement).shadowRoot;
  if (!sr || sr.getElementById(ASSISTANT_THEME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ASSISTANT_THEME_STYLE_ID;
  style.textContent = ASSISTANT_THEME_CSS;
  sr.appendChild(style);
}

function ensureLinksOpenInNewTab(root: Element | ShadowRoot): void {
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const href = link.getAttribute("href")?.trim() ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
}

/**
 * Installs a MutationObserver on the arcgis-assistant element that:
 * - Injects theme CSS into shadow roots
 * - Injects user-bubble layout CSS into chat-card shadow roots
 * - Forces external links to open in a new tab
 * - Intercepts link clicks to use window.open instead of navigation
 *
 * Returns a cleanup function that removes the observer and listener.
 *
 * @param onScan Optional callback invoked after every tree scan (initial and on
 *   each mutation, including inside nested shadow roots). Use it to inject extra
 *   UI — e.g. the suggestions chip bar — once the deep composer DOM has mounted.
 */
export function installAssistantUserBubbleStyler(
  assistant: HTMLElement,
  onScan?: (assistant: HTMLElement) => void,
): () => void {
  const handleClick = (event: Event) => {
    const path =
      typeof (event as any).composedPath === "function"
        ? (event as any).composedPath()
        : [];
    const anchor = path.find(
      (node: unknown) => node instanceof HTMLAnchorElement,
    ) as HTMLAnchorElement | undefined;
    const href = anchor?.href?.trim() ?? "";
    if (!anchor || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  };

  assistant.addEventListener("click", handleClick, true);

  const observer = new MutationObserver(() => {
    scanTree(assistant);
    if (assistant.shadowRoot) scanTree(assistant.shadowRoot);
    onScan?.(assistant);
  });

  const observedRoots = new WeakSet<Node>();

  function observeRoot(root: Element | ShadowRoot): void {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
    root.querySelectorAll("*").forEach((node) => {
      const sr = (node as HTMLElement).shadowRoot;
      if (sr) observeRoot(sr);
    });
  }

  function scanTree(root: Element | ShadowRoot): void {
    ensureLinksOpenInNewTab(root);

    if (root instanceof Element && root.matches("arcgis-assistant")) {
      ensureAssistantThemeStyle(root);
    }

    root.querySelectorAll("arcgis-assistant-chat-card").forEach((card) => {
      ensureAssistantThemeStyle(card);
      ensureAssistantUserBubbleStyle(card);
    });

    root.querySelectorAll("*").forEach((node) => {
      const sr = (node as HTMLElement).shadowRoot;
      if (sr) {
        observeRoot(sr);
        scanTree(sr);
      }
    });
  }

  observeRoot(assistant);
  scanTree(assistant);
  if (assistant.shadowRoot) {
    observeRoot(assistant.shadowRoot);
    scanTree(assistant.shadowRoot);
  }
  onScan?.(assistant);

  return () => {
    assistant.removeEventListener("click", handleClick, true);
    observer.disconnect();
  };
}
