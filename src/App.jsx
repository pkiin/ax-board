import { useEffect, useState } from 'react'
import IdeaForm from './IdeaForm.jsx'
import IdeaCard from './IdeaCard.jsx'
import { loadIdeas, saveIdeas } from './storage.js'

export default function App() {
  const [ideas, setIdeas] = useState(loadIdeas)

  useEffect(() => {
    saveIdeas(ideas)
  }, [ideas])

  function addIdea(idea) {
    setIdeas((prev) => [idea, ...prev])
  }

  function removeIdea(id) {
    setIdeas((prev) => prev.filter((idea) => idea.id !== id))
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          우리 팀 AX 보드 - A <span className="count">아이디어 {ideas.length}개</span>
        </h1>
        <p className="page-subtitle">
          업무에 AI를 어떻게 활용할지 아이디어를 모아 두는 공간입니다.
        </p>
      </header>

      <IdeaForm onAdd={addIdea} />

      <section className="board">
        <h2 className="board-title">
          아이디어 목록
        </h2>

        {ideas.length === 0 ? (
          <p className="empty">아직 아이디어가 없어요</p>
        ) : (
          <ul className="card-list">
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onDelete={removeIdea} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
