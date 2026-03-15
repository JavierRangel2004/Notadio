import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { TranscriptSegment } from "../types.js";
import { ensureDir, readJsonFile } from "../utils/fs.js";
import { parseArgs, runCommand } from "../utils/process.js";

type SpeakerSlice = {
  start: number;
  end: number;
  speaker: string;
};

const UNKNOWN_SPEAKER = "UNKNOWN";
const MAX_MERGE_GAP_SECONDS = 0.35;
const MIN_SLICE_DURATION_SECONDS = 0.2;
const ISOLATED_FLIP_MAX_DURATION_SECONDS = 6;

function estimateDiarizationStagePct(elapsedSeconds: number, durationSeconds: number | undefined): number {
  const expectedRuntime = durationSeconds ? Math.max(45, durationSeconds * 0.15) : 120;
  return Math.min(95, (elapsedSeconds / expectedRuntime) * 100);
}

function normalizeSpeakerLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return UNKNOWN_SPEAKER;
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "unk" ||
    normalized === "n/a" ||
    normalized === "none" ||
    normalized.includes("unknown")
  ) {
    return UNKNOWN_SPEAKER;
  }

  return trimmed;
}

function normalizeSpeakerSlices(rawSlices: SpeakerSlice[]): SpeakerSlice[] {
  const sanitized = rawSlices
    .map((slice) => ({
      start: Number.isFinite(slice.start) ? Math.max(0, slice.start) : NaN,
      end: Number.isFinite(slice.end) ? Math.max(0, slice.end) : NaN,
      speaker: normalizeSpeakerLabel(slice.speaker)
    }))
    .filter((slice) => Number.isFinite(slice.start) && Number.isFinite(slice.end) && slice.end > slice.start)
    .sort((left, right) => left.start - right.start);

  const merged: SpeakerSlice[] = [];

  for (const slice of sanitized) {
    if (slice.end - slice.start < MIN_SLICE_DURATION_SECONDS) {
      continue;
    }

    const previous = merged.at(-1);
    const canMerge =
      previous &&
      previous.speaker === slice.speaker &&
      slice.start - previous.end <= MAX_MERGE_GAP_SECONDS;

    if (canMerge) {
      previous.end = Math.max(previous.end, slice.end);
      continue;
    }

    merged.push({ ...slice });
  }

  return merged;
}

function speakerDurations(slices: SpeakerSlice[]): Map<string, number> {
  const durations = new Map<string, number>();

  for (const slice of slices) {
    const duration = Math.max(0, slice.end - slice.start);
    durations.set(slice.speaker, (durations.get(slice.speaker) ?? 0) + duration);
  }

  return durations;
}

function pickDominantSpeakers(slices: SpeakerSlice[]): string[] {
  const durations = speakerDurations(slices);
  const ranked = [...durations.entries()].sort((left, right) => right[1] - left[1]);
  const nonUnknown = ranked.filter(([speaker]) => speaker !== UNKNOWN_SPEAKER);
  const dominant = nonUnknown.slice(0, 2).map(([speaker]) => speaker);

  if (dominant.length === 2) {
    return dominant;
  }

  for (const [speaker] of ranked) {
    if (!dominant.includes(speaker)) {
      dominant.push(speaker);
    }
    if (dominant.length === 2) {
      break;
    }
  }

  return dominant;
}

function distanceBetweenSlices(left: SpeakerSlice, right: SpeakerSlice): number {
  if (left.end < right.start) {
    return right.start - left.end;
  }

  if (right.end < left.start) {
    return left.start - right.end;
  }

  return 0;
}

function assignSliceToDominantSpeaker(
  target: SpeakerSlice,
  allSlices: SpeakerSlice[],
  dominantSpeakers: string[]
): string {
  let bestSpeaker = dominantSpeakers[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const speaker of dominantSpeakers) {
    const candidateSlices = allSlices.filter((slice) => slice.speaker === speaker);
    if (candidateSlices.length === 0) {
      continue;
    }

    const distance = candidateSlices.reduce((minDistance, slice) => {
      const currentDistance = distanceBetweenSlices(target, slice);
      return Math.min(minDistance, currentDistance);
    }, Number.POSITIVE_INFINITY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSpeaker = speaker;
    }
  }

  return bestSpeaker;
}

