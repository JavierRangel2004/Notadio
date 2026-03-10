import { config } from "../config.js";
import {
  MeetingActionItem,
  MeetingSummary,
  MeetingSummarySection,
  SummaryChunkDiagnostic,
  SummaryDiagnostics,
  TranscriptRecord
} from "../types.js";

const SUMMARY_PLACEHOLDER_BRIEF = "No brief generated.";
const SUMMARY_FALLBACK_WARNING = "AI summary lacked usable content; generated a transcript-based fallback summary.";
const SUMMARY_STOPWORDS = new Set([
  "a",
  "al",
  "algo",
  "all",
  "and",
  "ante",
  "as",
  "at",
  "aun",
  "aunque",
  "con",
  "como",
  "de",
  "del",
  "desde",
  "donde",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "entre",
  "era",
  "es",
  "esa",
  "ese",
  "eso",
  "esta",
  "este",
  "esto",
  "for",
  "fue",
  "ha",
  "hay",
  "in",
  "la",
  "las",
  "lo",
  "los",
  "más",
  "mas",
  "muy",
  "no",
  "nos",
  "o",
  "para",
  "pero",
  "por",
  "que",
  "qué",
  "se",
  "si",
  "sí",
  "sin",
  "sobre",
  "su",
  "sus",
  "the",
  "to",
  "un",
  "una",
  "uno",
  "y",
  "ya"
]);
type SummaryInputBlock = {
  start: number;
  end: number;
  speaker?: string;
  text: string;
};

type SummaryRequestResult = {
  payload: Record<string, unknown>;
  durationMs: number;
  startedAt: string;
  completedAt: string;
};

type SummaryChunkResult = {
  partial?: MeetingSummary;
  diagnostic: SummaryChunkDiagnostic;
};

type SummaryGenerationResult = {
  warnings: string[];
  summary?: MeetingSummary;
  summaryDiagnostics?: SummaryDiagnostics;
};

type SummaryRuntimeConfig = {
  directCharLimit: number;
  chunkCharLimit: number;
  maxInputChars: number;
  blockMaxChars: number;
};

