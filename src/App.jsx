import { useEffect, useState } from 'react'
import IdeaForm from './IdeaForm.jsx'
import IdeaCard from './IdeaCard.jsx'
import { createIdea, deleteIdea, fetchIdeas, migrateLegacyIdeas } from './api.js'

export default function App() {
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let ignore = false

    async function load() {
      try {
        // 예전에 브라우저에만 저장했던 아이디어가 있으면 먼저 서버로 옮긴다
        await migrateLegacyIdeas()
        const data = await fetchIdeas()
        if (!ignore) setIdeas(data)
      } catch (err) {
        if (!ignore) setLoadError(`목록을 불러오지 못했습니다. ${err.message}`)
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  // 서버 저장이 끝난 뒤에 화면에 추가한다. 실패하면 IdeaForm이 에러를 보여 준다.
  async function addIdea(idea) {
    const saved = await createIdea(idea)
    setIdeas((prev) => [saved, ...prev])
  }

  async function removeIdea(id) {
    try {
      await deleteIdea(id)
      setIdeas((prev) => prev.filter((idea) => idea.id !== id))
    } catch (err) {
      window.alert(`삭제하지 못했습니다. ${err.message}`)
    }
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

        {loading ? (
          <p className="empty">불러오는 중…</p>
        ) : loadError ? (
          <p className="empty error">{loadError}</p>
        ) : ideas.length === 0 ? (
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
