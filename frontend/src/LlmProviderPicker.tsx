import { useEffect, useState } from "react";
import { AppSelect } from "./AppSelect";
import { getProviderModels, getProviders, type ProviderInfo } from "./api";
import { MODEL_ALIASES, modelLabel } from "./llmModelLabels";

const STORAGE_PROVIDER = "notadio_llm_provider";
const STORAGE_MODEL = "notadio_llm_model";

export type LlmSelection = {
  provider: string;
  model: string;
};

export function readStoredLlmSelection(): Partial<LlmSelection> {
  return {
    provider: localStorage.getItem(STORAGE_PROVIDER) || undefined,
    model: localStorage.getItem(STORAGE_MODEL) || undefined
  };
}

export function persistLlmSelection(selection: LlmSelection): void {
  localStorage.setItem(STORAGE_PROVIDER, selection.provider);
  localStorage.setItem(STORAGE_MODEL, selection.model);
}

export function resolveInitialLlmSelection(
  jobProvider?: string,
  jobModel?: string
): Partial<LlmSelection> {
  const stored = readStoredLlmSelection();
  return {
    provider: jobProvider || stored.provider,
    model: jobModel || stored.model
  };
}

type LlmProviderPickerProps = {
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string) => void;
  onProvidersLoaded?: (providers: ProviderInfo[]) => void;
  hint?: string;
  className?: string;
  compact?: boolean;
};

export function LlmProviderPicker({
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
  onProvidersLoaded,
  hint,
  className,
  compact = false
}: LlmProviderPickerProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(true);

  useEffect(() => {
    getProviders()
      .then((list) => {
        setProviders(list);
        onProvidersLoaded?.(list);
      })
      .catch(() => setProviders([]))
      .finally(() => setProvidersLoading(false));
  }, [onProvidersLoaded]);

  useEffect(() => {
    if (!selectedProvider) {
      setAvailableModels([]);
      return;
    }
    setModelsLoading(true);
    getProviderModels(selectedProvider)
      .then((list) => setAvailableModels(list))
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false));
  }, [selectedProvider]);

  useEffect(() => {
    if (selectedProvider && selectedModel) {
      persistLlmSelection({ provider: selectedProvider, model: selectedModel });
    }
  }, [selectedProvider, selectedModel]);

  function handleProviderChange(providerId: string) {
    onProviderChange(providerId);
    const info = providers.find((p) => p.id === providerId);
    if (info) onModelChange(info.defaultModel);
  }

  const providerLabel =
    providers.find((p) => p.id === selectedProvider)?.label ?? "LLM";

  const modelOptions = availableModels.map((id) => ({
    value: id,
    label: modelLabel(id),
    description: MODEL_ALIASES[id]
  }));

  if (!modelOptions.some((option) => option.value === selectedModel) && selectedModel) {
    modelOptions.unshift({
      value: selectedModel,
      label: modelLabel(selectedModel),
      description: MODEL_ALIASES[selectedModel]
    });
  }

  return (
    <div className={`llm-provider-picker ${compact ? "is-compact" : ""} ${className ?? ""}`.trim()}>
      <div className="llm-provider-picker-head">
        <span className="llm-provider-picker-label">AI model</span>
        {selectedProvider && selectedModel && (
          <span className="llm-provider-picker-current">
            {providerLabel} · {selectedModel}
          </span>
        )}
      </div>

      <div className="llm-provider-picker-row">
        {providersLoading ? (
          <span className="llm-provider-picker-loading">Loading providers…</span>
        ) : providers.length > 1 ? (
          <div className="control-strip" role="tablist" aria-label="LLM provider">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`control-btn ${selectedProvider === p.id ? "active" : ""}`}
                onClick={() => handleProviderChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="llm-provider-picker-single">
            {providers[0]?.label ?? "No LLM provider configured"}
          </span>
        )}
      </div>

      <div className="llm-provider-picker-model-row">
        {modelsLoading ? (
          <span className="llm-provider-picker-loading">Loading models…</span>
        ) : modelOptions.length > 0 ? (
          <AppSelect
            label="Model"
            value={selectedModel}
            options={modelOptions}
            onChange={onModelChange}
            disabled={!selectedProvider}
            placeholder="Pick a model"
          />
        ) : (
          <label className="llm-provider-picker-manual">
            <span className="app-select-label">Model</span>
            <input
              type="text"
              className="llm-provider-picker-input"
              placeholder="Model id (e.g. deepseek-v4-pro)"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              aria-label="Model"
              disabled={!selectedProvider}
            />
          </label>
        )}
      </div>

      {selectedProvider && !modelsLoading && availableModels.length === 0 && (
        <p className="llm-provider-picker-note">
          Could not list models from this provider. Enter the model id manually
          (check that the provider is running or your API key is set).
        </p>
      )}

      {hint && <p className="llm-provider-picker-hint">{hint}</p>}
    </div>
  );
}
