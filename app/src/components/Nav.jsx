import { NavLink } from 'react-router-dom'

export default function Nav() {
  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="nav-logo">🏈</span>
        <span className="nav-title">FantasAI</span>
        <span className="nav-league">ATO Tau League</span>
      </div>
      <div className="nav-links">
        <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Standings</NavLink>
        <NavLink to="/rankings"  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Rankings</NavLink>
        <NavLink to="/draft"     className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Draft</NavLink>
        <NavLink to="/rosters"   className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Rosters</NavLink>
      </div>
    </nav>
  )
}
