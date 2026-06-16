import test from "node:test";
import assert from "node:assert/strict";
import { generateSummary, stripSummaryRuntimeWarnings } from "./summaryService.js";
import { config } from "../config.js";
import { SummaryPreset, TranscriptRecord } from "../types.js";

type FetchStep = {
  payload?: string;
  error?: string;
  delayMs?: number;
};

type FetchCall = {
  url: string;
  body: Record<string, unknown>;
};

function requestBodyText(body: Record<string, unknown>): string {
  return `${String(body.system ?? "")}\n${String(body.prompt ?? "")}`;
}

function createTranscriptRecord(segmentTexts: string[]): TranscriptRecord {
  return {
    jobId: "job-1",
    sourceMedia: {
      originalName: "meeting.m4a",
      mimeType: "audio/m4a",
      sizeBytes: 1024
    },
    durationSeconds: segmentTexts.length * 30,
    detectedLanguage: "es",
    warnings: [],
    source: {
      language: "es",
      text: segmentTexts.join(" "),
      segments: segmentTexts.map((text, index) => ({
        start: index * 30,
        end: index * 30 + 25,
        speaker: `SPEAKER_0${index % 3}`,
        text
      }))
    }
  };
}

function installFetchSteps(steps: FetchStep[]): { restore: () => void; calls: () => number; requestBodies: () => FetchCall[] } {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const capturedBodies: FetchCall[] = [];

  globalThis.fetch = (async (input, init) => {
    const step = steps[callCount] ?? steps[steps.length - 1];
    callCount += 1;
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    capturedBodies.push({
      url: String(input),
      body: JSON.parse(rawBody) as Record<string, unknown>
    });

    if (step.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }

    if (step.error) {
      throw new Error(step.error);
    }

    const payload = step.payload ?? "{}";
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: payload }),
      text: async () => payload
    } as Response;
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    calls: () => callCount,
    requestBodies: () => capturedBodies
  };
}

function withSummaryConfig<T>(overrides: Partial<typeof config>, fn: () => Promise<T>): Promise<T> {
  const snapshot = {
    summaryChunkConcurrency: config.summaryChunkConcurrency,
    summaryReduceMinPartials: config.summaryReduceMinPartials,
    summaryDirectCharLimit: config.summaryDirectCharLimit,
    summaryChunkCharLimit: config.summaryChunkCharLimit,
    summaryMaxInputChars: config.summaryMaxInputChars,
    summaryBlockMaxChars: config.summaryBlockMaxChars,
    summaryOllamaNumPredict: config.summaryOllamaNumPredict,
    summaryOllamaNumCtx: config.summaryOllamaNumCtx,
    summaryOllamaKeepAlive: config.summaryOllamaKeepAlive
  };

  Object.assign(config, overrides);

  return fn().finally(() => {
    Object.assign(config, snapshot);
  });
}

test("generateSummary falls back when Ollama returns empty structured JSON", async () => {
  const transcript = createTranscriptRecord([
    "Se revisó el contrato y se detectaron riesgos legales graves que afectan la operación.",
    "También se acordó validar cláusulas de propiedad intelectual y preparar una auditoría independiente."
  ]);
  const { restore } = installFetchSteps([{ payload: "{}" }]);

  try {
    const result = await generateSummary(transcript);

    assert.equal(Boolean(result.summary), true);
    assert.equal(result.summary?.brief === "No brief generated.", false);
    assert.equal(result.summary?.sections.length === 0, false);
    assert.equal(result.warnings.some((warning) => /fallback/i.test(warning)), true);
    assert.equal(result.summaryDiagnostics?.mode, "direct");
    assert.equal(result.summaryDiagnostics?.usedFallback, true);
    assert.equal(result.summaryDiagnostics?.requestCount, 1);
    assert.equal(result.summaryDiagnostics?.chunks.length, 1);
    assert.equal(result.summaryDiagnostics?.chunks[0]?.status, "completed");
  } finally {
    restore();
  }
});