function collapseToTwoSpeakers(slices: SpeakerSlice[]): SpeakerSlice[] {
  if (slices.length === 0) {
    return slices;
  }

  const uniqueSpeakers = [...new Set(slices.map((slice) => slice.speaker))];
  if (uniqueSpeakers.length <= 2) {
    return slices;
  }

  const dominantSpeakers = pickDominantSpeakers(slices);
  if (dominantSpeakers.length === 0) {
    return slices;
  }

  const collapsed = slices.map((slice) => {
    if (dominantSpeakers.includes(slice.speaker)) {
      return slice;
    }

    return {
      ...slice,
      speaker: assignSliceToDominantSpeaker(slice, slices, dominantSpeakers)
    };
  });

  return normalizeSpeakerSlices(collapsed);
}

function findNearestSpeakerByDistance(segment: TranscriptSegment, speakers: SpeakerSlice[]): string | undefined {
  let bestSpeaker: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const speakerSlice of speakers) {
    const distance =
      segment.end < speakerSlice.start
        ? speakerSlice.start - segment.end
        : segment.start > speakerSlice.end
          ? segment.start - speakerSlice.end
          : 0;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSpeaker = speakerSlice.speaker;
    }
  }

  return bestSpeaker;
}

function pickSpeaker(segment: TranscriptSegment, speakers: SpeakerSlice[]): string | undefined {
  let bestSpeaker: string | undefined;
  let bestOverlap = 0;

  for (const speakerSlice of speakers) {
    const overlap = Math.min(segment.end, speakerSlice.end) - Math.max(segment.start, speakerSlice.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSpeaker = speakerSlice.speaker;
    }
  }

  if (bestSpeaker) {
    return bestSpeaker;
  }

  return findNearestSpeakerByDistance(segment, speakers);
}

function smoothTranscriptSpeakers(segments: TranscriptSegment[]): TranscriptSegment[] {
  const output = segments.map((segment) => ({ ...segment }));

  for (let index = 1; index < output.length - 1; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    const next = output[index + 1];
    const currentDuration = Math.max(0, current.end - current.start);

    if (!previous.speaker || !next.speaker) {
      continue;
    }

    if (previous.speaker !== next.speaker) {
      continue;
    }

    if (current.speaker !== previous.speaker && currentDuration <= ISOLATED_FLIP_MAX_DURATION_SECONDS) {
      current.speaker = previous.speaker;
    }
  }

  return output;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function hasSpeaker(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

async function inferSpeakerNameMap(segments: TranscriptSegment[]): Promise<Map<string, string> | null> {
  const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(hasSpeaker))];
  if (speakers.length < 2) {
    return null;
  }

  let transcriptText = "";
  for (const segment of segments) {
    if (!segment.speaker) continue;
    const line = `${segment.speaker}: ${segment.text}\n`;
    if (transcriptText.length + line.length > 4000) break;
    transcriptText += line;
  }

  const prompt = `Analiza este fragmento de transcripción y extrae los nombres reales de los hablantes si se mencionan (por ejemplo, si se presentan o se llaman por su nombre).
Devuelve ÚNICAMENTE un objeto JSON donde las claves sean las etiquetas de los hablantes (ej. "SPEAKER_01") y los valores sean sus nombres Inferidos (ej. "Javier" o "Ana").
Si no puedes deducir el nombre de un hablante con alta confianza, no lo incluyas en el JSON.

Transcripción:
${transcriptText}`;

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { response: string };
    const result = JSON.parse(data.response) as Record<string, unknown>;

    const mapping = new Map<string, string>();
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === "string" && value.trim()) {
        mapping.set(key, value.trim());
      }
    }

    if (mapping.size > 0) {
      return mapping;
    }
  } catch {
    // Fallback on error
  }

  return null;
}

