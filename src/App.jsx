import { useEffect, useState } from 'react'
import IdeaForm from './IdeaForm.jsx'
import IdeaCard from './IdeaCard.jsx'
import WeatherCard from './WeatherCard.jsx'
import NewsCard from './NewsCard.jsx'
import StockCard from './StockCard.jsx'
import BriefingCard from './BriefingCard.jsx'
import SettingsDialog from './SettingsDialog.jsx'
import { loadMediaModels, loadModel, saveMediaModels, saveModel } from './aiSettings.js'
import { createIdea, deleteIdea, fetchIdeas, migrateLegacyIdeas } from './api.js'

export default function App() {
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [aiModel, setAiModel] = useState(loadModel)
  const [mediaModels, setMediaModels] = useState(loadMediaModels) // { vision, image, speech, transcription }
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // AI 기획안을 적용하면 서버가 돌려준 카드로 바꾼다
  function updateIdea(saved) {
    setIdeas((prev) => prev.map((idea) => (idea.id === saved.id ? saved : idea)))
  }

  function changeModels({ text, ...media }) {
    setAiModel(text)
    saveModel(text)
    setMediaModels(media)
    saveMediaModels(media)
    setSettingsOpen(false)
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
      {/* 왼쪽 "오늘의 정보" 영역: 브리핑 → 날씨 → 뉴스 → 주가. 카드마다 따로 불러와 서로 기다리지 않는다 */}
      <aside className="side" aria-labelledby="side-title">
        <h2 id="side-title" className="side-title">오늘의 정보</h2>
        <BriefingCard aiModel={aiModel} speechModel={mediaModels.speech} />
        <WeatherCard />
        <NewsCard />
        <StockCard />
      </aside>

      <main className="main">
        <header className="page-header">
          <button
            type="button"
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="AI 설정"
            title={`AI 설정 (지금 모델: ${aiModel.name})`}
          >
            ⚙
          </button>
          <h1>
            우리 팀 AX 보드 - A <span className="count">아이디어 {ideas.length}개</span>
          </h1>
          <p className="page-subtitle">
            업무에 AI를 어떻게 활용할지 아이디어를 모아 두는 공간입니다.
          </p>
        </header>

        <IdeaForm onAdd={addIdea} transcriptionModel={mediaModels.transcription} />

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
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  aiModel={aiModel}
                  mediaModels={mediaModels}
                  onDelete={removeIdea}
                  onUpdate={updateIdea}
                />
              ))}
            </ul>
          )}
        </section>
      </main>

      <SettingsDialog
        open={settingsOpen}
        model={aiModel}
        mediaModels={mediaModels}
        onSave={changeModels}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