test("generateSummary applies configurable prompt limits and Ollama options", async () => {
  const longSegment = "Se revisaron acuerdos, riesgos, tareas y responsables en detalle para el siguiente entregable. ".repeat(24);
  const transcript = createTranscriptRecord([longSegment, longSegment, longSegment]);

  await withSummaryConfig(
    {
      summaryDirectCharLimit: 2200,
      summaryChunkCharLimit: 900,
      summaryMaxInputChars: 4800,
      summaryBlockMaxChars: 160,
      summaryChunkConcurrency: 1,
      summaryReduceMinPartials: 2,
      summaryOllamaNumPredict: 192,
      summaryOllamaNumCtx: 4096,
      summaryOllamaKeepAlive: "10m"
    },
    async () => {
      const { restore, calls, requestBodies } = installFetchSteps([
        {
          payload: JSON.stringify({
            headline: "Bloque 1",
            brief: "Se confirmó un bloque de tareas y riesgos.",
            keyDecisions: ["Validar los acuerdos"],
            actionItems: [{ task: "Preparar entregable", assignee: "Equipo" }],
            sections: [{ title: "Bloque", summary: "Resumen del bloque", bullets: ["Riesgo principal"] }]
          })
        },
        {
          payload: JSON.stringify({
            headline: "Bloque 2",
            brief: "El equipo detalló dependencias y seguimiento.",
            keyDecisions: ["Revisar dependencias"],
            actionItems: [{ task: "Confirmar responsables", assignee: "PM" }],
            sections: [{ title: "Seguimiento", summary: "Resumen del bloque", bullets: ["Seguimiento"] }]
          })
        },
        {
          payload: JSON.stringify({
            headline: "Resumen final",
            brief: "Se priorizaron acuerdos, riesgos y entregables siguientes.",
            keyDecisions: ["Validar acuerdos", "Revisar dependencias"],
            actionItems: [{ task: "Preparar entregable", assignee: "Equipo", priority: "alta" }],
            sections: [{ title: "Síntesis", summary: "Consolidado ejecutivo", bullets: ["Entregable", "Seguimiento"] }]
          })
        }
      ]);

      try {
        const result = await generateSummary(transcript);

        assert.equal(calls(), 3);
        assert.equal(result.summaryDiagnostics?.mode, "chunked");
        assert.equal((result.summaryDiagnostics?.chunkCount ?? 0) >= 2, true);
        assert.equal((result.summaryDiagnostics?.inputChars ?? 0) <= config.summaryMaxInputChars, true);

        const bodies = requestBodies();
        assert.equal(bodies.every((entry) => entry.url.includes("/api/generate")), true);
        assert.equal(bodies.every((entry) => entry.body.keep_alive === "10m"), true);
        assert.equal(
          bodies.every((entry) => {
            const options = entry.body.options as Record<string, unknown>;
            return options.num_predict === 192 && options.num_ctx === 4096;
          }),
          true
        );
      } finally {
        restore();
      }
    }
  );
});

test("generateSummary samples transcript input to configured max chars", async () => {
  const verboseSegment =
    "El equipo repasó decisiones, pendientes, evidencia, acuerdos legales y operaciones de seguimiento con mucho detalle. ".repeat(18);
  const transcript = createTranscriptRecord([verboseSegment, verboseSegment, verboseSegment, verboseSegment]);

  await withSummaryConfig(
    {
      summaryDirectCharLimit: 2000,
      summaryChunkCharLimit: 1200,
      summaryMaxInputChars: 2200,
      summaryBlockMaxChars: 120
    },
    async () => {
      const { restore, requestBodies } = installFetchSteps([
        {
          payload: JSON.stringify({
            headline: "Resumen directo",
            brief: "Se obtuvo un resumen breve con muestreo del input.",
            keyDecisions: ["Seguir con el plan"],
            actionItems: [{ task: "Continuar seguimiento", assignee: "Operaciones" }],
            sections: [{ title: "Muestreo", summary: "Se limitó el input para resumir.", bullets: ["Input reducido"] }]
          })
        }
      ]);

      try {
        const result = await generateSummary(transcript);
        const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

        assert.equal(result.summaryDiagnostics?.mode, "direct");
        assert.equal(result.summaryDiagnostics?.sampled, true);
        assert.equal((result.summaryDiagnostics?.inputChars ?? 0) <= config.summaryMaxInputChars, true);
        assert.equal(prompt.includes("Transcripción:"), true);
        assert.equal(prompt.length > result.summaryDiagnostics!.inputChars, true);
      } finally {
        restore();
      }
    }
  );
});

