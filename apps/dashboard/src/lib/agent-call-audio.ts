/**
 * Browser side of an agent call.
 *
 * Audio goes to the voice provider. Tool calls come back here and are
 * executed by the API, which still owns the decision and the agent run.
 */

import { callRoutes } from '../api/routes/calls.routes'
import { apiPost } from './api'

export type CallTranscriptLine = { role: 'user' | 'assistant'; text: string }

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>

export type LiveCall = {
  stop: () => void
  speak: (text: string) => void
  lines: CallTranscriptLine[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return asRecord(JSON.parse(raw))
    } catch {
      return {}
    }
  }
  return asRecord(raw)
}

function sendToolResult(channel: RTCDataChannel, callId: string, output: unknown) {
  if (channel.readyState !== 'open') return
  channel.send(
    JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output ?? {}),
      },
    }),
  )
  channel.send(JSON.stringify({ type: 'response.create' }))
}

export async function startAgentCallAudio(opts: {
  clientSecret: string
  onTool: ToolHandler
  onLine: (line: CallTranscriptLine) => void
}): Promise<LiveCall> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const pc = new RTCPeerConnection()
  const lines: CallTranscriptLine[] = []
  for (const track of stream.getTracks()) pc.addTrack(track, stream)
  const audio = new Audio()
  audio.autoplay = true
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null
  }
  const channel = pc.createDataChannel('oai-events')

  channel.onmessage = (event) => {
    let frame: Record<string, unknown>
    try {
      frame = asRecord(JSON.parse(String(event.data)))
    } catch {
      return
    }
    const type = String(frame.type || '')
    if (type === 'response.function_call_arguments.done') {
      const toolCallId = String(frame.call_id || '')
      const name = String(frame.name || '')
      if (!toolCallId || !name) return
      void opts
        .onTool(name, parseArgs(frame.arguments))
        .then((output) => sendToolResult(channel, toolCallId, output))
        .catch(() =>
          sendToolResult(channel, toolCallId, { status: 'error', say: 'That did not go through.' }),
        )
      return
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(frame.transcript || '').trim()
      if (!text) return
      const line: CallTranscriptLine = { role: 'user', text }
      lines.push(line)
      opts.onLine(line)
      return
    }
    if (type === 'response.output_audio_transcript.done') {
      const text = String(frame.transcript || '').trim()
      if (!text) return
      const line: CallTranscriptLine = { role: 'assistant', text }
      lines.push(line)
      opts.onLine(line)
    }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${opts.clientSecret}`,
      'Content-Type': 'application/sdp',
    },
  })
  if (!response.ok) {
    stream.getTracks().forEach((track) => track.stop())
    pc.close()
    throw new Error(`Voice session failed (${response.status})`)
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() })
  channel.onopen = () => {
    channel.send(JSON.stringify({ type: 'response.create' }))
  }

  const speak = (text: string) => {
    const spoken = text.trim()
    if (!spoken || channel.readyState !== 'open') return
    channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `[Run update] ${spoken}` }],
        },
      }),
    )
    channel.send(JSON.stringify({ type: 'response.create' }))
  }

  return {
    lines,
    speak,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop())
      audio.srcObject = null
      pc.close()
    },
  }
}

export async function postCallTool(callId: string, name: string, args: Record<string, unknown>) {
  const body = await apiPost<{ output: unknown }>(callRoutes.tool(callId), {
    name,
    arguments: args,
  })
  return body.output
}
