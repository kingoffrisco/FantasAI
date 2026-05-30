import { useApi } from '../hooks'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function Standings() {
  const { data: teamsData, loading, error } = useApi(api.teams)
  const { data: leagueData } = useApi(api.league)

  if (loading) return <div className="page-loading"><Spinner /></div>
  if (error) return <div className="page-error">Failed to load standings: {error}</div>

  const teams = teamsData?.teams ?? []
  const league = leagueData?.league

  return (
    <div className="page">
      <div className="page-header">
        <h1>{league?.name ?? 'Standings'}</h1>
        <span className="badge">{league?.season ?? ''} Season · {league?.scoring ?? ''}</span>
      </div>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="align-left">Team</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th>PCT</th>
              <th>PF</th>
              <th>PA</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, i) => {
              const played = team.w + team.l + team.t
              const pct = played > 0 ? (team.w / played).toFixed(3) : '—'
              return (
                <tr key={team.id}>
                  <td className="rank-cell">{i + 1}</td>
                  <td className="team-name-cell">{team.name}</td>
                  <td>{team.w}</td>
                  <td>{team.l}</td>
                  <td>{team.t}</td>
                  <td>{pct}</td>
                  <td>{team.pf.toFixed(1)}</td>
                  <td>{team.pa.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
