import { useEffect, useRef, useState } from 'react'
import { listenAudio } from './api.js'
import { MAX_RECORD_SECONDS, startRecording, toAudioPayload } from './audio.js'

// 받아쓰기 버튼: 누르면 녹음, 다시 누르면(또는 60초가 지나면) 멈추고 받아쓴 글을 onText로 넘긴다
export default function DictateButton({ model, label, onText }) {
  const [state, setState] = useState('idle') // 'idle' | 'starting' | 'recording' | 'sending'
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recordingRef = useRef(null)

  // 녹음 중에 화면을 떠나면 마이크를 끈다
  useEffect(() => () => recordingRef.current?.stop(), [])

  useEffect(() => {
    if (state !== 'recording') return
    const started = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000)
      setSeconds(elapsed)
      if (elapsed >= MAX_RECORD_SECONDS) stop()
    }, 250)
    return () => clearInterval(timer)
  }, [state])

  async function start() {
    setError('')
    setSeconds(0)
    setState('starting')
    try {
      recordingRef.current = await startRecording()
      setState('recording')
    } catch (err) {
      setError(err.message)
      setState('idle')
    }
  }

  async function stop() {
    const recording = recordingRef.current
    if (!recording) return
    recordingRef.current = null
    setState('sending')
    try {
      const payload = await toAudioPayload(await recording.stop())
      const { text } = await listenAudio({ ...payload, model: model.id })
      onText(text)
    } catch (err) {
      setError(err.message)
    } finally {
      setState('idle')
    }
  }

  const recording = state === 'recording'
  return (
    <span className="dictate">
      <button
        type="button"
        className={`dictate-button${recording ? ' recording' : ''}`}
        onClick={recording ? stop : start}
        disabled={state === 'starting' || state === 'sending'}
        aria-label={recording ? `${label} 받아쓰기 멈추기` : `${label} 받아쓰기`}
        title={`말하면 글로 받아씁니다 (${model.id}, 최대 ${MAX_RECORD_SECONDS}초)`}
      >
        {state === 'sending' ? '받아쓰는 중…' : recording ? `■ 멈추기 ${seconds}초` : '🎤 받아쓰기'}
        {!recording && state !== 'sending' && !model.free && <span className="paid-badge">유료</span>}
      </button>
      {error && <span className="dictate-error">{error}</span>}
    </span>
  )
}
