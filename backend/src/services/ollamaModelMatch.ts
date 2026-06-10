export function getOllamaModelBaseName(modelName: string): string {
  return modelName.split(":")[0]?.trim().toLowerCase() ?? modelName.trim().toLowerCase();
}

export function ollamaModelMatches(configuredModel: string, installedModel: string): boolean {
  const configured = configuredModel.trim();
  const installed = installedModel.trim();

  if (!configured || !installed) {
    return false;
  }

  if (installed === configured) {
    return true;
  }

  if (installed.startsWith(`${configured}:`) || configured.startsWith(`${installed}:`)) {
    return true;
  }

  return getOllamaModelBaseName(configured) === getOllamaModelBaseName(installed);
}

export function findInstalledOllamaModel(configuredModel: string, installedModels: string[]): string | undefined {
  return installedModels.find((model) => ollamaModelMatches(configuredModel, model));
}