function getSummaryRuntimeConfig(): SummaryRuntimeConfig {
  const directCharLimit = Math.max(2000, config.summaryDirectCharLimit);
  const chunkCharLimit = Math.max(1000, Math.min(config.summaryChunkCharLimit, directCharLimit));
  const maxInputChars = Math.max(directCharLimit, config.summaryMaxInputChars);
  const blockMaxChars = Math.max(120, Math.min(config.summaryBlockMaxChars, chunkCharLimit));

  return {
    directCharLimit,
    chunkCharLimit,
    maxInputChars,
    blockMaxChars
  };
}

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

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 1 : 2)}s`;
}

function summarizeToSentences(value: string, maxSentences = 2): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+/g) ?? [normalized];
  return normalizeText(sentences.slice(0, maxSentences).join(" "));
}

function normalizeTokenSource(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeTokenSource(value)
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 2 && !SUMMARY_STOPWORDS.has(token)) ?? [];
}

function mergeTranscriptIntoBlocks(record: TranscriptRecord, runtimeConfig: SummaryRuntimeConfig): SummaryInputBlock[] {
  const blocks: SummaryInputBlock[] = [];

  for (const segment of record.source.segments) {
    const text = normalizeText(segment.text);
    if (!text) {
      continue;
    }

    const previous = blocks.at(-1);
    const canMerge =
      previous &&
      previous.speaker === segment.speaker &&
      segment.start - previous.end <= 2.5 &&
      previous.text.length + text.length + 1 <= runtimeConfig.blockMaxChars;

    if (canMerge) {
      previous.end = segment.end;
      previous.text = `${previous.text} ${text}`.trim();
      continue;
    }

    blocks.push({
      start: segment.start,
      end: segment.end,
      speaker: segment.speaker,
      text
    });
  }

  return blocks;
}

function renderSummaryInputBlock(block: SummaryInputBlock): string {
  const speaker = block.speaker ? `${block.speaker} ` : "";
  return `[${formatTimestamp(block.start)}-${formatTimestamp(block.end)}] ${speaker}${block.text}`.trim();
}

function selectSummaryInputLines(lines: string[], maxChars: number): string[] {
  const totalChars = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (totalChars <= maxChars) {
    return lines;
  }

  let targetCount = Math.max(8, Math.min(lines.length, Math.floor(maxChars / 220)));

  while (targetCount > 1) {
    const selected: string[] = [];
    const seen = new Set<number>();

    for (let index = 0; index < targetCount; index += 1) {
      const ratio = targetCount === 1 ? 0 : index / (targetCount - 1);
      const lineIndex = Math.round(ratio * (lines.length - 1));
      if (seen.has(lineIndex)) {
        continue;
      }
      seen.add(lineIndex);
      selected.push(lines[lineIndex]);
    }

    const selectedChars = selected.reduce((sum, line) => sum + line.length + 1, 0);
    if (selectedChars <= maxChars) {
      return selected;
    }

    targetCount -= 1;
  }

  return [compactText(lines[0], maxChars)];
}

function buildTranscriptTextForSummary(record: TranscriptRecord, runtimeConfig: SummaryRuntimeConfig): {
  text: string;
  blockCount: number;
  sampled: boolean;
} {
  const lines = mergeTranscriptIntoBlocks(record, runtimeConfig).map(renderSummaryInputBlock);
  const selectedLines = selectSummaryInputLines(lines, runtimeConfig.maxInputChars);

  return {
    text: selectedLines.join("\n"),
    blockCount: selectedLines.length,
    sampled: selectedLines.length !== lines.length
  };
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

function deriveBrief(summary: {
  overview: string;
  sections: MeetingSummarySection[];
}): string | undefined {
  const overviewBrief = summarizeToSentences(summary.overview);
  if (overviewBrief) {
    return overviewBrief;
  }

  for (const section of summary.sections) {
    const sectionBrief = summarizeToSentences(section.summary, 1);
    if (sectionBrief) {
      return sectionBrief;
    }
  }

  return undefined;
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

  if (errorMessage.includes("empty structured summary")) {
    return "AI summary skipped: Ollama returned JSON without a usable brief, overview, sections, decisions, or action items. Try again or switch to a larger local model.";
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
  const brief =
    normalizeText(parsed.brief ?? parsed.executiveSummary ?? parsed.shortSummary) ||
    deriveBrief({ overview, sections }) ||
    SUMMARY_PLACEHOLDER_BRIEF;

  const summary: MeetingSummary = {
    headline:
      normalizeText(parsed.headline ?? parsed.title) ||
      sections[0]?.title ||
      keyDecisions[0] ||
      risks[0] ||
      undefined,
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

function isPlaceholderBrief(value: string): boolean {
  return normalizeText(value) === SUMMARY_PLACEHOLDER_BRIEF;
}

function hasMeaningfulSummaryContent(summary: MeetingSummary): boolean {
  const narrativeFields = [summary.headline, summary.brief, summary.overview, summary.narrative]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const narrativeLength = narrativeFields.join(" ").length;
  const structuredItems =
    summary.sections.length +
    summary.keyDecisions.length +
    summary.actionItems.length +
    summary.followUps.length +
    summary.risks.length +
    summary.operationalNotes.length +
    summary.openQuestions.length;

  if (!isPlaceholderBrief(summary.brief) && normalizeText(summary.brief).length >= 40) {
    return true;
  }

  return narrativeLength >= 120 || structuredItems >= 3;
}

function uniqueHighlights(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => compactText(normalizeText(value), 220)).filter(Boolean))].slice(0, limit);
}

function extractHighlights(record: TranscriptRecord, terms: string[], limit: number): string[] {
  const highlights = record.source.segments
    .map((segment) => normalizeText(segment.text))
    .filter((text) => {
      const normalized = normalizeTokenSource(text);
      return terms.some((term) => normalized.includes(term));
    });
  return uniqueHighlights(highlights, limit);
}

function buildFallbackSummary(record: TranscriptRecord): MeetingSummary {
  const segments = record.source.segments
    .map((segment) => ({
      ...segment,
      normalizedText: normalizeText(segment.text)
    }))
    .filter((segment) => segment.normalizedText.length >= 24);

  if (segments.length === 0) {
    return {
      brief: "Transcript available, but there was not enough content to build a fallback summary.",
      overview: undefined,
      narrative: "Transcript available, but there was not enough content to build a fallback summary.",
      keyDecisions: [],
      actionItems: [],
      topics: [],
      sections: [],
      followUps: [],
      risks: [],
      operationalNotes: [],
      openQuestions: []
    };
  }

  const frequencies = new Map<string, number>();
  for (const segment of segments) {
    for (const token of tokenize(segment.normalizedText)) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }

  const totalDuration = record.durationSeconds ?? segments.at(-1)?.end ?? 0;
  const minGapSeconds = Math.max(45, totalDuration / 8);
  const ranked = segments
    .map((segment) => {
      const tokens = tokenize(segment.normalizedText);
      const tokenScore = tokens.reduce((sum, token) => sum + (frequencies.get(token) ?? 0), 0);
      const density = tokens.length > 0 ? tokenScore / tokens.length : 0;
      return {
        ...segment,
        score: density + Math.min(segment.normalizedText.length / 180, 1)
      };
    })
    .sort((left, right) => right.score - left.score);

  const selected = ranked.reduce<typeof ranked>((accumulator, candidate) => {
    if (accumulator.length >= 6) {
      return accumulator;
    }

    const isTooClose = accumulator.some((item) => Math.abs(item.start - candidate.start) < minGapSeconds);
    if (!isTooClose) {
      accumulator.push(candidate);
    }
    return accumulator;
  }, []);

  if (selected.length === 0) {
    selected.push(...ranked.slice(0, Math.min(3, ranked.length)));
  }

  selected.sort((left, right) => left.start - right.start);

  const highlightTexts = selected.map((segment) => compactText(segment.normalizedText, 220));
  const brief = compactText(highlightTexts.slice(0, 3).join(" "), 420);
  const overview = highlightTexts.join(" ");
  const speakerCount = new Set(record.source.segments.map((segment) => segment.speaker).filter(Boolean)).size;
  const keyDecisions = extractHighlights(record, ["decid", "acord", "conclu", "defin"], 4);
  const risks = extractHighlights(record, ["riesg", "bloque", "proble", "error", "fall", "amenaz"], 4);
  const openQuestions = uniqueHighlights(
    record.source.segments
      .map((segment) => normalizeText(segment.text))
      .filter((text) => text.includes("?") || normalizeTokenSource(text).includes("pregunta")),
    4
  );
  const actionItems = extractHighlights(record, ["pendient", "tarea", "hay que", "debe", "falta", "seguim"], 5).map((task) => ({
    task
  }));

  const operationalNotes = uniqueHighlights(
    [
      record.detectedLanguage ? `Idioma detectado: ${record.detectedLanguage}.` : "",
      totalDuration > 0 ? `Duración procesada: ${formatTimestamp(totalDuration)}.` : "",
      speakerCount > 0 ? `Identificación de hablantes: ${speakerCount} voces detectadas.` : ""
    ],
    3
  );

  return {
    headline: compactText(highlightTexts[0] ?? "Resumen extractivo de la transcripción", 110),
    brief,
    overview,
    narrative: overview,
    keyDecisions,
    actionItems,
    topics: [],
    sections: [
      {
        title: "Puntos destacados",
        summary: brief,
        bullets: highlightTexts
      }
    ],
    followUps: actionItems.map((item) => item.task).slice(0, 3),
    risks,
    operationalNotes,
    openQuestions
  };
}

function dedupeBy<T>(items: T[], makeKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = normalizeText(makeKey(item)).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function mergePartialSummaries(partials: MeetingSummary[]): MeetingSummary {
  const sections = dedupeBy(
    partials.flatMap((summary) => summary.sections),
    (section) => `${section.title} ${section.summary} ${section.bullets.join(" ")}`
  );
  const actionItems = dedupeBy(
    partials.flatMap((summary) => summary.actionItems),
    (item) => `${item.task} ${item.assignee ?? ""} ${item.deadline ?? ""}`
  );
  const keyDecisions = safeStringArray(partials.flatMap((summary) => summary.keyDecisions));
  const followUps = safeStringArray(partials.flatMap((summary) => summary.followUps));
  const risks = safeStringArray(partials.flatMap((summary) => summary.risks));
  const operationalNotes = safeStringArray(partials.flatMap((summary) => summary.operationalNotes));
  const openQuestions = safeStringArray(partials.flatMap((summary) => summary.openQuestions));
  const topics = safeStringArray(partials.flatMap((summary) => summary.topics));
  const overview = partials
    .map((summary) => normalizeText(summary.overview ?? summary.narrative ?? ""))
    .filter(Boolean)
    .join("\n\n");
  const brief =
    partials
      .map((summary) => normalizeText(summary.brief))
      .find((value) => value && !isPlaceholderBrief(value)) ||
    deriveBrief({ overview, sections }) ||
    SUMMARY_PLACEHOLDER_BRIEF;

  const merged: MeetingSummary = {
    headline:
      partials.map((summary) => normalizeText(summary.headline)).find(Boolean) ||
      sections[0]?.title ||
      keyDecisions[0] ||
      risks[0] ||
      undefined,
    brief,
    overview: overview || undefined,
    narrative: undefined,
    keyDecisions,
    actionItems,
    topics,
    sections,
    followUps,
    risks,
    operationalNotes,
    openQuestions
  };

  merged.sections = deriveFallbackSections(merged);
  merged.narrative = deriveNarrative({
    brief: merged.brief,
    overview: merged.overview ?? "",
    sections: merged.sections
  });

  return merged;
}

function chunkTranscriptText(transcriptText: string, maxChars: number): string[] {
  const lines = transcriptText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const nextLength = currentLength === 0 ? line.length : currentLength + 1 + line.length;
    if (currentLines.length > 0 && nextLength > maxChars) {
      chunks.push(currentLines.join("\n"));
      currentLines = [line];
      currentLength = line.length;
      continue;
    }

    currentLines.push(line);
    currentLength = nextLength;
  }

  if (currentLines.length > 0) {
    chunks.push(currentLines.join("\n"));
  }

  return chunks;
}

function buildSchemaInstructions(): string {
  return `Devuelve exactamente este esquema JSON:
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
}`;
}

function buildChunkPrompt(transcriptText: string, chunkIndex: number, totalChunks: number): string {
  return `Eres un asistente experto en reuniones ejecutivas. Analiza SOLO este fragmento ${chunkIndex} de ${totalChunks} de una transcripción más larga y devuelve SOLO un objeto JSON válido.