test("generateSummary records diagnostics for chunked summarize plus final reduce", async () => {
  const longSegment = "Riesgo legal, operativo y financiero identificado en la revisión del convenio. ".repeat(70);
  const transcript = createTranscriptRecord([longSegment, longSegment, longSegment, longSegment]);
  const { restore, calls } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Bloque 1",
        brief: "Se detectaron cláusulas problemáticas y tareas legales inmediatas.",
        keyDecisions: ["Revisar el contrato actual"],
        actionItems: [{ task: "Preparar observaciones legales", assignee: "Javier" }],
        sections: [{ title: "Riesgos", summary: "El bloque concentra hallazgos legales críticos.", bullets: ["Cláusulas ambiguas"] }]
      }),
      delayMs: 10
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 2",
        brief: "También se discutió la necesidad de auditar el trabajo entregado y su valuación.",
        keyDecisions: ["Solicitar auditoría independiente"],
        actionItems: [{ task: "Coordinar auditoría técnica", assignee: "Equipo legal" }],
        sections: [{ title: "Auditoría", summary: "Se acordó validar el valor del trabajo ya entregado.", bullets: ["Auditoría externa"] }]
      }),
      delayMs: 5
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 3",
        brief: "El bloque confirmó prioridades y seguimiento legal.",
        keyDecisions: ["Alinear negociación con respaldo documental"],
        actionItems: [{ task: "Actualizar carpeta de evidencia", assignee: "Operaciones" }],
        sections: [{ title: "Seguimiento", summary: "Se reforzó el plan de soporte documental.", bullets: ["Evidencia consolidada"] }]
      })
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 4",
        brief: "El equipo acordó corregir cláusulas y sostener una auditoría independiente.",
        keyDecisions: ["Corregir el convenio", "Solicitar auditoría independiente"],
        actionItems: [{ task: "Validar cláusulas con abogado", assignee: "Javier" }],
        sections: [{ title: "Cierre", summary: "Las prioridades quedaron definidas para la siguiente ronda.", bullets: ["Corregir convenio"] }]
      })
    },
    {
      payload: JSON.stringify({
        headline: "Prioridad: corregir el convenio y documentar la auditoría",
        brief: "El equipo identificó riesgos contractuales severos y acordó corregirlos antes de continuar. También definió una auditoría independiente y tareas legales concretas para respaldar la negociación.",
        keyDecisions: ["Corregir el convenio", "Solicitar auditoría independiente"],
        actionItems: [{ task: "Validar cláusulas con abogado", assignee: "Javier", priority: "alta" }],
        sections: [{ title: "Riesgos legales", summary: "La prioridad es corregir cláusulas ambiguas y proteger la propiedad intelectual.", bullets: ["Corregir convenio", "Asegurar respaldo legal"] }]
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript);

    assert.equal(calls() > 4, true);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.summary?.headline, "Prioridad: corregir el convenio y documentar la auditoría");
    assert.match(result.summary?.brief ?? "", /riesgos contractuales severos/i);
    assert.equal(result.summaryDiagnostics?.mode, "chunked");
    assert.equal((result.summaryDiagnostics?.chunkCount ?? 0) > 1, true);
    assert.equal(result.summaryDiagnostics?.usedReduce, true);
    assert.equal((result.summaryDiagnostics?.reduceDurationMs ?? 0) >= 0, true);
    assert.equal(result.summaryDiagnostics?.chunks.length, result.summaryDiagnostics?.chunkCount);
    assert.equal(result.summaryDiagnostics?.chunks.every((chunk) => chunk.status === "completed"), true);
  } finally {
    restore();
  }
});

test("generateSummary skips final reduce and merges locally for a small partial set", async () => {
  const longSegment = "Seguimiento legal y operativo con acuerdos concretos para la siguiente iteración. ".repeat(90);
  const transcript = createTranscriptRecord([longSegment, longSegment]);
  const { restore, calls } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Bloque 1",
        brief: "Se confirmó la revisión contractual y el siguiente paquete de entregables.",
        keyDecisions: ["Revisar anexos"],
        actionItems: [{ task: "Preparar anexos", assignee: "Legal" }],
        sections: [{ title: "Contrato", summary: "Se revisarán anexos antes del cierre.", bullets: ["Anexos pendientes"] }]
      })
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 2",
        brief: "El equipo definió responsables y tiempos para el seguimiento.",
        keyDecisions: ["Asignar responsables"],
        actionItems: [{ task: "Coordinar seguimiento", assignee: "Operaciones" }],
        sections: [{ title: "Seguimiento", summary: "Se calendarizaron responsables para la siguiente ronda.", bullets: ["Seguimiento calendarizado"] }]
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript);

    assert.equal(calls(), 2);
    assert.equal(result.summaryDiagnostics?.mode, "chunked");
    assert.equal(result.summaryDiagnostics?.usedReduce, false);
    assert.equal(result.summaryDiagnostics?.usedMergedPartials, true);
    assert.equal((result.summaryDiagnostics?.mergeDurationMs ?? -1) >= 0, true);
    assert.equal(result.summaryDiagnostics?.requestCount, 2);
    assert.equal(result.summaryDiagnostics?.partialCount, 2);
  } finally {
    restore();
  }
});

