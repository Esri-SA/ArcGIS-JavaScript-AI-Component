// Starter-prompt suggestions surfaced just above the assistant composer input,
// injected into the assistant shadow DOM (the composer is not reachable from
// regular React JSX).
//
// Clicking a chip fills the composer textarea and focuses it — it does NOT
// auto-submit, so the user can tweak the collection/date/area before sending.

export interface AssistantSuggestion {
  /** Short label shown on the chip. */
  label: string;
  /** Full prompt text inserted into the composer. */
  prompt: string;
}

/**
 * Curated starter prompts, grouped by custom-agent capability.
 *
 * Guidelines for these chips:
 *  - Each prompt must work from a COLD start (no prior search/results in memory).
 *    Chips that depend on earlier results (e.g. "apply NDVI to result 1") are
 *    omitted — they only make sense after a search and would error if clicked first.
 *  - Phrasing is kept aligned with each agent's description/trigger keywords so the
 *    orchestrator routes the chip to the intended agent.
 *  - Labels are action-first and specific; prompts are full, self-contained sentences.
 */
export const ASSISTANT_SUGGESTIONS: AssistantSuggestion[] = [
  // ── STAC-Imagery ──
  {
    label: "Find Sentinel-2 imagery",
    prompt: "Find recent Sentinel-2 imagery with low cloud cover over this area",
  },
  {
    label: "Build a cloud-free mosaic",
    prompt: "Build a cloud-free Sentinel-2 mosaic of this area",
  },
  {
    label: "List imagery collections",
    prompt: "List the available imagery collections",
  },
  // ── Feature layers (Add / Create / Manage) ──
  {
    label: "Add a layer to the map",
    prompt: "Add a feature layer to the map named ",
  },
  {
    label: "Create a new layer",
    prompt: "Create a new point feature layer named Locations",
  },
  // ── Capabilities overview ──
  {
    label: "What can you do?",
    prompt: "What can you help me do with this map?",
  },
];

const SUGGESTIONS_BAR_ID = "assistant-suggestions-bar";
const SUGGESTIONS_STYLE_ID = "assistant-suggestions-style";

const SUGGESTIONS_CSS = `
#${SUGGESTIONS_BAR_ID} {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
  padding: 0.3rem 0.5rem 0.15rem;
  box-sizing: border-box;
}
#${SUGGESTIONS_BAR_ID} .assistant-suggestions__label {
  flex-basis: 100%;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0.7;
  color: var(--app-chat-chrome-text, #395164);
}
#${SUGGESTIONS_BAR_ID} button {
  appearance: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  line-height: 1.2;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--app-chat-panel-border, #d8e4ee);
  background: transparent;
  color: var(--app-chat-chrome-text, #395164);
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
#${SUGGESTIONS_BAR_ID} button:hover {
  background: color-mix(in srgb, var(--app-chat-chrome-text, #395164) 10%, transparent);
  border-color: var(--app-chat-chrome-text, #395164);
}
#${SUGGESTIONS_BAR_ID} button:focus-visible {
  outline: 2px solid var(--app-chat-chrome-text, #395164);
  outline-offset: 1px;
}
`;

/** Find the assistant's composer textarea, searching nested shadow roots. */
function findComposerTextarea(assistant: HTMLElement): HTMLTextAreaElement | null {
  const seen = new Set<Node>();

  function search(root: Element | ShadowRoot): HTMLTextAreaElement | null {
    if (seen.has(root)) return null;
    seen.add(root);

    const direct = root.querySelector("textarea");
    if (direct) return direct as HTMLTextAreaElement;

    for (const node of Array.from(root.querySelectorAll("*"))) {
      const sr = (node as HTMLElement).shadowRoot;
      if (sr) {
        const found = search(sr);
        if (found) return found;
      }
    }
    return null;
  }

  if (assistant.shadowRoot) {
    const found = search(assistant.shadowRoot);
    if (found) return found;
  }
  return search(assistant);
}

