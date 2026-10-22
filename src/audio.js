// 받아쓰기 녹음 규칙. 서버(server/index.js)와 같게 둔다: 3MB 이하, webm·ogg·m4a·mp3·wav
export const MAX_RECORD_SECONDS = 60
const MAX_AUDIO_BYTES = 3_000_000

// 크롬·파이어폭스는 webm, 사파리는 mp4(m4a)로 녹음한다
function audioFormat(mimeType) {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  return null
}

// 녹음을 시작하고 { stop() }을 돌려준다. stop()은 녹음된 Blob을 돌려준다
export async function startRecording() {
  // 마이크는 HTTPS나 localhost 페이지에서만 열린다
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('이 화면에서는 녹음할 수 없어요. (HTTPS 또는 localhost 주소에서만 마이크를 쓸 수 있어요)')
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    throw new Error(err.name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.' : `마이크를 열지 못했어요. (${err.name})`)
  }
  const recorder = new MediaRecorder(stream)
  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      resolve(new Blob(chunks, { type: recorder.mimeType }))
    }
  })
  recorder.start()
  return {
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      return done
    },
  }
}

// 서버로 보낼 { audio(base64), format }으로 바꾼다
export async function toAudioPayload(blob) {
  const format = audioFormat(blob.type)
  if (!format) throw new Error('지원하지 않는 녹음 형식이에요.')
  if (blob.size === 0) throw new Error('녹음된 소리가 없어요.')
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('녹음이 너무 길어요.')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('녹음을 읽지 못했어요.'))
    reader.readAsDataURL(blob)
  })
  return { audio: dataUrl.slice(dataUrl.indexOf(',') + 1), format }
}
