import { useEffect, useMemo, useRef, useState } from "react";
import {
  convertNotesToAudio,
  getJob,
  getNoteExcerpt,
  getVoicePreviewUrl,
  JobPayload,
  scanVault,
  type NoteInfo,
  type ProviderInfo
} from "./api";
import { LlmProviderPicker, readStoredLlmSelection } from "./LlmProviderPicker";

const VOICES = [
  { id: "es-MX-DaliaNeural", name: "Dalia", detail: "México · Femenina" },
  { id: "es-MX-JorgeNeural", name: "Jorge", detail: "México · Masculina" },
  { id: "es-ES-ElviraNeural", name: "Elvira", detail: "España · Femenina" },
  { id: "es-ES-AlvaroNeural", name: "Álvaro", detail: "España · Masculina" },
  { id: "es-US-PalomaNeural", name: "Paloma", detail: "EE.UU. · Femenina" },
  { id: "es-US-AlonsoNeural", name: "Alonso", detail: "EE.UU. · Masculina" },
  { id: "en-US-AvaNeural", name: "Ava", detail: "Inglés · Femenina" },
  { id: "en-US-AndrewNeural", name: "Andrew", detail: "Inglés · Masculina" }
] as const;

type FolderGroup = {
  folder: string;
  notes: NoteInfo[];
};

function folderOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

function fileNameOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? relativePath : relativePath.slice(idx + 1);
}

function GroupCheckbox({
  checked,
  indeterminate,
  onChange
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="vault-check"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label="Seleccionar carpeta completa"
    />
  );
}