/**
 * Insert prompt text into the assistant composer and focus it (no submit).
 * Dispatches a native input event so the web component's internal state and
 * send button enable correctly.
 *
 * Returns true if a composer was found and populated.
 */
export function fillAssistantComposer(assistant: HTMLElement, prompt: string): boolean {
  const textarea = findComposerTextarea(assistant);
  if (!textarea) return false;

  // Use the native value setter so React/web-component bindings observe the change.
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(textarea, prompt);
  else textarea.value = prompt;

  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  textarea.focus();
  // Place caret at end so the user can keep typing (e.g. a layer name).
  const end = textarea.value.length;
  try {
    textarea.setSelectionRange(end, end);
  } catch {
    // ignore — some browsers disallow on non-rendered textareas
  }
  return true;
}

/**
 * Resolve where to insert the chip bar so it lands just above the prompt input.
 *
 * Climbs from the textarea up across shadow-root boundaries to the assistant's
 * input container (`assistant-chat-entry__input-container`, inside the
 * `arcgis-assistant-chat-entry` shadow root) and inserts the bar before it —
 * placing the chips directly above the composer textarea.
 *
 * Falls back to the chat-entry host's parent if the container class changes in a
 * future component version.
 */
function findComposerRegion(textarea: HTMLTextAreaElement): {
  region: Element;
  parent: ParentNode;
} | null {
  let node: Node | null = textarea;
  let chatEntryHost: Element | null = null;

  while (node) {
    if (node instanceof Element) {
      if (node.classList.contains("assistant-chat-entry__input-container")) {
        const parent = node.parentNode;
        if (parent) return { region: node, parent };
      }
      if (node.tagName.toLowerCase() === "arcgis-assistant-chat-entry") {
        chatEntryHost = node;
      }
      node = node.parentElement ?? (node.getRootNode() as ShadowRoot)?.host ?? null;
    } else if (node instanceof ShadowRoot) {
      node = node.host;
    } else {
      break;
    }
  }

  // Fallback: place the bar before the whole chat-entry component.
  if (chatEntryHost?.parentNode) {
    return { region: chatEntryHost, parent: chatEntryHost.parentNode };
  }
  return null;
}

/**
 * Inject (or refresh) the suggestions chip bar directly above the assistant
 * composer input, inside its shadow DOM. Idempotent — safe to call repeatedly
 * (e.g. from a MutationObserver) since it bails if the bar already exists.
 *
 * Returns true if the bar is present after the call.
 */
export function ensureAssistantSuggestionsBar(
  assistant: HTMLElement,
  onPick: (prompt: string) => void,
): boolean {
  const textarea = findComposerTextarea(assistant);
  if (!textarea) return false;

  const target = findComposerRegion(textarea);
  if (!target) return false;

  // The bar lives in the chat-entry shadow root (target.parent), so dedupe and
  // inject styles against THAT root — not the calcite-text-area root.
  const root = target.region.getRootNode() as ShadowRoot | Document;
  if (!("getElementById" in root)) return false;

  // Already injected and still attached → nothing to do.
  const existing = root.getElementById(SUGGESTIONS_BAR_ID);
  if (existing && existing.isConnected) return true;
  existing?.remove();

  // Inject scoped styles into the same root once.
  if (!root.getElementById(SUGGESTIONS_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = SUGGESTIONS_STYLE_ID;
    style.textContent = SUGGESTIONS_CSS;
    (root as ShadowRoot).appendChild(style);
  }

  const bar = document.createElement("div");
  bar.id = SUGGESTIONS_BAR_ID;
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Suggested prompts");

  const label = document.createElement("span");
  label.className = "assistant-suggestions__label";
  label.textContent = "Try asking:";
  bar.appendChild(label);

  for (const s of ASSISTANT_SUGGESTIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = s.label;
    chip.title = s.prompt;
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      onPick(s.prompt);
    });
    bar.appendChild(chip);
  }

  target.parent.insertBefore(bar, target.region);
  return true;
}
