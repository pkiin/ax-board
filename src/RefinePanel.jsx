import { formatUsd } from './aiSettings.js'
import { PROPOSAL_SECTIONS } from './proposal.js'

export function ProposalView({ proposal }) {
  return (
    <dl className="card-body proposal">
      {PROPOSAL_SECTIONS.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd className={key === 'difficulty' ? `difficulty ${proposal.difficulty}` : 'card-idea'}>{proposal[key]}</dd>
        </div>
      ))}
    </dl>
  )
}

// 원래 내용과 AI 기획안을 나란히 보여 주고, 적용 여부를 고르게 한다
export default function RefinePanel({ idea, result, applying, error, onApply, onCancel }) {
  return (
    <div className="refine">
      <div className="refine-columns">
        <section className="refine-col">
          <h4>원래 내용</h4>
          <p className="refine-title">{idea.title}</p>
          <dl className="card-body">
            <dt>대상 업무</dt>
            <dd>{idea.target}</dd>
            <dt>AI 활용 아이디어</dt>
            <dd className="card-idea">{idea.idea}</dd>
          </dl>
        </section>
        <section className="refine-col refined">
          <h4>AI 기획안</h4>
          <p className="refine-title">{result.proposal.title}</p>
          <ProposalView proposal={result.proposal} />
        </section>
      </div>

      <p className="refine-meta">
        {result.model} · 비용 {formatUsd(result.cost)}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="refine-actions">
        <button type="button" className="button-secondary" onClick={onCancel} disabled={applying}>
          취소
        </button>
        <button type="button" className="button-primary" onClick={onApply} disabled={applying}>
          {applying ? '저장 중…' : '적용'}
        </button>
      </div>
    </div>
  )
}
