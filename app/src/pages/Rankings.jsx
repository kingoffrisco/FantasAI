import { useState } from 'react'
import { useApi } from '../hooks'
import { api } from '../api'
import Spinner from '../components/Spinner'

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST']

const POS_COLOR = {
  QB:  '#ef4444',
  RB:  '#3b82f6',
  WR:  '#f59e0b',
  TE:  '#8b5cf6',
  K:   '#6b7280',
  DST: '#10b981',
}

export default function Rankings() {
  const [pos, setPos] = useState('ALL')
  const { data, loading, error } = useApi(() => api.rankings(pos), [pos])

  const rankings = data?.rankings ?? []

  return (
    <div className="page">
      <div className="page-header">
        <h1>Expert Rankings</h1>
        <span className="badge">CBS Consensus · 2026</span>
      </div>

      <div className="filter-bar">
        {POSITIONS.map(p => (
          <button
            key={p}
            className={'filter-btn' + (pos === p ? ' active' : '')}
            onClick={() => setPos(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="page-loading"><Spinner /></div>
      ) : error ? (
        <div className="page-error">Failed to load rankings: {error}</div>
      ) : (
        <div className="card">
          <div className="table-meta">{data?.count ?? 0} players</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th className="align-left">Player</th>
                <th>Pos</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(player => (
                <tr key={`${player.rank}-${player.playerId}`}>
                  <td className="rank-cell">{player.rank}</td>
                  <td className="player-name-cell">{player.name}</td>
                  <td>
                    <span
                      className="pos-badge"
                      style={{ backgroundColor: POS_COLOR[player.pos] ?? '#6b7280' }}
                    >
                      {player.pos}
                    </span>
                  </td>
                  <td className="team-abbr">{player.team}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
