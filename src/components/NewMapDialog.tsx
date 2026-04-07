import React, { useCallback, useEffect, useState } from "react";
import Portal from "@arcgis/core/portal/Portal";
import PortalFolder from "@arcgis/core/portal/PortalFolder";
import type WebMap from "@arcgis/core/WebMap";
import {
  buildCategoryTree,
  buildNewWebMap,
  createUserFolder,
  getCategoryLeafLabel,
  getCredential,
  listPortalCategoryOptions,
  listUserFolders,
  listUserTags,
  type CategoryTreeNode,
  type PortalCategoryOption,
  type PortalTagInfo,
  type UserFolderInfo,
} from "../utils/arcgisOnline";

const SUMMARY_CHAR_LIMIT = 2048;
const NEW_WEBMAP_TITLE = "New Map";
const NEW_WEBMAP_SNIPPET =
  "Created in ArcGIS Agent Components Demo and saved to ArcGIS Online immediately.";
const ROOT_FOLDER_OPTION = "__root_folder__";
const CREATE_NEW_FOLDER_OPTION = "__create_new_folder__";

interface NewMapDraft {
  title: string;
  folderChoice: string;
  newFolderName: string;
  selectedCategories: string[];
  selectedTags: string[];
  summary: string;
}

const DEFAULT_DRAFT: NewMapDraft = {
  title: NEW_WEBMAP_TITLE,
  folderChoice: ROOT_FOLDER_OPTION,
  newFolderName: "",
  selectedCategories: [],
  selectedTags: [],
  summary: "",
};

function calciteBool(value: boolean): true | undefined {
  return value ? true : undefined;
}

function readSelectedComboboxValues(el: any): string[] {
  const items = Array.isArray(el?.selectedItems) ? el.selectedItems : Array.from(el?.selectedItems ?? []);
  return items.map((item: any) => String(item.value ?? item.textLabel ?? item.heading ?? "").trim()).filter(Boolean);
}

function renderCategoryItems(nodes: CategoryTreeNode[], selected: string[]): React.ReactNode {
  return nodes.map((node) => (
    <calcite-combobox-item
      key={node.value}
      value={node.value}
      heading={node.label}
      shortHeading={node.label}
      title={node.fullLabel}
      selected={calciteBool(selected.includes(node.value))}
    >
      {node.children.length ? renderCategoryItems(node.children, selected) : null}
    </calcite-combobox-item>
  ));
}

interface Props {
  open: boolean;
  oauthClientId: string | undefined;
  portalUrl: string;
  onClose: () => void;
  onCreated: (itemId: string, title: string) => void;
}

