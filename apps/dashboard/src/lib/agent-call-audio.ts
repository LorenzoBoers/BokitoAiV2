/**
 * Browser side of an agent call.
 *
 * Audio goes to the voice provider. Tool calls come back here and are
 * executed by the API, which still owns the decision and the agent run.
 */

import { callRoutes } from '../api/routes/calls.routes'
import { apiPost } from './api'
import { agentCallHoldWanted, setAgentCallLevel, setAgentCallUserSpeaking } from './agent-call-live'

export type CallTranscriptLine = { role: 'user' | 'assistant'; text: string }

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>

export type CallSessionUpdate = {
  instructions?: string
  speed?: number
  language?: string
}

export type LiveCall = {
  stop: () => void
  speak: (text: string) => void
  lines: CallTranscriptLine[]
  setMuted: (muted: boolean) => void
  /** Hold-to-talk: the mic is open only while this is true. */
  setHeld: (held: boolean) => void
  updateSession: (update: CallSessionUpdate) => void
}

const SPEECH_EVENTS = new Set([
  'output_audio_buffer.started',
  'response.output_audio.delta',
  'response.audio.delta',
])
const SPEECH_END_EVENTS = new Set([
  'output_audio_buffer.stopped',
  'output_audio_buffer.cleared',
  'response.output_audio.done',
  'response.audio.done',
  'response.done',
])

let ringTimer: number | null = null
let ringCtx: AudioContext | null = null

export function stopRingTone() {
  if (ringTimer != null) window.clearInterval(ringTimer)
  ringTimer = null
  void ringCtx?.close().catch(() => {})
  ringCtx = null
}

export function playRingTone() {
  stopRingTone()
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  ringCtx = new Ctx()
  const beep = () => {
    if (!ringCtx) return
    const osc = ringCtx.createOscillator()
    const gain = ringCtx.createGain()
    osc.frequency.value = 440
    gain.gain.value = 0.04
    osc.connect(gain)
    gain.connect(ringCtx.destination)
    osc.start()
    osc.stop(ringCtx.currentTime + 0.16)
  }
  beep()
  ringTimer = window.setInterval(beep, 1400)
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
}

/** One spoken follow-up for a whole batch of tool results, never one per tool. */
function createFollowUp(channel: RTCDataChannel) {
  if (channel.readyState !== 'open') return
  channel.send(JSON.stringify({ type: 'response.create' }))
}

/** Heard speech on the remote track. Events cover the gap before samples arrive. */
function watchRemoteSpeech(stream: MediaStream, onHeard: (heard: boolean) => void): () => void {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  const ctx = new Ctx()
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.35
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  let heard = false
  let quietSince = 0
  let frame = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / data.length)
    const now = performance.now()
    if (rms > 0.03) {
      quietSince = 0
      if (!heard) {
        heard = true
        onHeard(true)
      }
    } else if (heard) {
      if (!quietSince) quietSince = now
      else if (now - quietSince > 220) {
        heard = false
        quietSince = 0
        onHeard(false)
      }
    }
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    stopped = true
    window.cancelAnimationFrame(frame)
    source.disconnect()
    void ctx.close().catch(() => {})
  }
}

function rmsOf(analyser: AnalyserNode, data: Uint8Array) {
  analyser.getByteTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const sample = (data[i] - 128) / 128
    sum += sample * sample
  }
  return Math.sqrt(sum / data.length)
}