function fallbackSpeakerNames(segments: TranscriptSegment[]): Map<string, string> {
  const speakersInOrder = [...new Set(segments.map((segment) => segment.speaker).filter(hasSpeaker))];
  const mapping = new Map<string, string>();

  if (speakersInOrder.length === 2) {
    mapping.set(speakersInOrder[0]!, "SPEAKER_A");
    mapping.set(speakersInOrder[1]!, "SPEAKER_B");
    return mapping;
  }

  for (const speaker of speakersInOrder) {
    mapping.set(speaker, speaker);
  }

  return mapping;
}

async function applySpeakerNameMap(segments: TranscriptSegment[]): Promise<TranscriptSegment[]> {
  const inferred = await inferSpeakerNameMap(segments);
  const fallback = fallbackSpeakerNames(segments);
  const mapping = inferred ?? fallback;

  return segments.map((segment) => {
    if (!segment.speaker) {
      return segment;
    }

    return {
      ...segment,
      speaker: mapping.get(segment.speaker) ?? segment.speaker
    };
  });
}

export async function postProcessDiarization(
  segments: TranscriptSegment[],
  rawSpeakerSlices: SpeakerSlice[]
): Promise<TranscriptSegment[]> {
  const normalizedSlices = normalizeSpeakerSlices(rawSpeakerSlices);
  const collapsedSlices = collapseToTwoSpeakers(normalizedSlices);
  const assigned = segments.map((segment) => ({
    ...segment,
    speaker: pickSpeaker(segment, collapsedSlices)
  }));
  const smoothed = smoothTranscriptSpeakers(assigned);
  return applySpeakerNameMap(smoothed);
}

export async function applyOptionalDiarization(
  audioPath: string,
  workDir: string,
  segments: TranscriptSegment[],
  callbacks: {
    durationSeconds?: number;
    onLog?: (line: string) => void;
    onProgress?: (stagePct: number) => void;
  } = {}
): Promise<{ warnings: string[]; segments: TranscriptSegment[] }> {
  if (!config.diarizationCommand) {
    return {
      warnings: ["Speaker labels were skipped because no diarization command is configured."],
      segments
    };
  }

  await ensureDir(workDir);
  const outputFile = path.join(workDir, "diarization.json");
  const args = parseArgs(config.diarizationArgs, {
    input: audioPath,
    outputFile,
    projectRoot: config.projectRoot
  });

  try {
    const startedAt = Date.now();
    let lastProgress = 0;
    const heartbeat = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const progress = estimateDiarizationStagePct(elapsedSeconds, callbacks.durationSeconds);
      if (progress > lastProgress) {
        lastProgress = progress;
        callbacks.onProgress?.(progress);
      }
    }, 2000);

    try {
      await runCommand(config.diarizationCommand, args, {
        cwd: config.projectRoot,
        onStdoutLine: (line) => callbacks.onLog?.(line),
        onStderrLine: (line) => callbacks.onLog?.(line)
      });
    } finally {
      clearInterval(heartbeat);
    }

    const payload = await readJsonFile<{ segments?: SpeakerSlice[] } | SpeakerSlice[]>(outputFile);
    const speakerSlices = Array.isArray(payload) ? payload : payload.segments ?? [];
    callbacks.onLog?.(`Diarization complete. Found ${speakerSlices.length} segments.`);
    callbacks.onProgress?.(100);

    const segmentResults = await postProcessDiarization(segments, speakerSlices);

    return {
      warnings: [],
      segments: segmentResults
    };
  } catch (error) {
    await fs.rm(outputFile, { force: true }).catch(() => undefined);
    return {
      warnings: [
        error instanceof Error
          ? `Speaker labels were skipped because diarization failed: ${error.message}`
          : "Speaker labels were skipped because diarization failed."
      ],
      segments
    };
  }
}