test("generateSummary falls back to merged chunk summaries when final reduce fails", async () => {
  const longSegment = "Hallazgo contractual crítico y tareas pendientes para cerrar la negociación. ".repeat(65);
  const transcript = createTranscriptRecord([longSegment, longSegment, longSegment]);
  const { restore, calls } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Bloque 1",
        brief: "Se detectó un riesgo contractual mayor.",
        keyDecisions: ["Escalar revisión legal"],
        actionItems: [{ task: "Escalar revisión", assignee: "Legal" }],
        sections: [{ title: "Riesgo", summary: "Debe revisarse el contrato con prioridad.", bullets: ["Escalar legal"] }]
      })
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 2",
        brief: "Se acordó auditar el entregable antes de firmar.",
        keyDecisions: ["Solicitar auditoría"],
        actionItems: [{ task: "Solicitar auditoría", assignee: "Operaciones" }],
        sections: [{ title: "Auditoría", summary: "No se avanzará sin validación externa.", bullets: ["Auditoría externa"] }]
      })
    },
    {
      payload: JSON.stringify({
        headline: "Bloque 3",
        brief: "El equipo definió evidencia y seguimiento para negociación.",
        keyDecisions: ["Consolidar evidencia"],
        actionItems: [{ task: "Consolidar evidencia", assignee: "PM" }],
        sections: [{ title: "Soporte", summary: "Se ordenará evidencia para la siguiente reunión.", bullets: ["Evidencia lista"] }]
      })
    },
    { error: "reduce request failed" }
  ]);

  try {
    const result = await generateSummary(transcript);

    assert.equal(calls(), 4);
    assert.equal(result.summaryDiagnostics?.mode, "chunked");
    assert.equal(result.summaryDiagnostics?.usedReduce, false);
    assert.equal(result.summaryDiagnostics?.usedMergedPartials, true);
    assert.equal(result.summaryDiagnostics?.requestCount, 3);
    assert.equal((result.summaryDiagnostics?.mergeDurationMs ?? -1) >= 0, true);
    assert.equal(Boolean(result.summary?.brief), true);
  } finally {
    restore();
  }
});

test("generateSummary uses whatsappVoiceNote preset in prompt", async () => {
  const transcript = createTranscriptRecord([
    "Oye necesito que me envíes el documento antes del viernes por favor."
  ]);
  const { restore, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Solicitud de documento",
        brief: "El hablante solicita un documento antes del viernes.",
        keyDecisions: [],
        actionItems: [{ task: "Enviar documento", deadline: "viernes" }],
        sections: []
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript, {}, { preset: "whatsappVoiceNote" });
    const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

    assert.equal(prompt.includes("notas de voz"), true);
    assert.equal(prompt.includes("solo hay un hablante"), true);
    assert.equal(Boolean(result.summary), true);
  } finally {
    restore();
  }
});

test("generateSummary uses genericMedia preset in prompt", async () => {
  const transcript = createTranscriptRecord([
    "En este video tutorial vamos a ver cómo configurar un servidor de desarrollo."
  ]);
  const { restore, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Tutorial de configuración",
        brief: "Video tutorial sobre configuración de servidor de desarrollo.",
        keyDecisions: [],
        actionItems: [],
        sections: [{ title: "Setup", summary: "Pasos de configuración", bullets: ["Instalar dependencias"] }]
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript, {}, { preset: "genericMedia" });
    const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

    assert.equal(prompt.includes("audio y video"), true);
    assert.equal(prompt.includes("neutral"), true);
    assert.equal(Boolean(result.summary), true);
  } finally {
    restore();
  }
});