Objetivo:
- Resume únicamente la información presente en este fragmento.
- Conserva decisiones, tareas, riesgos, avisos y preguntas aunque todavía estén incompletos.
- Si un hallazgo parece tentativo o parcial, exprésalo como tal.

${buildSchemaInstructions()}

Reglas:
1. No inventes datos de otros fragmentos.
2. No escribas markdown ni texto fuera del JSON.
3. Usa arrays vacíos cuando falte información.
4. Mantén nombres propios, roles y citas clave lo más específicos posible.

Fragmento ${chunkIndex}/${totalChunks}:
${transcriptText}`;
}

function compactSectionForReduce(section: MeetingSummarySection): MeetingSummarySection {
  return {
    ...section,
    title: compactText(section.title, 120),
    summary: compactText(section.summary, 260),
    bullets: section.bullets.slice(0, 4).map((bullet) => compactText(bullet, 140))
  };
}

function compactSummaryForReduce(summary: MeetingSummary): Record<string, unknown> {
  return {
    headline: compactText(normalizeText(summary.headline), 140),
    brief: compactText(normalizeText(summary.brief), 320),
    overview: compactText(normalizeText(summary.overview ?? summary.narrative ?? ""), 520),
    sections: summary.sections.slice(0, 4).map(compactSectionForReduce),
    keyDecisions: summary.keyDecisions.slice(0, 6).map((item) => compactText(item, 160)),
    actionItems: summary.actionItems.slice(0, 6).map((item) => ({
      task: compactText(item.task, 160),
      assignee: compactText(normalizeText(item.assignee), 80),
      deadline: compactText(normalizeText(item.deadline), 80),
      priority: compactText(normalizeText(item.priority), 24),
      status: compactText(normalizeText(item.status), 24),
      notes: compactText(normalizeText(item.notes), 120)
    })),
    followUps: summary.followUps.slice(0, 5).map((item) => compactText(item, 140)),
    risks: summary.risks.slice(0, 5).map((item) => compactText(item, 140)),
    operationalNotes: summary.operationalNotes.slice(0, 4).map((item) => compactText(item, 140)),
    openQuestions: summary.openQuestions.slice(0, 4).map((item) => compactText(item, 140))
  };
}

function buildReducePrompt(partials: MeetingSummary[]): string {
  const serializedPartials = partials
    .map((summary, index) => `Fragmento ${index + 1}:\n${JSON.stringify(compactSummaryForReduce(summary), null, 2)}`)
    .join("\n\n");

  return `Eres un asistente experto en reuniones ejecutivas. Combina estos resúmenes parciales en un SOLO resumen ejecutivo consolidado y devuelve SOLO un objeto JSON válido.

