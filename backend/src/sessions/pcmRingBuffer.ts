type PcmFrame = {
  samples: Int16Array
  sessionOffsetMs: number
  durationMs: number
}

/**
 * Time-based circular buffer for 16kHz mono Int16 PCM frames.
 * Evicts oldest frames when total covered duration exceeds maxDurationMs.
 */
export class PcmRingBuffer {
  private frames: PcmFrame[] = []
  private readonly maxDurationMs: number

  constructor(maxDurationMs = 25000) {
    this.maxDurationMs = maxDurationMs
  }

  push(samples: Int16Array, sessionOffsetMs: number): void {
    // at 16kHz: 1ms = 16 samples
    const durationMs = Math.round(samples.length / 16)
    this.frames.push({ samples, sessionOffsetMs, durationMs })
    this.evict()
  }

  private evict(): void {
    if (this.frames.length < 2) return
    const latest = this.frames[this.frames.length - 1]
    const latestEnd = latest.sessionOffsetMs + latest.durationMs
    const cutoff = latestEnd - this.maxDurationMs
    while (
      this.frames.length > 1 &&
      this.frames[0].sessionOffsetMs + this.frames[0].durationMs <= cutoff
    ) {
      this.frames.shift()
    }
  }

  /**
   * Returns up to windowMs of recent audio as a concatenated Int16Array,
   * plus the absolute session offset of the window start.
   */
  getWindow(windowMs: number): { samples: Int16Array; windowStartMs: number } | null {
    if (this.frames.length === 0) return null

    const latest = this.frames[this.frames.length - 1]
    const latestEnd = latest.sessionOffsetMs + latest.durationMs
    const windowStartMs = Math.max(0, latestEnd - windowMs)

    const relevant = this.frames.filter(
      (f) => f.sessionOffsetMs + f.durationMs > windowStartMs
    )
    if (relevant.length === 0) return null

    const totalSamples = relevant.reduce((s, f) => s + f.samples.length, 0)
    const combined = new Int16Array(totalSamples)
    let offset = 0
    for (const frame of relevant) {
      combined.set(frame.samples, offset)
      offset += frame.samples.length
    }

    return { samples: combined, windowStartMs: relevant[0].sessionOffsetMs }
  }

  /** Total audio duration currently stored in the buffer. */
  get currentDurationMs(): number {
    if (this.frames.length === 0) return 0
    const first = this.frames[0]
    const last = this.frames[this.frames.length - 1]
    return last.sessionOffsetMs + last.durationMs - first.sessionOffsetMs
  }

  clear(): void {
    this.frames = []
  }
}

/**
 * Builds a WAV file buffer from 16kHz mono Int16 PCM samples.
 * No external dependency — writes header directly.
 */
export function buildWavBuffer(samples: Int16Array, sampleRate = 16000): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const headerSize = 44
  const buf = Buffer.alloc(headerSize + dataSize)

  // RIFF chunk
  buf.write("RIFF", 0)
  buf.writeUInt32LE(headerSize - 8 + dataSize, 4)
  buf.write("WAVE", 8)

  // fmt sub-chunk
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)          // PCM
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)

  // data sub-chunk
  buf.write("data", 36)
  buf.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2)
  }

  return buf
}
