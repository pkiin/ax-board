// 대표 이미지 규칙. 서버(server/index.js)와 같게 둔다: jpeg·png·webp, 저장은 1.5MB 이하
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 줄이기 전 원본
const MAX_IMAGE_BYTES = 1_500_000
const MAX_SIDE = 1024

export function checkImageFile(file) {
  if (!IMAGE_TYPES.includes(file.type)) return 'JPG, PNG, WebP 사진만 올릴 수 있어요.'
  if (file.size > MAX_FILE_BYTES) return '사진은 10MB 이하만 올릴 수 있어요.'
  return ''
}

async function loadImage(url) {
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    throw new Error('이미지를 읽지 못했어요.')
  }
  return img
}

// 캔버스를 JPEG data URL로. 투명한 부분은 흰 배경으로 채운다 (JPEG는 투명도가 없다)
function canvasToJpeg(canvas, draw) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  draw(ctx)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  // base64는 원래 크기의 약 4/3
  if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('이미지가 너무 커요.')
  return dataUrl
}

// 긴 변을 1024px로 줄여 JPEG data URL로 바꾼다 (올린 사진·AI가 그린 그림 모두)
export async function toJpegDataUrl(source) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    return canvasToJpeg(canvas, (ctx) => ctx.drawImage(img, 0, 0, canvas.width, canvas.height))
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

// 영상 첫 장면: 대표 이미지를 영상 비율(16:9, 1280×720)에 맞게 가운데를 잘라 쓴다
export async function toVideoFrame(url, width = 1280, height = 720) {
  const img = await loadImage(url)
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvasToJpeg(canvas, (ctx) => ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h))
}