Objetivo:
- Fusiona la información repetida sin perder decisiones, riesgos, preguntas y tareas concretas.
- Prioriza el hallazgo o problema dominante en "headline" y "brief".
- Si varios fragmentos aportan contexto, intégralos en "overview" y "sections".

${buildSchemaInstructions()}

Reglas:
1. No escribas markdown ni texto fuera del JSON.
2. Deduplica decisiones, tareas y riesgos repetidos.
3. Mantén el tono ejecutivo y accionable.

Resúmenes parciales:
${serializedPartials}`;
}

async function requestStructuredSummary(prompt: string): Promise<Record<string, unknown>> {
  const options: Record<string, number> = {
    temperature: 0.15
  };

  if (config.summaryOllamaNumPredict !== undefined) {
    options.num_predict = config.summaryOllamaNumPredict;
  }

  if (config.summaryOllamaNumCtx !== undefined) {
    options.num_ctx = config.summaryOllamaNumCtx;
  }

  const payload: Record<string, unknown> = {
    model: config.ollamaModel,
    prompt,
    format: "json",
    stream: false,
    options
  };

  if (config.summaryOllamaKeepAlive) {
    payload.keep_alive = config.summaryOllamaKeepAlive;
  }

  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (typeof data?.response !== "string" || !data.response.trim()) {
    throw new Error("Ollama returned an empty response body.");
  }

  return parseJsonFromLlmResponse(data.response);
}

async function requestStructuredSummaryTimed(prompt: string): Promise<SummaryRequestResult> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const payload = await requestStructuredSummary(prompt);
  const completedAt = Date.now();

  return {
    payload,
    durationMs: completedAt - startedAt,
    startedAt: startedAtIso,
    completedAt: new Date(completedAt).toISOString()
  };
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function buildPrompt(transcriptText: string): string {
  return `Eres un asistente experto en reuniones ejecutivas. Analiza la transcripción y devuelve SOLO un objeto JSON válido.