/** Mic and agent audio, as the same 0–1 level the dictation wave uses. */
function watchCallLevel(local: MediaStream, getRemote: () => MediaStream | null): () => void {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  const ctx = new Ctx()
  void ctx.resume().catch(() => {})
  const localSource = ctx.createMediaStreamSource(local)
  const localAnalyser = ctx.createAnalyser()
  localAnalyser.fftSize = 512
  localAnalyser.smoothingTimeConstant = 0.15
  localSource.connect(localAnalyser)
  const localData = new Uint8Array(localAnalyser.fftSize)
  let remoteSource: MediaStreamAudioSourceNode | null = null
  let remoteAnalyser: AnalyserNode | null = null
  let remoteData: Uint8Array | null = null
  let remoteSeen: MediaStream | null = null
  let noise = 0.03
  let level = 0
  let frame = 0
  let stopped = false
  let userOn = false
  let loudSince = 0
  let quietSince = 0
  const tick = () => {
    if (stopped) return
    const remote = getRemote()
    if (remote !== remoteSeen) {
      remoteSource?.disconnect()
      remoteSource = null
      remoteAnalyser = null
      remoteData = null
      remoteSeen = remote
      if (remote && remote.getAudioTracks().length) {
        remoteSource = ctx.createMediaStreamSource(remote)
        remoteAnalyser = ctx.createAnalyser()
        remoteAnalyser.fftSize = 512
        remoteAnalyser.smoothingTimeConstant = 0.15
        remoteSource.connect(remoteAnalyser)
        remoteData = new Uint8Array(remoteAnalyser.fftSize)
      }
    }
    const remoteRms = remoteAnalyser && remoteData ? rmsOf(remoteAnalyser, remoteData) : 0
    const localRms = rmsOf(localAnalyser, localData)
    const now = performance.now()
    if (localRms > 0.04) {
      quietSince = 0
      if (!loudSince) loudSince = now
      if (!userOn && now - loudSince > 90) {
        userOn = true
        setAgentCallUserSpeaking(true)
      }
    } else if (userOn) {
      loudSince = 0
      if (!quietSince) quietSince = now
      else if (now - quietSince > 280) {
        userOn = false
        quietSince = 0
        setAgentCallUserSpeaking(false)
      }
    } else {
      loudSince = 0
    }
    const rms = Math.max(localRms, remoteRms)
    noise += (rms - noise) * (rms <= noise ? 0.08 : 0.004)
    noise = Math.max(0.0015, noise)
    const above = Math.max(0, rms - noise * 1.6)
    const norm = above / Math.max(0.012, noise * 1.5)
    const target = Math.min(1, Math.pow(norm, 1.6))
    const follow = target > level ? 0.85 : 0.4
    level += (target - level) * follow
    setAgentCallLevel(level)
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    stopped = true
    window.cancelAnimationFrame(frame)
    localSource.disconnect()
    remoteSource?.disconnect()
    void ctx.close().catch(() => {})
    setAgentCallLevel(0)
    setAgentCallUserSpeaking(false)
  }
}

let activeCall: LiveCall | null = null

