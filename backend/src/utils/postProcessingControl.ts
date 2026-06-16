const controllers = new Map<string, AbortController>();

export function registerPostProcessingAbort(jobId: string): AbortSignal {
  controllers.get(jobId)?.abort(new Error("Post-processing replaced by a new run."));
  const controller = new AbortController();
  controllers.set(jobId, controller);
  return controller.signal;
}

export function clearPostProcessingAbort(jobId: string): void {
  controllers.delete(jobId);
}

export function abortPostProcessing(jobId: string, reason = "Post-processing cancelled."): boolean {
  const controller = controllers.get(jobId);
  if (!controller) {
    return false;
  }

  controller.abort(new Error(reason));
  controllers.delete(jobId);
  return true;
}

export function hasActivePostProcessingAbort(jobId: string): boolean {
  return controllers.has(jobId);
}
