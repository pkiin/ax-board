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

export default function IdeaCard({ idea, onDelete }) {
  return (
    <li className="card">
      <div className="card-head">
        <h3 className="card-title">{idea.title}</h3>
        <button
          type="button"
          className="delete"
          onClick={() => onDelete(idea.id)}
          aria-label={`${idea.title} 삭제`}
        >
          삭제
        </button>
      </div>

      <dl className="card-body">
        <dt>대상 업무</dt>
        <dd>{idea.target}</dd>
        <dt>AI 활용 아이디어</dt>
        <dd className="card-idea">{idea.idea}</dd>
      </dl>

      {idea.createdAt && <p className="card-date">{formatDate(idea.createdAt)} 등록</p>}
    </li>
  )
}
