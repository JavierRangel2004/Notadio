import { useState, useEffect, useRef } from "react"
import type { AudioSourceMode } from "./liveApi"

export type AudioSettings = {
  mode: AudioSourceMode
  micDeviceId: string
}

type Props = {
  settings: AudioSettings
  onChange: (settings: AudioSettings) => void
}

export function AudioSettingsPanel({ settings, onChange }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [testing, setTesting] = useState(false)
  const [volume, setVolume] = useState(0)

  const analyserRef = useRef<AnalyserNode | null>(null)
  const reqRef = useRef<number>(0)
  const testStreamsRef = useRef<MediaStream[]>([])
  const testContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    async function loadDevices() {
      try {
        const d = await navigator.mediaDevices.enumerateDevices()
        const mics = d.filter((x) => x.kind === "audioinput")
        setDevices(mics)
        if (mics.length > 0 && !mics.some(x => x.deviceId === settings.micDeviceId)) {
           // Default to first mic if current is invalid
           if (mics[0].deviceId) {
              onChange({ ...settings, micDeviceId: mics[0].deviceId })
           }
        }
      } catch {
        // ignore
      }
    }
    void loadDevices()
  }, [settings, onChange])

  async function requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setPermissionGranted(true)
      const d = await navigator.mediaDevices.enumerateDevices()
      const mics = d.filter((x) => x.kind === "audioinput")
      setDevices(mics)
      if (mics.length > 0 && !settings.micDeviceId) {
        onChange({ ...settings, micDeviceId: mics[0].deviceId })
      }
    } catch {
      // ignore
    }
  }

  async function toggleTest() {
    if (testing) {
      stopTest()
      return
    }

    try {
      setTesting(true)
      setVolume(0)
      const ctx = new AudioContext()
      testContextRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser

      const streams: MediaStream[] = []
      if (settings.mode === "mic" || settings.mode === "both") {
        const st = await navigator.mediaDevices.getUserMedia({
          audio: settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : true,
          video: false
        })
        streams.push(st)
      }
      if (settings.mode === "system" || settings.mode === "both") {
        const st = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        })
        streams.push(st)
      }

      testStreamsRef.current = streams

      for (const s of streams) {
        const src = ctx.createMediaStreamSource(s)
        src.connect(analyser)
      }

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const update = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        // Normalize 0-255 to 0-100
        setVolume(Math.min(100, (avg / 255) * 100 * 2)) // *2 for sensitivity
        reqRef.current = requestAnimationFrame(update)
      }
      update()

    } catch (err) {
      stopTest()
      alert("Test failed or permission denied: " + String(err))
    }
  }

  function stopTest() {
    setTesting(false)
    setVolume(0)
    cancelAnimationFrame(reqRef.current)
    if (testContextRef.current) {
      void testContextRef.current.close()
      testContextRef.current = null
    }
    analyserRef.current = null
    for (const s of testStreamsRef.current) {
      s.getTracks().forEach(t => t.stop())
    }
    testStreamsRef.current = []
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTest()
    }
  }, [])

  return (
    <div className="audio-settings-panel">
      <div style={{ marginBottom: "1rem" }}>
        <label className="section-label" style={{ display: "block", marginBottom: "0.5rem" }}>Recording Source</label>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="audioMode"
              checked={settings.mode === "mic"}
              onChange={() => onChange({ ...settings, mode: "mic" })}
            />
            Microphone Only
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="audioMode"
              checked={settings.mode === "system"}
              onChange={() => onChange({ ...settings, mode: "system" })}
            />
            Computer Audio Only
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="audioMode"
              checked={settings.mode === "both"}
              onChange={() => onChange({ ...settings, mode: "both" })}
            />
            Mic + Computer
          </label>
        </div>
        {(settings.mode === "system" || settings.mode === "both") && (
          <p className="live-hint" style={{ marginTop: "0.5rem" }}>
            Heads up: When prompted, you must share your "Entire Screen" or "Tab" and check <strong>"Share audio"</strong>.
          </p>
        )}
      </div>

      {(settings.mode === "mic" || settings.mode === "both") && (
        <div style={{ marginBottom: "1rem" }}>
          <label className="section-label" style={{ display: "block", marginBottom: "0.5rem" }}>Microphone Device</label>
          {!permissionGranted && devices.length === 0 ? (
            <button className="btn-secondary" onClick={requestPermission} type="button">
              Grant Permission to Pick Mic
            </button>
          ) : (
            <select
              style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", background: "rgba(255,255,255,0.05)", color: "white", border: "1px solid rgba(255,255,255,0.1)" }}
              value={settings.micDeviceId}
              onChange={(e) => onChange({ ...settings, micDeviceId: e.target.value })}
            >
              <option value="">System Default</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Unknown Microphone"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <button
          className="btn-secondary"
          type="button"
          onClick={toggleTest}
          style={{ marginBottom: "1rem", borderColor: testing ? "var(--warning)" : undefined, color: testing ? "var(--warning)" : undefined }}
        >
          {testing ? "Stop Test" : "Test Audio Input"}
        </button>
        {testing && (
          <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                background: "var(--success)",
                width: `${volume}%`,
                transition: "width 0.1s ease-out"
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