export function NewMapDialog({ open, oauthClientId, portalUrl, onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<NewMapDraft>(DEFAULT_DRAFT);
  const [folders, setFolders] = useState<UserFolderInfo[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<PortalCategoryOption[]>([]);
  const [tagOptions, setTagOptions] = useState<PortalTagInfo[]>([]);
  const [isMetaBusy, setIsMetaBusy] = useState(false);
  const [isCreateBusy, setIsCreateBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Load portal metadata whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setDraft(DEFAULT_DRAFT);
    setDialogError(null);
    setIsMetaBusy(true);

    let cancelled = false;
    void (async () => {
      try {
        const cred = await getCredential(oauthClientId, portalUrl);
        const [f, c, t] = await Promise.all([
          listUserFolders({ portalUrl, token: cred.token, username: cred.username }),
          listPortalCategoryOptions({ portalUrl }),
          listUserTags({ portalUrl }),
        ]);
        if (cancelled) return;
        setFolders(f);
        setCategoryOptions(c);
        setTagOptions(t);
      } catch (err: unknown) {
        if (!cancelled) {
          setFolders([]); setCategoryOptions([]); setTagOptions([]);
          setDialogError(err instanceof Error ? err.message : "Failed to load folders.");
        }
      } finally {
        if (!cancelled) setIsMetaBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, oauthClientId, portalUrl]);

  const handleCreate = useCallback(async () => {
    let newWebMap: WebMap | null = null;
    try {
      setIsCreateBusy(true);
      setDialogError(null);

      if (draft.summary.length > SUMMARY_CHAR_LIMIT) {
        throw new Error(`Summary cannot exceed ${SUMMARY_CHAR_LIMIT} characters.`);
      }

      const cred = await getCredential(oauthClientId, portalUrl);
      let folderId = "";

      if (draft.folderChoice === CREATE_NEW_FOLDER_OPTION) {
        if (!draft.newFolderName.trim()) throw new Error("Enter a folder name or choose an existing folder.");
        const created = await createUserFolder({
          portalUrl, token: cred.token, username: cred.username,
          title: draft.newFolderName.trim(),
        });
        folderId = created.id;
        setFolders((prev) => [created, ...prev.filter((f) => f.id !== created.id)]);
      } else if (draft.folderChoice !== ROOT_FOLDER_OPTION) {
        folderId = draft.folderChoice.trim();
      }

      const portal = new Portal({ url: portalUrl });
      await portal.load();

      newWebMap = await buildNewWebMap(portalUrl);

      const selectedFolder = folderId ? folders.find((f) => f.id === folderId) ?? null : null;
      const saveFolder = selectedFolder
        ? new PortalFolder({ id: selectedFolder.id, title: selectedFolder.title, portal })
        : undefined;

      const savedItem = await newWebMap.saveAs(
        {
          title: draft.title.trim() || NEW_WEBMAP_TITLE,
          snippet: draft.summary.trim() || NEW_WEBMAP_SNIPPET,
          description: draft.summary.trim() || undefined,
          tags: draft.selectedTags,
          categories: draft.selectedCategories,
          portal,
        },
        saveFolder ? { folder: saveFolder } : undefined,
      );

      if (!savedItem?.id) throw new Error("Failed to create a new WebMap.");

      onCreated(savedItem.id, savedItem.title || draft.title.trim() || NEW_WEBMAP_TITLE);
      onClose();
    } catch (err: unknown) {
      setDialogError(err instanceof Error ? err.message : "Failed to create a new map.");
    } finally {
      newWebMap?.destroy();
      setIsCreateBusy(false);
    }
  }, [draft, folders, oauthClientId, portalUrl, onCreated, onClose]);

  const handleTagAdd = useCallback((rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag) return;
    setDraft((d) => ({
      ...d,
      selectedTags: d.selectedTags.includes(tag) ? d.selectedTags : [...d.selectedTags, tag],
    }));
    setTagOptions((prev) =>
      prev.some((e) => e.tag === tag) ? prev : [...prev, { tag, count: 0 }].sort((a, b) => a.tag.localeCompare(b.tag)),
    );
  }, []);

  const handleFolderChange = useCallback((e: any) => {
    const values = readSelectedComboboxValues(e.target);
    const folderValue = values[0] || ROOT_FOLDER_OPTION;
    const existingIds = new Set(folders.map((f) => f.id));
    if (folderValue === ROOT_FOLDER_OPTION || existingIds.has(folderValue)) {
      setDraft((d) => ({ ...d, folderChoice: folderValue, newFolderName: "" }));
    } else {
      setDraft((d) => ({ ...d, folderChoice: CREATE_NEW_FOLDER_OPTION, newFolderName: folderValue }));
    }
  }, [folders]);

  const handleTagChange = useCallback((e: any) => {
    const values = readSelectedComboboxValues(e.target);
    const existing = new Set(tagOptions.map((t) => t.tag));
    values.filter((t) => !existing.has(t)).forEach(handleTagAdd);
    setDraft((d) => ({ ...d, selectedTags: values }));
  }, [handleTagAdd, tagOptions]);

  const handleCategoryChange = useCallback((e: any) => {
    const values = readSelectedComboboxValues(e.target);
    setDraft((d) => ({ ...d, selectedCategories: values }));
  }, []);

  if (!open) return null;

  const categoryTree = buildCategoryTree(categoryOptions);
  const canCreate = !isCreateBusy && draft.title.trim().length > 0;

  return (
    <calcite-dialog
      open
      overlay-positioning="fixed"
      heading="Create New Web Map"
      width-scale="m"
      onCalciteDialogClose={onClose}
    >
      <div className="new-map-dialog">
        <p className="new-map-dialog__intro">
          This saves the map to ArcGIS Online first so the assistant can work with a real WebMap item.
        </p>
        {isMetaBusy && (
          <p className="new-map-dialog__helper-text">Loading ArcGIS Online folders, categories, and tags...</p>
        )}
        <div className="new-map-dialog__grid">
          <label className="new-map-dialog__field new-map-dialog__field--wide">
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="New Map"
            />
          </label>
          <label className="new-map-dialog__field new-map-dialog__field--wide">
            <span>Folder</span>
            <calcite-combobox
              selection-mode="single"
              selection-display="single"
              allow-custom-values
              placeholder="Choose a folder or type a new folder"
              onCalciteComboboxChange={handleFolderChange}
            >
              <calcite-combobox-item
                value={ROOT_FOLDER_OPTION}
                heading="Root folder"
                selected={calciteBool(draft.folderChoice === ROOT_FOLDER_OPTION)}
              />
              <calcite-combobox-item-group label="Folders">
                {folders.map((f) => (
                  <calcite-combobox-item
                    key={f.id}
                    value={f.id}
                    heading={f.title}
                    selected={calciteBool(draft.folderChoice === f.id)}
                  />
                ))}
              </calcite-combobox-item-group>
              {draft.folderChoice === CREATE_NEW_FOLDER_OPTION && draft.newFolderName.trim() && (
                <calcite-combobox-item
                  value={draft.newFolderName.trim()}
                  heading={draft.newFolderName.trim()}
                  selected
                />
              )}
            </calcite-combobox>
            <p className="new-map-dialog__helper-text">
              Type a new folder name directly in the folder picker to create it.
            </p>
          </label>
          <label className="new-map-dialog__field new-map-dialog__field--wide new-map-dialog__field--category">
            <span>Search categories</span>
            <calcite-combobox
              selection-mode="multiple"
              selection-display="fit"
              placeholder="Search categories"
              onCalciteComboboxChange={handleCategoryChange}
            >
              <calcite-combobox-item-group label="Organization categories">
                {renderCategoryItems(categoryTree, draft.selectedCategories)}
              </calcite-combobox-item-group>
            </calcite-combobox>
            <p className="new-map-dialog__helper-text">
              {categoryOptions.length
                ? "Search and select one or more organization categories."
                : "No organization categories were found."}
            </p>
            {draft.selectedCategories.length > 0 && (
              <div className="new-map-dialog__selection-list">
                {draft.selectedCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className="new-map-dialog__selection-chip"
                    title={categoryOptions.find((o) => o.value === cat)?.label ?? cat}
                    onClick={() =>
                      setDraft((d) => ({ ...d, selectedCategories: d.selectedCategories.filter((c) => c !== cat) }))
                    }
                  >
                    {getCategoryLeafLabel(cat, categoryOptions)}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className="new-map-dialog__field new-map-dialog__field--wide">
            <span>Tags</span>
            <calcite-combobox
              selection-mode="multiple"
              selection-display="fit"
              allow-custom-values
              placeholder="Choose or add tags"
              onCalciteComboboxChange={handleTagChange}
            >
              <calcite-combobox-item-group label="Suggested tags">
                {tagOptions.map((entry) => (
                  <calcite-combobox-item
                    key={entry.tag}
                    value={entry.tag}
                    heading={entry.tag}
                    selected={calciteBool(draft.selectedTags.includes(entry.tag))}
                  />
                ))}
              </calcite-combobox-item-group>
            </calcite-combobox>
            {draft.selectedTags.length > 0 && (
              <div className="new-map-dialog__selection-list">
                {draft.selectedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="new-map-dialog__selection-chip"
                    onClick={() =>
                      setDraft((d) => ({ ...d, selectedTags: d.selectedTags.filter((t) => t !== tag) }))
                    }
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className="new-map-dialog__field new-map-dialog__field--wide">
            <span>Summary</span>
            <calcite-text-area
              class="new-map-dialog__summary"
              value={draft.summary}
              onChange={(e: { target: { value: string } }) =>
                setDraft((d) => ({ ...d, summary: e.target.value.slice(0, SUMMARY_CHAR_LIMIT) }))
              }
              placeholder="Short summary shown with the item"
            />
            <div className="new-map-dialog__character-count">
              {draft.summary.length}/{SUMMARY_CHAR_LIMIT}
            </div>
          </label>
        </div>
        {dialogError && <div className="new-map-dialog__error">{dialogError}</div>}
      </div>
      <calcite-button slot="footer-start" appearance="outline" kind="neutral" onClick={onClose}>
        Cancel
      </calcite-button>
      <calcite-button
        slot="footer-end"
        appearance="solid"
        kind="brand"
        disabled={calciteBool(!canCreate)}
        onClick={() => void handleCreate()}
      >
        {isCreateBusy ? "Creating..." : "Create map"}
      </calcite-button>
    </calcite-dialog>
  );
}
