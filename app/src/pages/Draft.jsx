import { useState } from 'react'
import { useApi } from '../hooks'
import { api } from '../api'
import Spinner from '../components/Spinner'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]

export default function Draft() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const { data, loading, error } = useApi(() => api.draft(year), [year])

  const picks = data?.picks ?? []
  const rounds = [...new Set(picks.map(p => p.round))].sort((a, b) => a - b)
  const hasPlayers = picks.some(p => p.player)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Draft Board</h1>
        <div className="year-selector">
          {YEARS.map(y => (
            <button
              key={y}
              className={'filter-btn' + (year === y ? ' active' : '')}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {!loading && !hasPlayers && picks.length > 0 && (
        <div className="notice">
          Draft order is set for {year}. Player names will appear after the draft.
        </div>
      )}

      {loading ? (
        <div className="page-loading"><Spinner /></div>
      ) : error ? (
        <div className="page-error">Failed to load draft: {error}</div>
      ) : picks.length === 0 ? (
        <div className="card empty-state"><p>No draft data available for {year}.</p></div>
      ) : (
        <div className="draft-rounds">
          {rounds.map(round => {
            const roundPicks = picks.filter(p => p.round === round)
            return (
              <div key={round} className="card draft-round">
                <div className="round-header">Round {round}</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th className="align-left">Team</th>
                      {hasPlayers && <th className="align-left">Player</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {roundPicks.map(pick => (
                      <tr key={pick.pickNum}>
                        <td className="rank-cell">{pick.pickNum}</td>
                        <td className="team-name-cell">{pick.team}</td>
                        {hasPlayers && (
                          <td>{pick.player ?? <span className="text-muted">—</span>}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
