import { config } from "../config.js";
import { MeetingActionItem, MeetingSummary, MeetingSummarySection, TranscriptRecord } from "../types.js";

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
}

function extractJsonCandidate(response: string): string {
  const fencedMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const trimmed = response.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1).trim();
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1).trim();
  }

  return trimmed;
}

function repairJson(jsonString: string): string {
  return jsonString
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonFromLlmResponse(response: string): Record<string, unknown> {
  const jsonString = extractJsonCandidate(response);

  try {
    return JSON.parse(jsonString) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(repairJson(jsonString)) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to parse LLM response as JSON.");
    }
  }
}

function mapActionItem(item: unknown): MeetingActionItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const source = item as Record<string, unknown>;
  const task = normalizeText(source.task ?? source.todo ?? source.action ?? source.title);
  if (!task) {
    return null;
  }

  const assignee = normalizeText(source.assignee ?? source.owner ?? source.person);
  const deadline = normalizeText(source.deadline ?? source.dueDate ?? source.date);
  const priority = normalizeText(source.priority);
  const status = normalizeText(source.status);
  const notes = normalizeText(source.notes ?? source.context ?? source.detail);

  return {
    task,
    assignee: assignee || undefined,
    deadline: deadline || undefined,
    priority: priority || undefined,
    status: status || undefined,
    notes: notes || undefined
  };
}

function mapSummarySection(item: unknown): MeetingSummarySection | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const source = item as Record<string, unknown>;
  const title = normalizeText(source.title ?? source.heading ?? source.name);
  if (!title) {
    return null;
  }

  const summary = normalizeText(source.summary ?? source.description ?? source.text);
  const bullets = safeStringArray(source.bullets ?? source.items ?? source.points);
  const priority = normalizeText(source.priority);

  return {
    title,
    summary,
    bullets,
    priority: priority || undefined
  };
}

function deriveNarrative(summary: {
  brief: string;
  overview: string;
  sections: MeetingSummarySection[];
}): string | undefined {
  if (summary.overview) {
    return summary.overview;
  }

  if (summary.sections.length === 0) {
    return summary.brief || undefined;
  }

  const blocks = summary.sections
    .map((section) => {
      const parts = [section.title];
      if (section.summary) {
        parts.push(section.summary);
      }
      if (section.bullets.length > 0) {
        parts.push(section.bullets.join(" "));
      }
      return parts.join(": ");
    })
    .filter(Boolean);

  return blocks.join("\n\n") || undefined;
}

function deriveFallbackSections(summary: {
  sections: MeetingSummarySection[];
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  operationalNotes: string[];
  openQuestions: string[];
}): MeetingSummarySection[] {
  if (summary.sections.length > 0) {
    return summary.sections;
  }

  const derived: MeetingSummarySection[] = [];

  if (summary.keyDecisions.length > 0) {
    derived.push({
      title: "Decisiones clave",
      summary: "",
      bullets: summary.keyDecisions
    });
  }

  if (summary.actionItems.length > 0) {
    derived.push({
      title: "Tareas y pendientes",
      summary: "",
      bullets: summary.actionItems.map((item) => {
        const meta = [item.assignee, item.deadline].filter(Boolean).join(" · ");
        return meta ? `${item.task} (${meta})` : item.task;
      })
    });
  }

  if (summary.operationalNotes.length > 0) {
    derived.push({
      title: "Notas operativas",
      summary: "",
      bullets: summary.operationalNotes
    });
  }

  if (summary.openQuestions.length > 0) {
    derived.push({
      title: "Temas por aclarar",
      summary: "",
      bullets: summary.openQuestions
    });
  }

  return derived;
}

function buildSummaryWarning(errorMessage: string): string {
  if (errorMessage.includes("fetch failed") || errorMessage.includes("ECONNREFUSED")) {
    return `AI summary skipped: Could not reach local Ollama (${errorMessage}). Ensure Ollama is installed, running, and reachable at ${config.ollamaBaseUrl}.`;
  }

  if (errorMessage.includes("Ollama HTTP")) {
    return `AI summary skipped: Ollama returned an error (${errorMessage}). Check that model ${config.ollamaModel} is installed and the request fits the model context window.`;
  }

  if (errorMessage.includes("parse LLM response as JSON")) {
    return "AI summary skipped: Ollama responded, but the model output was not valid JSON. Try the request again or use a more instruction-following Ollama model.";
  }

  return `AI summary skipped: Summary generation failed (${errorMessage}).`;
}

