import { useState } from 'react'
import { useApi } from '../hooks'
import { api } from '../api'
import Spinner from '../components/Spinner'

const POS_COLOR = {
  QB:  '#ef4444',
  RB:  '#3b82f6',
  WR:  '#f59e0b',
  TE:  '#8b5cf6',
  K:   '#6b7280',
  DST: '#10b981',
}

export default function Rosters() {
  const { data: teamsData, loading: teamsLoading } = useApi(api.teams)
  const { data: rostersData, loading: rostersLoading, error: rostersError } = useApi(api.rosters)
  const [selectedId, setSelectedId] = useState(null)

  if (teamsLoading) return <div className="page-loading"><Spinner /></div>

  const teams = teamsData?.teams ?? []
  const rosters = rostersData?.rosters ?? {}
  const currentId = selectedId ?? teams[0]?.id
  const roster = rosters[currentId] ?? []
  const teamName = teams.find(t => t.id === currentId)?.name

  return (
    <div className="page">
      <div className="page-header">
        <h1>Rosters</h1>
      </div>

      <div className="notice">
        Roster parser will be tuned once CBS populates rosters in August. Showing any available data below.
      </div>

      <div className="team-selector">
        <select
          className="team-select"
          value={currentId ?? ''}
          onChange={e => setSelectedId(e.target.value)}
        >
          {teams.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {rostersLoading ? (
        <div className="page-loading"><Spinner /></div>
      ) : rostersError ? (
        <div className="page-error">Failed to load rosters: {rostersError}</div>
      ) : roster.length === 0 ? (
        <div className="card empty-state">
          <p>No roster data for {teamName} yet.</p>
        </div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th className="align-left">Slot</th>
                <th className="align-left">Player</th>
                <th>Pos</th>
                <th className="align-left">NFL Team</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player, i) => (
                <tr key={i}>
                  <td className="text-muted">{player.slot || '—'}</td>
                  <td className="player-name-cell">{player.name}</td>
                  <td>
                    <span
                      className="pos-badge"
                      style={{ backgroundColor: POS_COLOR[player.pos] ?? '#6b7280' }}
                    >
                      {player.pos || '—'}
                    </span>
                  </td>
                  <td>{player.team || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