export async function startAgentCallAudio(opts: {
  clientSecret: string
  onTool: ToolHandler
  onLines: (lines: CallTranscriptLine[]) => void
  /** The agent called hang_up. Tear the call down after the goodbye plays. */
  onHangUp?: () => void
  /** True while the agent's voice is playing. */
  onSpeaking?: (speaking: boolean) => void
  /** The mic stays closed until the person holds the dial, then one turn is committed. */
  pushToTalk?: boolean
}): Promise<LiveCall> {
  activeCall?.stop()
  const pushToTalk = Boolean(opts.pushToTalk)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  if (pushToTalk) {
    for (const track of stream.getAudioTracks()) track.enabled = false
  }
  const pc = new RTCPeerConnection()
  const lines: CallTranscriptLine[] = []
  const slots: { id: string; role: 'user' | 'assistant'; text: string }[] = []
  const publishLines = () => {
    const next = slots
      .filter((slot) => slot.text.trim())
      .map((slot) => ({ role: slot.role, text: slot.text }))
    lines.splice(0, lines.length, ...next)
    opts.onLines(next)
  }
  const rememberLine = (id: string, role: 'user' | 'assistant', text?: string) => {
    const spoken = (text || '').trim()
    let slot = id ? slots.find((row) => row.id === id) : undefined
    if (!slot) {
      slot = { id: id || `${role}-${slots.length}`, role, text: '' }
      slots.push(slot)
    }
    if (spoken) slot.text = spoken
    publishLines()
  }
  const textFromItem = (item: Record<string, unknown>) => {
    const content = item.content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => {
        const row = asRecord(part)
        return String(row.transcript || row.text || '').trim()
      })
      .filter(Boolean)
      .join(' ')
  }
  for (const track of stream.getTracks()) pc.addTrack(track, stream)
  const audio = new Audio()
  audio.autoplay = true
  let eventOn = false
  let heardOn = false
  let pendingSpeed: number | null = null
  let published = false
  let endTimer: number | null = null
  let stopWatch = () => {}
  let remoteStream: MediaStream | null = null
  const stopLevel = watchCallLevel(stream, () => remoteStream)
  const publishSpeaking = () => {
    const next = eventOn || heardOn
    if (next === published) return
    published = next
    opts.onSpeaking?.(next)
    applyMic()
  }
  const setEventSpeaking = (on: boolean) => {
    if (endTimer != null) {
      window.clearTimeout(endTimer)
      endTimer = null
    }
    if (on) {
      eventOn = true
      publishSpeaking()
      return
    }
    // The playback buffer trails the provider's "done" event.
    endTimer = window.setTimeout(() => {
      endTimer = null
      eventOn = false
      publishSpeaking()
      if (pendingSpeed != null && channel.readyState === 'open') {
        const speed = pendingSpeed
        pendingSpeed = null
        channel.send(
          JSON.stringify({
            type: 'session.update',
            session: { type: 'realtime', audio: { output: { speed } } },
          }),
        )
      }
    }, 280)
  }
  pc.ontrack = (event) => {
    const remote = event.streams[0] ?? null
    remoteStream = remote
    audio.srcObject = remote
    stopWatch()
    if (remote) {
      stopWatch = watchRemoteSpeech(remote, (heard) => {
        heardOn = heard
        publishSpeaking()
      })
    }
  }
  const channel = pc.createDataChannel('oai-events')
  let stopped = false
  let hangUp = false
  let providerDone = false
  let hungUp = false
  let hangTimer: number | null = null
  let hangStarted = 0
  let userMuted = false
  let held = pushToTalk && agentCallHoldWanted()
  let commitPending = false
  let duckTimer: number | null = null
  let openTools = 0
  let wantFollowUp = false
  let speakGeneration = 0
  const applyMic = () => {
    if (duckTimer != null) window.clearTimeout(duckTimer)
    duckTimer = null
    if (pushToTalk) {
      for (const track of stream.getAudioTracks()) track.enabled = held && !userMuted
      return
    }
    const agentTalking = eventOn || heardOn
    if (userMuted || agentTalking) {
      for (const track of stream.getAudioTracks()) track.enabled = false
      return
    }
    // Keep the mic closed briefly after playback so the speakers are not heard as the person.
    duckTimer = window.setTimeout(() => {
      duckTimer = null
      if (userMuted || eventOn || heardOn) return
      for (const track of stream.getAudioTracks()) track.enabled = true
    }, 600)
  }
  const cancelHang = () => {
    if (hangTimer != null) window.clearTimeout(hangTimer)
    hangTimer = null
  }
  // Drop the line only after the goodbye has actually gone quiet.
  // response.done fires while the playback buffer still holds the sentence.
  const scheduleHangUp = () => {
    if (!hangUp || hungUp || hangTimer != null) return
    if (!hangStarted) hangStarted = performance.now()
    hangTimer = window.setTimeout(() => {
      hangTimer = null
      if (!hangUp || hungUp) return
      const expired = performance.now() - hangStarted > 12000
      if ((!providerDone || eventOn || heardOn) && !expired) {
        scheduleHangUp()
        return
      }
      hangTimer = window.setTimeout(() => {
        hangTimer = null
        if (!hangUp || hungUp) return
        if ((eventOn || heardOn) && performance.now() - hangStarted < 12000) {
          scheduleHangUp()
          return
        }
        hungUp = true
        opts.onHangUp?.()
        stop()
      }, 700)
    }, 150)
  }
  let current: LiveCall | null = null
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelHang()
    stopWatch()
    stopLevel()
    if (endTimer != null) window.clearTimeout(endTimer)
    if (duckTimer != null) window.clearTimeout(duckTimer)
    stream.getTracks().forEach((track) => track.stop())
    audio.srcObject = null
    pc.close()
    if (activeCall === current) activeCall = null
    if (published) {
      published = false
      opts.onSpeaking?.(false)
    }
  }

  channel.onmessage = (event) => {
    let frame: Record<string, unknown>
    try {
      frame = asRecord(JSON.parse(String(event.data)))
    } catch {
      return
    }
    const type = String(frame.type || '')
    if (SPEECH_EVENTS.has(type)) setEventSpeaking(true)
    else if (SPEECH_END_EVENTS.has(type)) setEventSpeaking(false)
    if (type === 'response.created') providerDone = false
    if (type === 'response.done') {
      providerDone = true
      if (hangUp) scheduleHangUp()
    }
    if (type === 'response.function_call_arguments.done') {
      const toolCallId = String(frame.call_id || '')
      const name = String(frame.name || '')
      if (!toolCallId || !name) return
      const ending = name === 'hang_up'
      // consult_run speaks later, once, when the run finishes. A follow-up
      // here made the model answer again and call the tool again.
      const quiet = ending || name === 'consult_run'
      if (ending) {
        hangUp = true
        scheduleHangUp()
      }
      openTools += 1
      const settle = (followUp: boolean) => {
        if (followUp) wantFollowUp = true
        openTools = Math.max(0, openTools - 1)
        if (openTools !== 0 || !wantFollowUp) return
        wantFollowUp = false
        createFollowUp(channel)
      }
      void opts
        .onTool(name, parseArgs(frame.arguments))
        .then((output) => {
          sendToolResult(channel, toolCallId, output)
          const status = asRecord(output).status
          settle(!quiet && status !== 'already_looking' && status !== 'looking')
        })
        .catch(() => {
          if (ending) {
            hangUp = false
            cancelHang()
          }
          sendToolResult(channel, toolCallId, { status: 'error', say: 'That did not go through.' })
          settle(!ending)
        })
      return
    }
    if (
      type === 'conversation.item.added' ||
      type === 'conversation.item.created' ||
      type === 'conversation.item.done'
    ) {
      const item = asRecord(frame.item)
      const kind = String(item.type || 'message')
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : ''
      const id = String(item.id || frame.item_id || '')
      if (!role || kind !== 'message') return
      rememberLine(id, role, textFromItem(item))
      return
    }
    if (type === 'error' && commitPending) {
      commitPending = false
      return
    }
    if (type === 'input_audio_buffer.committed') {
      const id = String(frame.item_id || '')
      if (id) rememberLine(id, 'user')
      if (commitPending && channel.readyState === 'open') {
        commitPending = false
        channel.send(JSON.stringify({ type: 'response.create' }))
      }
      return
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(frame.transcript || '').trim()
      if (!text) return
      rememberLine(String(frame.item_id || ''), 'user', text)
      return
    }
    if (type === 'response.output_audio_transcript.done') {
      const text = String(frame.transcript || '').trim()
      if (!text) return
      rememberLine(String(frame.item_id || ''), 'assistant', text)
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
  const armCommit = () => {
    if (channel.readyState !== 'open') {
      commitPending = true
      return
    }
    commitPending = true
    channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
  }

  channel.onopen = () => {
    if (pushToTalk) {
      held = agentCallHoldWanted()
      applyMic()
      if (!held && commitPending) armCommit()
      return
    }
    channel.send(JSON.stringify({ type: 'response.create' }))
  }

  const setMuted = (muted: boolean) => {
    userMuted = muted
    applyMic()
  }

  const setHeld = (next: boolean) => {
    if (!pushToTalk) return
    const was = held
    held = next
    if (next) {
      commitPending = false
      if (eventOn || heardOn) {
        audio.pause()
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'response.cancel' }))
        }
      }
      applyMic()
      return
    }
    applyMic()
    if (!was) return
    armCommit()
  }

  const updateSession = (update: CallSessionUpdate) => {
    if (channel.readyState !== 'open') return
    const session: Record<string, unknown> = { type: 'realtime' }
    if (update.instructions) session.instructions = update.instructions
    const audio: Record<string, unknown> = {}
    if (update.language) {
      audio.input = {
        transcription: { model: 'gpt-4o-transcribe', language: update.language },
      }
    }
    if (typeof update.speed === 'number') {
      if (eventOn) pendingSpeed = update.speed
      else audio.output = { speed: update.speed }
    }
    if (Object.keys(audio).length) session.audio = audio
    channel.send(JSON.stringify({ type: 'session.update', session }))
  }

  const speak = (text: string) => {
    const spoken = text.trim()
    if (!spoken || channel.readyState !== 'open') return
    // A new result replaces one still waiting. Never queue another voice on top.
    speakGeneration += 1
    const generation = speakGeneration
    channel.send(JSON.stringify({ type: 'response.cancel' }))
    window.setTimeout(() => {
      if (generation !== speakGeneration || channel.readyState !== 'open') return
      channel.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            tool_choice: 'none',
            instructions:
              'Say the following to the person in one or two short sentences, then stop and wait. ' +
              'Do not call any tools.\n\n' +
              spoken,
          },
        }),
      )
    }, 80)
  }

  current = {
    lines,
    speak,
    stop,
    setMuted,
    setHeld,
    updateSession,
  }
  activeCall = current
  return current
}

export async function postCallTool(callId: string, name: string, args: Record<string, unknown>) {
  const body = await apiPost<{ output: unknown }>(callRoutes.tool(callId), {
    name,
    arguments: args,
  })
  return body.output
}
