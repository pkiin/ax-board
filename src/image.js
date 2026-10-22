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

// 긴 변을 1024px로 줄여 JPEG data URL로 바꾼다 (올린 사진·AI가 그린 그림 모두)
export async function toJpegDataUrl(source) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error('이미지를 읽지 못했어요.')
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    // 투명한 부분은 흰 배경으로 채운다 (JPEG는 투명도가 없다)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    // base64는 원래 크기의 약 4/3
    if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('이미지가 너무 커요.')
    return dataUrl
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}
