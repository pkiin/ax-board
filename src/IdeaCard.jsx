import { useEffect, useRef, useState } from 'react'
import { applyProposal, deleteImage, describePhoto, drawImage, refineIdea, saveImage, speakIdea } from './api.js'
import { formatUsd } from './aiSettings.js'
import { IMAGE_TYPES, checkImageFile, toJpegDataUrl } from './image.js'
import RefinePanel, { ProposalView } from './RefinePanel.jsx'
import ImagePanel from './ImagePanel.jsx'

function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OriginalBody({ idea }) {
  return (
    <dl className="card-body">
      <dt>대상 업무</dt>
      <dd>{idea.target}</dd>
      <dt>AI 활용 아이디어</dt>
      <dd className="card-idea">{idea.idea}</dd>
    </dl>
  )
}

export default function IdeaCard({ idea, aiModel, mediaModels, onDelete, onUpdate }) {
  const [refining, setRefining] = useState(false)
  const [result, setResult] = useState(null) // 아직 적용하지 않은 다듬기 결과
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  // 대표 이미지: 사진 설명(describe)·그리기(draw) 중인지, 아직 적용하지 않은 결과
  const fileRef = useRef(null)
  const [imageBusy, setImageBusy] = useState(null) // 'describe' | 'draw' | 'save' | null
  const [pendingImage, setPendingImage] = useState(null) // { kind, image, caption?, model, cost }
  const [imageError, setImageError] = useState('')
  // 읽어 주기: 받은 음성(blob URL)과 모델·목소리·비용
  const [speech, setSpeech] = useState(null) // { url, model, voice, cost }
  const [speaking, setSpeaking] = useState(false)
  const [speechError, setSpeechError] = useState('')

  // 새 음성을 받거나 카드가 사라지면 이전 음성 주소를 해제한다
  useEffect(() => () => speech && URL.revokeObjectURL(speech.url), [speech])

  function handleDelete() {
    // 실수로 지우지 않도록 삭제 전에 한 번 확인한다
    if (window.confirm(`'${idea.title}' 아이디어를 삭제할까요?`)) {
      onDelete(idea.id)
    }
  }

  async function handleRefine() {
    setRefining(true)
    setError('')
    try {
      setResult(await refineIdea(idea.id, aiModel.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setRefining(false)
    }
  }

  // 서버에 저장된 뒤에 카드에 반영한다. 실패하면 결과를 그대로 두고 다시 적용할 수 있다
  async function handleApply() {
    setApplying(true)
    setError('')
    try {
      onUpdate(await applyProposal(idea.id, result.proposal))
      setResult(null)
    } catch (err) {
      setError(`저장하지 못했습니다. ${err.message}`)
    } finally {
      setApplying(false)
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 동작하게
    if (!file) return
    const problem = checkImageFile(file)
    if (problem) return setImageError(problem)
    const model = mediaModels.vision
    if (!model.free && !window.confirm(`유료 모델(${model.name})입니다. 1회 약 ${formatUsd(model.estimate)}가 듭니다. 설명할까요?`)) return

    setImageBusy('describe')
    setImageError('')
    try {
      // 올리기 전에 줄여서 보낸다. 적용할 때도 이 이미지를 그대로 저장한다
      const image = await toJpegDataUrl(file)
      const { caption, model: usedModel, cost } = await describePhoto(idea.id, model.id, image)
      setPendingImage({ kind: 'photo', image, caption, model: usedModel, cost })
    } catch (err) {
      setImageError(err.message)
    } finally {
      setImageBusy(null)
    }
  }

  async function handleDraw() {
    const model = mediaModels.image
    if (!model.free && !window.confirm(`유료 모델(${model.name})입니다. 1장 약 ${formatUsd(model.estimate)}가 듭니다. 그릴까요?`)) return

    setImageBusy('draw')
    setImageError('')
    try {
      const { image, model: usedModel, cost } = await drawImage(idea.id, model.id)
      setPendingImage({ kind: 'generated', image, model: usedModel, cost })
    } catch (err) {
      setImageError(err.message)
    } finally {
      setImageBusy(null)
    }
  }

  // 서버에 저장된 뒤에 카드에 반영한다. 실패하면 미리보기를 그대로 두고 다시 적용할 수 있다
  async function handleApplyImage() {
    setImageBusy('save')
    setImageError('')
    try {
      const { kind, caption, model } = pendingImage
      // 그린 이미지는 크기가 커서 사진과 같이 줄여 저장한다
      const image = kind === 'generated' ? await toJpegDataUrl(pendingImage.image) : pendingImage.image
      onUpdate(await saveImage(idea.id, { kind, image, caption, model }))
      setPendingImage(null)
    } catch (err) {
      setImageError(`저장하지 못했습니다. ${err.message}`)
    } finally {
      setImageBusy(null)
    }
  }

  async function handleRemoveImage() {
    if (!window.confirm('대표 이미지를 지울까요?')) return
    setImageError('')
    try {
      onUpdate(await deleteImage(idea.id))
    } catch (err) {
      setImageError(`지우지 못했습니다. ${err.message}`)
    }
  }

  async function handleSpeak() {
    const { id, voice } = mediaModels.speech
    setSpeaking(true)
    setSpeechError('')
    try {
      setSpeech(await speakIdea(idea.id, id, voice ?? undefined))
    } catch (err) {
      setSpeechError(err.message)
    } finally {
      setSpeaking(false)
    }
  }

  const proposal = idea.proposal
  const image = idea.image

  return (
    <li className="card">
      <div className="card-head">
        <h3 className="card-title">{proposal ? proposal.title : idea.title}</h3>
        <div className="card-actions">
          <button
            type="button"
            className="refine-button"
            onClick={handleRefine}
            disabled={refining || applying}
            title={aiModel.free ? aiModel.id : `${aiModel.id} (유료 모델, 비용이 듭니다)`}
          >
            {refining ? '다듬는 중…' : proposal ? '다시 다듬기' : 'AI로 다듬기'}
            {!aiModel.free && <span className="paid-badge">유료</span>}
          </button>
          <button
            type="button"
            className="delete"
            onClick={handleDelete}
            aria-label={`${idea.title} 삭제`}
          >
            삭제
          </button>
        </div>
      </div>

      {image && (
        <figure className="card-figure">
          <img src={image.url} alt={image.caption ?? `${proposal ? proposal.title : idea.title} 대표 이미지`} loading="lazy" />
          {image.caption && <figcaption>{image.caption}</figcaption>}
        </figure>
      )}

      <div className="card-tools">
        <button
          type="button"
          className="tool-button"
          onClick={handleSpeak}
          disabled={speaking}
          title={`카드 내용을 소리 내어 읽습니다 (${mediaModels.speech.id}${mediaModels.speech.voice ? `, ${mediaModels.speech.voice}` : ''})`}
        >
          {speaking ? '읽을 준비 중…' : '🔊 읽어 주기'}
          {!mediaModels.speech.free && <span className="paid-badge">유료</span>}
        </button>
        <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={handlePhoto} />
        <button
          type="button"
          className="tool-button"
          onClick={() => fileRef.current.click()}
          disabled={imageBusy !== null}
          title={`사진을 올리면 AI가 한 문장으로 설명합니다 (${mediaModels.vision.id})`}
        >
          {imageBusy === 'describe' ? '설명하는 중…' : '사진 올리기'}
          {!mediaModels.vision.free && <span className="paid-badge">유료</span>}
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={handleDraw}
          disabled={imageBusy !== null}
          title={`카드 제목으로 대표 이미지를 그립니다 (${mediaModels.image.id})`}
        >
          {imageBusy === 'draw' ? '그리는 중…' : '이미지 그리기'}
          {!mediaModels.image.free && <span className="paid-badge">유료</span>}
        </button>
        {image && (
          <button type="button" className="tool-button subtle" onClick={handleRemoveImage} disabled={imageBusy !== null}>
            이미지 지우기
          </button>
        )}
      </div>
      {speechError && <p className="error card-error">{speechError}</p>}
      {speech && (
        <div className="speech">
          <audio src={speech.url} controls autoPlay />
          <p className="refine-meta">
            {speech.model}
            {speech.voice && ` · ${speech.voice}`} · 비용 약 {formatUsd(speech.cost)}
          </p>
        </div>
      )}
      {imageError && !pendingImage && <p className="error card-error">{imageError}</p>}
      {pendingImage && (
        <ImagePanel
          pending={pendingImage}
          replacing={Boolean(image)}
          applying={imageBusy === 'save'}
          error={imageError}
          onApply={handleApplyImage}
          onCancel={() => {
            setPendingImage(null)
            setImageError('')
          }}
        />
      )}

      {proposal ? (
        <>
          <ProposalView proposal={proposal} />
          <details className="original">
            <summary>원래 내용 보기</summary>
            <p className="refine-title">{idea.title}</p>
            <OriginalBody idea={idea} />
          </details>
        </>
      ) : (
        <OriginalBody idea={idea} />
      )}

      {error && !result && <p className="error card-error">{error}</p>}
      {result && (
        <RefinePanel
          idea={idea}
          result={result}
          applying={applying}
          error={error}
          onApply={handleApply}
          onCancel={() => {
            setResult(null)
            setError('')
          }}
        />
      )}

      {idea.createdAt && <p className="card-date">{formatDate(idea.createdAt)} 등록</p>}
    </li>
  )
}