export function VaultNotesPanel({
  onJobStarted,
  onError
}: {
  onJobStarted: (job: JobPayload) => void;
  onError: (message: string) => void;
}) {
  const [vaultPath, setVaultPath] = useState(
    localStorage.getItem("notadio_vault_path") || ""
  );
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedVoice, setSelectedVoice] = useState("es-MX-DaliaNeural");
  const [isConverting, setIsConverting] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(readStoredLlmSelection().provider ?? "");
  const [selectedModel, setSelectedModel] = useState(readStoredLlmSelection().model ?? "");

  function handleProvidersLoaded(list: ProviderInfo[]) {
    setProviders(list);
    if (!selectedProvider && list[0]) {
      setSelectedProvider(list[0].id);
      setSelectedModel((current) => current || list[0].defaultModel);
    }
  }

  // Voice audition
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);

  // Note preview on hover/focus
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewExcerpt, setPreviewExcerpt] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const previewAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      previewAbort.current?.abort();
      audioRef.current?.pause();
    };
  }, []);

  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    notes.forEach((note) => note.tags.forEach((tag) => tagsSet.add(tag)));
    return Array.from(tagsSet).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return notes.filter((n) => {
      const matchesSearch =
        query === "" ||
        n.title.toLowerCase().includes(query) ||
        n.relativePath.toLowerCase().includes(query);
      const matchesTag = selectedTag === "" || n.tags.includes(selectedTag);
      return matchesSearch && matchesTag;
    });
  }, [notes, searchQuery, selectedTag]);

  const isFiltering = searchQuery.trim() !== "" || selectedTag !== "";

  const groups = useMemo<FolderGroup[]>(() => {
    const map = new Map<string, NoteInfo[]>();
    for (const note of filteredNotes) {
      const folder = folderOf(note.relativePath);
      const list = map.get(folder);
      if (list) list.push(note);
      else map.set(folder, [note]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }))
      .map(([folder, folderNotes]) => ({
        folder,
        notes: folderNotes.sort((a, b) => a.title.localeCompare(b.title, "es", { numeric: true }))
      }));
  }, [filteredNotes]);

  function previewVoice(voiceId: string) {
    // Toggle off if the same voice is already playing.
    if (playingVoice === voiceId && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoice(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(getVoicePreviewUrl(voiceId));
    audioRef.current = audio;
    setPlayingVoice(voiceId);
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => {
      setPlayingVoice(null);
      onError("No se pudo reproducir la muestra de voz (¿backend activo?).");
    };
    void audio.play().catch(() => setPlayingVoice(null));
  }

  function handleNoteHover(note: NoteInfo) {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      previewAbort.current?.abort();
      const ctrl = new AbortController();
      previewAbort.current = ctrl;
      setPreviewPath(note.relativePath);
      setPreviewExcerpt("");
      setPreviewLoading(true);
      getNoteExcerpt(vaultPath, note.relativePath, ctrl.signal)
        .then((data) => {
          setPreviewExcerpt(data?.excerpt || "Sin contenido de texto.");
        })
        .catch(() => setPreviewExcerpt(""))
        .finally(() => setPreviewLoading(false));
    }, 350);
  }

  function clearPreview() {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    previewAbort.current?.abort();
    setPreviewPath(null);
    setPreviewExcerpt("");
    setPreviewLoading(false);
  }

  async function handleScanVault() {
    if (!vaultPath.trim()) return;
    setIsScanning(true);
    try {
      const result = await scanVault(vaultPath);
      setNotes(result);
      setHasScanned(true);
      setSelectedNotes(new Set());
      setExpandedFolders(new Set());
      setSearchQuery("");
      setSelectedTag("");
      clearPreview();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo escanear el vault");
    } finally {
      setIsScanning(false);
    }
  }

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  function toggleNote(path: string) {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleGroup(group: FolderGroup) {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      const allSelected = group.notes.every((n) => next.has(n.relativePath));
      for (const note of group.notes) {
        if (allSelected) next.delete(note.relativePath);
        else next.add(note.relativePath);
      }
      return next;
    });
  }

  async function handleConvert() {
    if (selectedNotes.size === 0) return;
    setIsConverting(true);
    try {
      const { jobIds } = await convertNotesToAudio(
        vaultPath,
        Array.from(selectedNotes),
        selectedVoice,
        selectedProvider || undefined,
        selectedModel || undefined
      );
      if (jobIds.length > 0) {
        const firstJob = await getJob(jobIds[0]);
        setSelectedNotes(new Set());
        onJobStarted(firstJob);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron convertir las notas");
    } finally {
      setIsConverting(false);
    }
  }

  const selectedCount = selectedNotes.size;
  const voiceName = VOICES.find((v) => v.id === selectedVoice)?.name ?? selectedVoice;
  const providerLabel =
    providers.find((p) => p.id === selectedProvider)?.label ?? "LLM";

  return (
    <div className="vault-panel">
      <div className="vault-path-row">
        <label className="vault-label" htmlFor="vault-path-input">
          Vault de Obsidian
        </label>
        <div className="vault-path-controls">
          <input
            id="vault-path-input"
            type="text"
            className="vault-input"
            placeholder="C:\Users\tu-usuario\Documentos\MiVault"
            value={vaultPath}
            onChange={(e) => {
              setVaultPath(e.target.value);
              localStorage.setItem("notadio_vault_path", e.target.value);
            }}
            onBlur={(e) => {
              const clean = e.target.value.trim().replace(/^["']|["']$/g, "");
              if (clean !== e.target.value) {
                setVaultPath(clean);
                localStorage.setItem("notadio_vault_path", clean);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleScanVault();
            }}
          />
          <button
            className="btn-secondary"
            onClick={() => void handleScanVault()}
            disabled={isScanning || !vaultPath.trim()}
            type="button"
          >
            {isScanning ? "Escaneando…" : hasScanned ? "Re-escanear" : "Escanear"}
          </button>
        </div>
      </div>

      {!hasScanned && !isScanning && (
        <div className="vault-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <p>
            Apunta a la carpeta raíz de tu vault y escanéala. Las notas Markdown
            se agrupan por carpeta para que elijas qué convertir a audio narrado.
          </p>
        </div>
      )}

      {hasScanned && notes.length === 0 && (
        <div className="vault-empty">
          <p>No se encontraron notas Markdown en esa ruta. Verifica que sea la raíz del vault.</p>
        </div>
      )}

      {notes.length > 0 && (
        <>
          <div className="vault-toolbar">
            <div className="vault-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
              <input
                type="search"
                placeholder={`Buscar entre ${notes.length} notas…`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar notas"
              />
            </div>
            {allTags.length > 0 && (
              <select
                className="vault-select"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                aria-label="Filtrar por tag"
              >
                <option value="">Todos los tags</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>#{tag}</option>
                ))}
              </select>
            )}
          </div>

          <div className="vault-meta-row">
            <span>
              {isFiltering
                ? `${filteredNotes.length} de ${notes.length} notas`
                : `${notes.length} notas en ${groups.length} carpetas`}
            </span>
            {selectedCount > 0 && (
              <button
                type="button"
                className="vault-link-btn"
                onClick={() => setSelectedNotes(new Set())}
              >
                Limpiar selección ({selectedCount})
              </button>
            )}
          </div>

          <div className="vault-tree" role="tree" aria-label="Notas del vault">
            {groups.length === 0 && (
              <div className="vault-empty vault-empty--inline">
                <p>Ninguna nota coincide con “{searchQuery || selectedTag}”.</p>
              </div>
            )}
            {groups.map((group) => {
              const selectedInGroup = group.notes.filter((n) =>
                selectedNotes.has(n.relativePath)
              ).length;
              const allSelected = selectedInGroup === group.notes.length;
              const isExpanded = isFiltering || expandedFolders.has(group.folder);
              const segments = group.folder === "" ? [] : group.folder.split("/");
              const leaf = segments.length > 0 ? segments[segments.length - 1] : "Raíz del vault";
              const parent = segments.slice(0, -1).join(" / ");
              return (
                <div key={group.folder || "__root__"} className="vault-group">
                  <div
                    className="vault-group-header"
                    role="treeitem"
                    aria-expanded={isExpanded}
                    tabIndex={0}
                    onClick={() => toggleFolder(group.folder)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleFolder(group.folder);
                      }
                    }}
                  >
                    <span className={`vault-caret ${isExpanded ? "open" : ""}`} aria-hidden="true">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </span>
                    <GroupCheckbox
                      checked={allSelected}
                      indeterminate={selectedInGroup > 0 && !allSelected}
                      onChange={() => toggleGroup(group)}
                    />
                    <span className="vault-folder-name">
                      {parent && <span className="vault-folder-parent">{parent} / </span>}
                      {leaf}
                    </span>
                    <span className="vault-folder-count">
                      {selectedInGroup > 0 ? `${selectedInGroup} / ${group.notes.length}` : group.notes.length}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="vault-group-body">
                      {group.notes.map((note) => {
                        const isSelected = selectedNotes.has(note.relativePath);
                        const isPreviewing = previewPath === note.relativePath;
                        return (
                          <div key={note.relativePath} className="vault-note-wrap">
                            <label
                              className={`vault-note ${isSelected ? "selected" : ""}`}
                              onMouseEnter={() => handleNoteHover(note)}
                              onMouseLeave={clearPreview}
                              onFocus={() => handleNoteHover(note)}
                              onBlur={clearPreview}
                            >
                              <input
                                type="checkbox"
                                className="vault-check"
                                checked={isSelected}
                                onChange={() => toggleNote(note.relativePath)}
                              />
                              <span className="vault-note-title">{note.title}</span>
                              {note.tags.slice(0, 2).map((tag) => (
                                <span key={tag} className="vault-note-tag">#{tag}</span>
                              ))}
                            </label>
                            {isPreviewing && (
                              <div className="vault-note-preview" role="status">
                                {previewLoading ? (
                                  <span className="vault-note-preview-loading">Cargando vista previa…</span>
                                ) : (
                                  <>
                                    <span className="vault-note-preview-path">{fileNameOf(note.relativePath)}</span>
                                    <p>{previewExcerpt}</p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <fieldset className="vault-config">
            <legend className="vault-label">Voz para la narración</legend>
            <div className="voice-grid" role="radiogroup" aria-label="Voz para la narración">
              {VOICES.map((voice) => {
                const isSelected = selectedVoice === voice.id;
                const isPlaying = playingVoice === voice.id;
                return (
                  <div
                    key={voice.id}
                    className={`voice-chip ${isSelected ? "selected" : ""}`}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => setSelectedVoice(voice.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedVoice(voice.id);
                      }
                    }}
                  >
                    <span className="voice-chip-text">
                      <strong>{voice.name}</strong>
                      <span>{voice.detail}</span>
                    </span>
                    <button
                      type="button"
                      className={`voice-play ${isPlaying ? "playing" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        previewVoice(voice.id);
                      }}
                      aria-label={isPlaying ? `Detener muestra de ${voice.name}` : `Escuchar muestra de ${voice.name}`}
                    >
                      {isPlaying ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <rect x="6" y="5" width="4" height="14" rx="1" />
                          <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <LlmProviderPicker
            className="vault-llm-panel"
            compact
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            onProviderChange={setSelectedProvider}
            onModelChange={setSelectedModel}
            onProvidersLoaded={handleProvidersLoaded}
          />

          <div className="vault-footer">
            <div className="vault-summary-strip" aria-live="polite">
              {selectedCount === 0 ? (
                <span className="vault-summary-empty">Aún no seleccionas notas</span>
              ) : (
                <>
                  <span className="vault-summary-pill">
                    {selectedCount} {selectedCount === 1 ? "nota" : "notas"}
                  </span>
                  <span className="vault-summary-sep">·</span>
                  <span>{voiceName}</span>
                  <span className="vault-summary-sep">·</span>
                  <span>{providerLabel}</span>
                </>
              )}
            </div>
            <button
              className="btn-primary premium-cta vault-convert-btn"
              onClick={() => void handleConvert()}
              disabled={selectedCount === 0 || isConverting}
              type="button"
            >
              {isConverting
                ? `Convirtiendo ${selectedCount} ${selectedCount === 1 ? "nota" : "notas"}…`
                : selectedCount === 0
                  ? "Selecciona notas para convertir"
                  : `Convertir ${selectedCount} ${selectedCount === 1 ? "nota" : "notas"} a audio`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
