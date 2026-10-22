import { useEffect, useState } from 'react'
import { fetchWeather } from './api.js'

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
}

// 날씨는 아이디어 목록과 따로 불러온다. 실패해도 목록에는 영향이 없다.
export default function WeatherCard() {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    fetchWeather()
      .then((data) => !ignore && setWeather(data))
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [])

  return (
    <section className="widget" aria-label="천안 현재 날씨">
      <h2 className="widget-title">천안 현재 날씨</h2>

      {error ? (
        <p className="widget-message error">{error}</p>
      ) : !weather ? (
        <p className="widget-message">불러오는 중…</p>
      ) : (
        <>
          <p className="weather-now">
            <span className="weather-temp">{weather.temperature ?? '-'}°</span>
            <span className="weather-precip">{weather.precipType}</span>
          </p>
          <dl className="weather-detail">
            <div>
              <dt>습도</dt>
              <dd>{weather.humidity ?? '-'}%</dd>
            </div>
            <div>
              <dt>바람</dt>
              <dd>
                {weather.windDir ?? ''} {weather.windSpeed ?? '-'}m/s
              </dd>
            </div>
            <div>
              <dt>1시간 강수</dt>
              <dd>{weather.rain1h}mm</dd>
            </div>
          </dl>
          <p className="widget-source">{formatTime(weather.observedAt)} 관측 · 기상청</p>
        </>
      )}
    </section>
  )
}
