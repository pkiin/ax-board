import { useState } from 'react'
import { applyProposal, refineIdea } from './api.js'
import RefinePanel, { ProposalView } from './RefinePanel.jsx'

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

export default function IdeaCard({ idea, aiModel, onDelete, onUpdate }) {
  const [refining, setRefining] = useState(false)
  const [result, setResult] = useState(null) // 아직 적용하지 않은 다듬기 결과
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

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

  const proposal = idea.proposal

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