test("generateSummary uses analysisEssay preset in prompt and preserves thesis fields", async () => {
  const transcript = createTranscriptRecord([
    "Mi argumento es que la automatizacion mediocre no reemplaza el criterio. Por ejemplo, un campeon del mundo de hacer conejos con globos muestra que el valor esta en la profundidad del oficio."
  ]);
  const { restore, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        contentType: "analysisEssay",
        headline: "El criterio importa mas que la automatizacion superficial",
        brief: "El autor sostiene que el valor real proviene del criterio y la profundidad del oficio.",
        coreClaims: ["La tesis central es que la profundidad humana sigue siendo diferencial."],
        evidenceMoments: ["El ejemplo del campeon de conejos con globos sostiene el argumento."],
        keyDecisions: [],
        actionItems: [],
        sections: []
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript, {}, { preset: "analysisEssay" });
    const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

    assert.equal(prompt.includes("ensayos, editoriales y contenido argumentativo"), true);
    assert.equal(result.summary?.contentType, "analysisEssay");
    assert.deepEqual(result.summary?.actionItems, []);
    assert.equal(result.summary?.coreClaims[0]?.includes("tesis central"), true);
    assert.equal(result.summary?.evidenceMoments[0]?.includes("conejos con globos"), true);
  } finally {
    restore();
  }
});

test("generateSummary meeting preset uses executive meeting context", async () => {
  const transcript = createTranscriptRecord([
    "Revisamos las prioridades del sprint y los bloqueos pendientes."
  ]);
  const { restore, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Sprint review",
        brief: "Se revisaron prioridades y bloqueos del sprint.",
        keyDecisions: ["Priorizar feature X"],
        actionItems: [{ task: "Desbloquear integración", assignee: "Backend" }],
        sections: []
      })
    }
  ]);

  try {
    await generateSummary(transcript, {}, { preset: "meeting" });
    const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

    assert.equal(prompt.includes("reuniones ejecutivas"), true);
    assert.equal(prompt.includes("tono ejecutivo y narrativo"), true);
  } finally {
    restore();
  }
});

test("generateSummary auto-detects analysisEssay preset when none is provided", async () => {
  const transcript = createTranscriptRecord([
    "Mi punto es que la tecnologia tiende a premiar la conveniencia sobre el criterio.",
    "Por ejemplo, cuando reducimos todo a plantillas, el resultado pierde la tesis humana.",
    "La conclusion es que debemos preservar evidencia y contexto."
  ]);
  const { restore, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        contentType: "analysisEssay",
        headline: "Preservar criterio y evidencia",
        brief: "El contenido plantea una tesis argumentativa sobre criterio y contexto.",
        coreClaims: ["La automatizacion sin criterio aplana el pensamiento."],
        evidenceMoments: ["La reduccion a plantillas debilita la tesis humana."],
        keyDecisions: [],
        actionItems: [],
        sections: []
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript);
    const prompt = requestBodyText(requestBodies()[0]?.body ?? {});

    assert.equal(prompt.includes("contenido argumentativo"), true);
    assert.equal(result.summary?.contentType, "analysisEssay");
  } finally {
    restore();
  }
});

test("generateSummary meeting guardrails promote missing decisions/actions/questions and canonical sections", async () => {
  const transcript = createTranscriptRecord([
    "Decidimos cerrar la etapa actual y hacer handover solo con propuesta formal.",
    "Hay que enviar propuesta economica entre manana y viernes.",
    "Como se va a ejecutar la transicion con el nuevo recurso?"
  ]);

  const { restore } = installFetchSteps([
    {
      payload: JSON.stringify({
        headline: "Cierre de etapa",
        brief: "Se trato la salida del colaborador y una posible transicion.",
        overview:
          "Se decidio no continuar en la empresa. Hay que enviar propuesta economica formal entre manana y viernes. Como se ejecutara la transicion con nuevo recurso?",
        keyDecisions: [],
        actionItems: [],
        openQuestions: [],
        sections: []
      })
    }
  ]);

  try {
    const result = await generateSummary(transcript, {}, { preset: "meeting" });

    assert.equal((result.summary?.keyDecisions.length ?? 0) > 0, true);
    assert.equal((result.summary?.actionItems.length ?? 0) > 0, true);
    assert.equal((result.summary?.openQuestions.length ?? 0) > 0, true);
    assert.equal(result.summary?.sections.some((section) => section.title === "Postura y decisiones"), true);
    assert.equal(result.summary?.sections.some((section) => section.title === "Acuerdos y siguientes pasos"), true);
  } finally {
    restore();
  }
});