Objetivo:
- Redacta un resumen claro y útil para operación real, con el tono de un recap ejecutivo bien aterrizado.
- Si la transcripción está en español, responde en español natural.
- Detecta prioridades, acuerdos, decisiones, pendientes, tareas, avisos, bloqueos, riesgos y dudas abiertas.
- Convierte tareas o todos implícitos en actionItems concretos.
- Usa secciones narrativas similares a un resumen ejecutivo detallado, con títulos específicos como "Prioridad absoluta: estabilizar el MVP" cuando aplique.

${buildSchemaInstructions()}

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
): Promise<SummaryGenerationResult> {
  if (!config.enableSummary) {
    return { warnings: [] };
  }

  const runtimeConfig = getSummaryRuntimeConfig();
  const variantToSummarize = record.source;
  const summaryInput = buildTranscriptTextForSummary(record, runtimeConfig);
  const transcriptText = summaryInput.text;

  if (!transcriptText.trim()) {
    return { warnings: ["Skipped summarization: transcript is empty."] };
  }

  const startedAt = Date.now();
  const diagnostics: SummaryDiagnostics = {
    model: config.ollamaModel,
    mode: "direct",
    inputChars: transcriptText.length,
    transcriptBlocks: summaryInput.blockCount,
    sampled: summaryInput.sampled,
    chunkCount: 1,
    chunkConcurrency: 1,
    requestCount: 0,
    partialCount: 0,
    skippedChunkCount: 0,
    failedChunkCount: 0,
    totalDurationMs: 0,
    usedReduce: false,
    usedMergedPartials: false,
    usedFallback: false,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(startedAt).toISOString(),
    chunks: []
  };

  function finalizeDiagnostics(): SummaryDiagnostics {
    const completedAt = Date.now();

    diagnostics.totalDurationMs = completedAt - startedAt;
    diagnostics.completedAt = new Date(completedAt).toISOString();
    diagnostics.chunks.sort((left, right) => left.chunkIndex - right.chunkIndex);

    return {
      ...diagnostics,
      chunks: [...diagnostics.chunks]
    };
  }

  try {
    callbacks.onLog?.(`Calling local Ollama LLM (${config.ollamaModel}) at ${config.ollamaBaseUrl}...`);
    callbacks.onLog?.(
      `Summarizing ${variantToSummarize.segments.length} transcript segments across ${summaryInput.blockCount} transcript blocks${summaryInput.sampled ? " (sampled)" : ""}.`
    );
    callbacks.onLog?.(
      `[summary-metrics] prompt limits: direct=${runtimeConfig.directCharLimit} chars, chunk=${runtimeConfig.chunkCharLimit} chars, max-input=${runtimeConfig.maxInputChars} chars.`
    );
    callbacks.onProgress?.(10);

    const chunkLimit =
      transcriptText.length > runtimeConfig.directCharLimit
        ? runtimeConfig.chunkCharLimit
        : runtimeConfig.directCharLimit;
    const transcriptChunks = chunkTranscriptText(transcriptText, chunkLimit);
    diagnostics.mode = transcriptChunks.length <= 1 ? "direct" : "chunked";
    diagnostics.chunkCount = Math.max(1, transcriptChunks.length);
    diagnostics.chunkConcurrency =
      transcriptChunks.length <= 1 ? 1 : Math.min(config.summaryChunkConcurrency, transcriptChunks.length);

    let summary: MeetingSummary;
    if (transcriptChunks.length <= 1) {
      callbacks.onProgress?.(80);
      const directRequest = await requestStructuredSummaryTimed(buildPrompt(transcriptText));
      diagnostics.requestCount = 1;
      diagnostics.directDurationMs = directRequest.durationMs;
      callbacks.onLog?.(`[summary-metrics] direct summary request completed in ${formatDurationMs(directRequest.durationMs)}.`);
      summary = buildSummary(directRequest.payload);
      diagnostics.partialCount = 1;
      diagnostics.chunks = [
        {
          chunkIndex: 1,
          inputChars: transcriptText.length,
          durationMs: directRequest.durationMs,
          status: "completed",
          startedAt: directRequest.startedAt,
          completedAt: directRequest.completedAt,
          summarySections: summary.sections.length,
          actionItems: summary.actionItems.length
        }
      ];
      callbacks.onProgress?.(90);
    } else {
      callbacks.onLog?.(
        `Transcript is large; summarizing in ${transcriptChunks.length} chunks with concurrency ${diagnostics.chunkConcurrency}.`
      );
      callbacks.onLog?.(
        `[summary-metrics] chunked mode enabled. Final reduce runs only when at least ${config.summaryReduceMinPartials} chunk summaries succeed.`
      );

      let completedChunks = 0;
      const chunkResults = await mapWithConcurrency(transcriptChunks, diagnostics.chunkConcurrency, async (chunk, index) => {
        callbacks.onLog?.(`Summarizing chunk ${index + 1}/${transcriptChunks.length}...`);
        const chunkStartedAt = Date.now();

        try {
          const request = await requestStructuredSummaryTimed(buildChunkPrompt(chunk, index + 1, transcriptChunks.length));
          const partial = buildSummary(request.payload);
          const diagnostic: SummaryChunkDiagnostic = {
            chunkIndex: index + 1,
            inputChars: chunk.length,
            durationMs: request.durationMs,
            status: hasMeaningfulSummaryContent(partial) ? "completed" : "skipped",
            startedAt: request.startedAt,
            completedAt: request.completedAt,
            summarySections: partial.sections.length,
            actionItems: partial.actionItems.length
          };

          if (diagnostic.status === "skipped") {
            callbacks.onLog?.(`Chunk ${index + 1}/${transcriptChunks.length} returned sparse JSON and was skipped.`);
          }

          callbacks.onLog?.(
            `[summary-metrics] chunk ${index + 1}/${transcriptChunks.length} ${diagnostic.status} in ${formatDurationMs(request.durationMs)}.`
          );

          return {
            partial: diagnostic.status === "completed" ? partial : undefined,
            diagnostic
          } satisfies SummaryChunkResult;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          callbacks.onLog?.(`Chunk ${index + 1}/${transcriptChunks.length} summary failed: ${errorMessage}`);
          const completedAt = Date.now();
          callbacks.onLog?.(
            `[summary-metrics] chunk ${index + 1}/${transcriptChunks.length} failed in ${formatDurationMs(completedAt - chunkStartedAt)}.`
          );
          return {
            diagnostic: {
              chunkIndex: index + 1,
              inputChars: chunk.length,
              durationMs: completedAt - chunkStartedAt,
              status: "failed",
              startedAt: new Date(chunkStartedAt).toISOString(),
              completedAt: new Date(completedAt).toISOString(),
              summarySections: 0,
              actionItems: 0,
              error: errorMessage
            }
          } satisfies SummaryChunkResult;
        } finally {
          completedChunks += 1;
          callbacks.onProgress?.(15 + Math.round((completedChunks / transcriptChunks.length) * 60));
        }
      });

      diagnostics.requestCount = chunkResults.length;
      diagnostics.chunks = chunkResults.map((result) => result.diagnostic);
      diagnostics.partialCount = chunkResults.filter((result) => Boolean(result.partial)).length;
      diagnostics.skippedChunkCount = chunkResults.filter((result) => result.diagnostic.status === "skipped").length;
      diagnostics.failedChunkCount = chunkResults.filter((result) => result.diagnostic.status === "failed").length;
      callbacks.onLog?.(
        `[summary-metrics] chunk requests finished: ${diagnostics.partialCount} usable, ${diagnostics.skippedChunkCount} skipped, ${diagnostics.failedChunkCount} failed.`
      );

      const partials = chunkResults
        .map((result) => result.partial)
        .filter((partial): partial is MeetingSummary => Boolean(partial));
      const chunkErrors = chunkResults
        .map((result) => result.diagnostic.error)
        .filter((error): error is string => Boolean(error));

      if (partials.length === 0) {
        throw new Error(chunkErrors[0] ?? "Ollama returned an empty structured summary for every chunk.");
      }

      if (partials.length === 1) {
        callbacks.onLog?.("[summary-metrics] final reduce skipped because only one chunk summary was usable.");
        summary = partials[0];
      } else if (partials.length < config.summaryReduceMinPartials) {
        diagnostics.usedMergedPartials = true;
        callbacks.onLog?.(
          `[summary-metrics] final reduce skipped for ${partials.length} partial summaries; merging locally instead.`
        );
        const mergeStartedAt = Date.now();
        summary = mergePartialSummaries(partials);
        diagnostics.mergeDurationMs = Date.now() - mergeStartedAt;
      } else {
        callbacks.onLog?.(`Combining ${partials.length} chunk summaries into one final recap...`);
        callbacks.onProgress?.(82);
        diagnostics.requestCount += 1;
        try {
          const reduceRequest = await requestStructuredSummaryTimed(buildReducePrompt(partials));
          diagnostics.usedReduce = true;
          diagnostics.reduceDurationMs = reduceRequest.durationMs;
          callbacks.onLog?.(
            `[summary-metrics] final reduce completed in ${formatDurationMs(reduceRequest.durationMs)}.`
          );

          const reduced = buildSummary(reduceRequest.payload);
          if (hasMeaningfulSummaryContent(reduced)) {
            summary = reduced;
          } else {
            diagnostics.usedMergedPartials = true;
            callbacks.onLog?.("[summary-metrics] final reduce returned sparse JSON. Falling back to merged chunk summaries.");
            const mergeStartedAt = Date.now();
            summary = mergePartialSummaries(partials);
            diagnostics.mergeDurationMs = Date.now() - mergeStartedAt;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          callbacks.onLog?.(`Final summary consolidation failed: ${errorMessage}. Falling back to merged chunk summaries.`);
          diagnostics.usedMergedPartials = true;
          const mergeStartedAt = Date.now();
          summary = mergePartialSummaries(partials);
          diagnostics.mergeDurationMs = Date.now() - mergeStartedAt;
        }
      }

      callbacks.onProgress?.(90);
    }

    if (!hasMeaningfulSummaryContent(summary)) {
      callbacks.onLog?.("LLM summary response was valid JSON but too sparse. Building transcript-based fallback summary.");
      callbacks.onProgress?.(95);
      diagnostics.usedFallback = true;
      diagnostics.fallbackReason = "Sparse LLM summary";
      const fallbackStartedAt = Date.now();
      const fallbackSummary = buildFallbackSummary(record);
      diagnostics.fallbackDurationMs = Date.now() - fallbackStartedAt;
      const completedDiagnostics = finalizeDiagnostics();
      callbacks.onLog?.(`[summary-metrics] total summary stage completed in ${formatDurationMs(completedDiagnostics.totalDurationMs)}.`);
      return {
        warnings: [SUMMARY_FALLBACK_WARNING],
        summary: fallbackSummary,
        summaryDiagnostics: completedDiagnostics
      };
    }

    callbacks.onProgress?.(100);
    callbacks.onLog?.("Meeting summary generated successfully.");
    const completedDiagnostics = finalizeDiagnostics();
    callbacks.onLog?.(`[summary-metrics] total summary stage completed in ${formatDurationMs(completedDiagnostics.totalDurationMs)}.`);
    return { warnings: [], summary, summaryDiagnostics: completedDiagnostics };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    callbacks.onLog?.(`Summarization failed: ${errorMessage}`);
    callbacks.onLog?.("Falling back to an extractive summary built from the transcript.");
    diagnostics.usedFallback = true;
    diagnostics.fallbackReason = errorMessage;
    const fallbackStartedAt = Date.now();
    const fallbackSummary = buildFallbackSummary(record);
    diagnostics.fallbackDurationMs = Date.now() - fallbackStartedAt;
    const completedDiagnostics = finalizeDiagnostics();
    callbacks.onLog?.(`[summary-metrics] total summary stage completed in ${formatDurationMs(completedDiagnostics.totalDurationMs)}.`);

    return {
      warnings: [buildSummaryWarning(errorMessage), "A fallback summary was generated directly from the transcript."],
      summary: fallbackSummary,
      summaryDiagnostics: completedDiagnostics
    };
  }
}