function buildSummary(parsed: Record<string, unknown>): MeetingSummary {
  const rawActionItems = [
    ...(Array.isArray(parsed.actionItems) ? parsed.actionItems : []),
    ...(Array.isArray(parsed.tasks) ? parsed.tasks : []),
    ...(Array.isArray(parsed.todos) ? parsed.todos : []),
    ...(Array.isArray(parsed.toDos) ? parsed.toDos : [])
  ];
  const actionItems = rawActionItems.map(mapActionItem).filter((item): item is MeetingActionItem => Boolean(item));
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map(mapSummarySection)
    .filter((item): item is MeetingSummarySection => Boolean(item));
  const keyDecisions = safeStringArray(parsed.keyDecisions ?? parsed.decisions);
  const followUps = safeStringArray(parsed.followUps ?? parsed.nextSteps);
  const risks = safeStringArray(parsed.risks ?? parsed.blockers);
  const operationalNotes = safeStringArray(parsed.operationalNotes ?? parsed.notes ?? parsed.logistics);
  const openQuestions = safeStringArray(parsed.openQuestions ?? parsed.questions);
  const overview = normalizeText(parsed.overview ?? parsed.detailedSummary ?? parsed.summary);
  const brief = normalizeText(parsed.brief ?? parsed.executiveSummary ?? parsed.shortSummary) || "No brief generated.";

  const summary: MeetingSummary = {
    headline: normalizeText(parsed.headline ?? parsed.title) || undefined,
    brief,
    overview: overview || undefined,
    narrative: undefined,
    keyDecisions,
    actionItems,
    topics: safeStringArray(parsed.topics ?? parsed.tags),
    sections,
    followUps,
    risks,
    operationalNotes,
    openQuestions
  };

  summary.sections = deriveFallbackSections(summary);
  summary.narrative = deriveNarrative({
    brief: summary.brief,
    overview: summary.overview ?? "",
    sections: summary.sections
  });

  return summary;
}

function buildPrompt(transcriptText: string): string {
  return `Eres un asistente experto en reuniones ejecutivas. Analiza la transcripción y devuelve SOLO un objeto JSON válido.

Objetivo:
- Redacta un resumen claro y útil para operación real, con el tono de un recap ejecutivo bien aterrizado.
- Si la transcripción está en español, responde en español natural.
- Detecta prioridades, acuerdos, decisiones, pendientes, tareas, avisos, bloqueos, riesgos y dudas abiertas.
- Convierte tareas o todos implícitos en actionItems concretos.
- Usa secciones narrativas similares a un resumen ejecutivo detallado, con títulos específicos como "Prioridad absoluta: estabilizar el MVP" cuando aplique.

Devuelve exactamente este esquema JSON:
{
  "headline": "Frase breve con el hallazgo o prioridad dominante",
  "brief": "Resumen ejecutivo de 2 a 4 oraciones",
  "overview": "Resumen detallado en uno o varios párrafos",
  "topics": ["tema 1", "tema 2"],
  "sections": [
    {
      "title": "Título de la sección",
      "summary": "Párrafo corto que explique el bloque",
      "bullets": ["punto 1", "punto 2"],
      "priority": "alta | media | baja"
    }
  ],
  "keyDecisions": ["decisión 1", "decisión 2"],
  "actionItems": [
    {
      "task": "acción concreta",
      "assignee": "persona responsable si existe",
      "deadline": "fecha o momento si existe",
      "priority": "alta | media | baja",
      "status": "pendiente | en curso | bloqueado",
      "notes": "contexto corto"
    }
  ],
  "followUps": ["seguimiento 1"],
  "risks": ["riesgo o bloqueo 1"],
  "operationalNotes": ["nota operativa, aviso, ausencia o acuerdo de trabajo"],
  "openQuestions": ["pregunta o tema pendiente por aclarar"]
}

Reglas:
1. No escribas markdown, encabezados sueltos ni texto fuera del JSON.
2. Usa arrays vacíos cuando falte información.
3. Mantén nombres propios, roles y acuerdos lo más específicos posible.
4. Si hay prioridades claras, refléjalas tanto en headline como en sections/actionItems.
5. Si aparecen acuerdos sobre proceso, comunicación, QA, diseño o coordinación, inclúyelos en sections u operationalNotes.
6. Si una tarea solo es implícita pero claramente acordada, inclúyela como actionItem.
7. Cuando existan avisos logísticos, ausencias o restricciones de disponibilidad, inclúyelos en operationalNotes.

Transcripción:
${transcriptText}`;
}

export async function generateSummary(
  record: TranscriptRecord,
  callbacks: {
    onLog?: (line: string) => void;
    onProgress?: (stagePct: number) => void;
  } = {}
): Promise<{ warnings: string[]; summary?: MeetingSummary }> {
  if (!config.enableSummary) {
    return { warnings: [] };
  }

  const variantToSummarize = record.source;
  const transcriptText = variantToSummarize.segments
    .map((segment) => {
      const speaker = segment.speaker ? `[${segment.speaker}] ` : "";
      return `${speaker}[${formatTimestamp(segment.start)}] ${segment.text}`.trim();
    })
    .join("\n");

  if (!transcriptText.trim()) {
    return { warnings: ["Skipped summarization: transcript is empty."] };
  }

  try {
    callbacks.onLog?.(`Calling local Ollama LLM (${config.ollamaModel}) at ${config.ollamaBaseUrl}...`);
    callbacks.onLog?.(`Summarizing ${variantToSummarize.segments.length} transcript segments.`);
    callbacks.onProgress?.(10);

    const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: buildPrompt(transcriptText),
        stream: false,
        options: {
          temperature: 0.15
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    callbacks.onProgress?.(80);
    const data = await response.json();
    callbacks.onProgress?.(90);

    if (typeof data?.response !== "string" || !data.response.trim()) {
      throw new Error("Ollama returned an empty response body.");
    }

    const summary = buildSummary(parseJsonFromLlmResponse(data.response));

    callbacks.onProgress?.(100);
    callbacks.onLog?.("Meeting summary generated successfully.");
    return { warnings: [], summary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    callbacks.onLog?.(`Summarization failed: ${errorMessage}`);

    return {
      warnings: [buildSummaryWarning(errorMessage)]
    };
  }
}
