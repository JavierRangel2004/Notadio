import http from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { config } from "../config.js"
import {
  createSession,
  resumeSession,
  receiveFrame,
  finalizeSession,
  handleDisconnect,
  getSession,
  requestMentionAssistant
} from "../sessions/liveSessionOrchestrator.js"
import type { SessionConfig } from "../types.js"

type WsClientTextMessage =
  | { type: "start_session"; config: SessionConfig }
  | { type: "resume_session"; sessionId: string }
  | { type: "stop_session" }
  | { type: "request_assistant"; mentionId: string }
  | { type: "ping" }
export function attachWebSocketHandler(
  server: http.Server,
  enqueueJob: (jobId: string) => void
): void {
  if (!config.liveTranscriptionEnabled) return

  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url ?? "", `http://${request.headers.host ?? "localhost"}`)
    if (pathname === "/api/sessions/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on("connection", (ws: WebSocket) => {
    let sessionId: string | null = null

    // Heartbeat: ping every 30s, terminate if no pong received
    let isAlive = true
    ws.on("pong", () => {
      isAlive = true
    })
    const pingInterval = setInterval(() => {
      if (!isAlive) {
        ws.terminate()
        return
      }
      isAlive = false
      ws.ping()
    }, 30000)

    const send = (msg: object): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    }

    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        // PCM audio frame
        if (sessionId) {
          void receiveFrame(sessionId, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
        }
        return
      }

      let msg: WsClientTextMessage
      try {
        const raw = data instanceof ArrayBuffer
          ? Buffer.from(data).toString()
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString()
            : (data as Buffer | string).toString()
        msg = JSON.parse(raw) as WsClientTextMessage
      } catch {
        send({ type: "error", message: "Invalid JSON message" })
        return
      }

      switch (msg.type) {
        case "start_session": {
          void (async () => {
            try {
              const session = await createSession(msg.config, send)
              sessionId = session.id
              send({ type: "session_created", sessionId: session.id })
            } catch (err) {
              send({
                type: "error",
                message: `Failed to create session: ${err instanceof Error ? err.message : String(err)}`
              })
            }
          })()
          break
        }

        case "resume_session": {
          const resumed = resumeSession(msg.sessionId, send)
          if (resumed) {
            sessionId = msg.sessionId
          } else {
            send({ type: "error", message: "Session not found or cannot be resumed" })
          }
          break
        }

        case "stop_session": {
          if (!sessionId) {
            send({ type: "error", message: "No active session" })
            break
          }
          const stoppingId = sessionId
          sessionId = null
          void (async () => {
            try {
              const jobId = await finalizeSession(stoppingId)
              if (jobId) {
                enqueueJob(jobId)
                send({ type: "session_stopped", jobId })
              } else {
                send({ type: "error", message: "Failed to finalize session — no audio recorded" })
              }
            } catch (err) {
              send({
                type: "error",
                message: `Finalization failed: ${err instanceof Error ? err.message : String(err)}`
              })
            }
          })()
          break
        }

        case "request_assistant": {
          if (sessionId && msg.mentionId) {
            void requestMentionAssistant(sessionId, msg.mentionId)
          }
          break
        }

        case "ping": {
          send({ type: "pong" })
          break
        }

        default: {
          send({ type: "error", message: "Unknown message type" })
        }
      }
    })

    ws.on("close", () => {
      clearInterval(pingInterval)
      if (sessionId) {
        handleDisconnect(sessionId)
        sessionId = null
      }
    })

    ws.on("error", () => {
      clearInterval(pingInterval)
    })
  })
}