test("generateSummary fallback for analysisEssay does not derive action items or follow ups", async () => {
  const transcript = createTranscriptRecord([
    "Mi argumento es que confundimos optimizacion con criterio.",
    "Por ejemplo, el caso del campeon mundial de conejos con globos muestra que la profundidad importa.",
    "La conclusion es que la evidencia concreta sostiene mejor una tesis."
  ]);
  const { restore } = installFetchSteps([{ error: "Ollama HTTP 500: model unavailable" }]);

  try {
    const result = await generateSummary(transcript, {}, { preset: "analysisEssay" });

    assert.equal(result.summary?.contentType, "analysisEssay");
    assert.deepEqual(result.summary?.actionItems, []);
    assert.deepEqual(result.summary?.followUps, []);
    assert.equal((result.summary?.evidenceMoments.length ?? 0) > 0, true);
    assert.equal((result.summary?.coreClaims.length ?? 0) > 0, true);
  } finally {
    restore();
  }
});

test("generateSummary retries once when the first LLM response is invalid JSON", async () => {
  const transcript = createTranscriptRecord([
    "Se revisaron acuerdos, riesgos, tareas y responsables para el siguiente entregable del sprint."
  ]);
  const validPayload = JSON.stringify({
    headline: "Sprint review",
    brief: "Se revisaron acuerdos, riesgos, tareas y responsables para el siguiente entregable del sprint.",
    overview: "El equipo repasó avances, bloqueos y próximos pasos con suficiente detalle operativo.",
    keyDecisions: ["Priorizar feedback de onboarding"],
    actionItems: [{ task: "Investigar ads con WhatsApp", assignee: "Javier" }],
    sections: [{ title: "Avances", summary: "Voice calls y Meta ads avanzaron", bullets: ["Composio limitado"] }]
  });
  const { restore, calls } = installFetchSteps([
    { payload: "Aquí está el resumen:\n```json\n{ broken" },
    { payload: validPayload }
  ]);

  try {
    const result = await generateSummary(transcript);

    assert.equal(calls(), 2);
    assert.equal(result.summaryDiagnostics?.requestCount, 2);
    assert.equal(result.summaryDiagnostics?.usedFallback, false);
    assert.equal(Boolean(result.summary?.brief), true);
  } finally {
    restore();
  }
});

test("generateSummary with force flag bypasses enableSummary config", async () => {
  const transcript = createTranscriptRecord(["Contenido de prueba para forzar resumen."]);
  const originalEnableSummary = config.enableSummary;

  try {
    (config as Record<string, unknown>).enableSummary = false;

    const withoutForce = await generateSummary(transcript);
    assert.equal(withoutForce.summary, undefined);
    assert.equal(withoutForce.warnings.length, 0);

    const { restore, requestBodies } = installFetchSteps([
      {
        payload: JSON.stringify({
          headline: "Forced summary",
          brief: "Resumen forzado con contenido útil.",
          keyDecisions: ["Decisión de prueba"],
          actionItems: [{ task: "Tarea forzada", assignee: "Test" }],
          sections: [{ title: "Sección", summary: "Resumen de sección", bullets: ["Punto 1"] }]
        })
      }
    ]);

    try {
      const withForce = await generateSummary(transcript, {}, { force: true });
      assert.equal(requestBodies().length > 0, true, "Force flag should trigger Ollama call");
      assert.equal(withForce.summaryDiagnostics?.requestCount, 1);
      assert.notEqual(withForce.summary, undefined);
    } finally {
      restore();
    }
  } finally {
    (config as Record<string, unknown>).enableSummary = originalEnableSummary;
  }
});

test("stripSummaryRuntimeWarnings removes prior summary failure warnings", () => {
  const warnings = [
    "Diarization took longer than expected.",
    "AI summary skipped: the LLM provider returned an empty response.",
    "A fallback summary was generated directly from the transcript."
  ];

  assert.deepEqual(stripSummaryRuntimeWarnings(warnings), [
    "Diarization took longer than expected."
  ]);
});
