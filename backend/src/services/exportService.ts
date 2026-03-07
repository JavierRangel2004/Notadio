import fs from "node:fs/promises";
import path from "node:path";
import { TranscriptRecord, TranscriptSegment, TranscriptVariant } from "../types.js";
import { ensureDir, writeJsonFile } from "../utils/fs.js";

function secondsToSrt(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function segmentText(segment: TranscriptSegment): string {
  return segment.speaker ? `[${segment.speaker}] ${segment.text}` : segment.text;
}

function buildTxt(variant: TranscriptVariant): string {
  return variant.segments.map(segmentText).join("\n");
}

function buildSrt(variant: TranscriptVariant): string {
  return variant.segments
    .map((segment, index) => {
      return `${index + 1}\n${secondsToSrt(segment.start)} --> ${secondsToSrt(segment.end)}\n${segmentText(segment)}\n`;
    })
    .join("\n");
}

async function writeVariantArtifacts(
  record: TranscriptRecord,
  variant: TranscriptVariant,
  variantDir: string
): Promise<string[]> {
  const txtPath = path.join(variantDir, "transcript.txt");
  const srtPath = path.join(variantDir, "transcript.srt");
  const jsonPath = path.join(variantDir, "transcript.json");

  await fs.writeFile(txtPath, buildTxt(variant), "utf-8");
  await fs.writeFile(srtPath, buildSrt(variant), "utf-8");
  await writeJsonFile(jsonPath, {
    jobId: record.jobId,
    sourceMedia: record.sourceMedia,
    durationSeconds: record.durationSeconds,
    detectedLanguage: record.detectedLanguage,
    warnings: record.warnings,
    variant
  });

  return [txtPath, srtPath, jsonPath];
}

export async function writeArtifacts(record: TranscriptRecord, targetDir: string): Promise<{
  source: string[];
  english: string[];
}> {
  await ensureDir(targetDir);
  const sourceDir = path.join(targetDir, "source");
  const englishDir = path.join(targetDir, "english");
  await ensureDir(sourceDir);
  await ensureDir(englishDir);

  const sourceArtifacts = await writeVariantArtifacts(record, record.source, sourceDir);
  const englishArtifacts = record.english
    ? await writeVariantArtifacts(record, record.english, englishDir)
    : [];

  return {
    source: sourceArtifacts,
    english: englishArtifacts
  };
}
