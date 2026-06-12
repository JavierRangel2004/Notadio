import { Communicate } from "edge-tts-universal";
import fs from "node:fs/promises";

export async function synthesizeSpeech(
  text: string,
  outputPath: string,
  voice: string = "es-MX-DaliaNeural"
): Promise<void> {
  const comm = new Communicate(text, { voice });
  const chunks: Buffer[] = [];

  for await (const chunk of comm.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      chunks.push(chunk.data);
    }
  }

  if (chunks.length === 0) {
    throw new Error("No audio chunks received from Edge TTS.");
  }

  const buffer = Buffer.concat(chunks);
  await fs.writeFile(outputPath, buffer);
}
