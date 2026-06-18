import { NFL_TEAMS, SOURCE_META } from '../lib/data.js';

export const PosBadge = ({ pos, solid }) => (
  <span className={`pos-badge pos-${pos} ${solid ? 'solid' : ''}`}>{pos}</span>
);

export const SourceBadge = ({ source }) => {
  const color = SOURCE_META[source]?.color || '#888';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: color + '1a', border: `1px solid ${color}40`,
      color, borderRadius: 4, padding: '1px 7px',
      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '.04em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {source}
    </span>
  );
};

export const StatusDot = ({ status }) => {
  if (!status || status === 'OK') return null;
  const titles = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured Reserve' };
  return <span className={`status-dot status-${status}`} title={titles[status]} />;
};

export const PlayerAvatar = ({ player, size, src }) => {
  const team = NFL_TEAMS.find(t => t.abbr === player.team) || { color: '#333' };
  const initials = player.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const sizeClass = size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : '';
  const imgSrc = src || (player.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg` : null);
  return (
    <div className={`avatar ${sizeClass}`} style={{
      background: `linear-gradient(135deg, ${team.color}cc, ${team.color}55)`,
      position: 'relative', overflow: 'hidden',
    }}>
      <span className="stripe"></span>
      <span style={{ position: 'relative', zIndex: 1 }}>{initials}</span>
      {imgSrc && (
        <img
          src={imgSrc}
          alt={player.name}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'top center', zIndex: 2,
          }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      )}
    </div>
  );
};

const TIER_STYLE = {
  Elite: { color: '#FFD700', bg: 'rgba(255,215,0,.15)', border: 'rgba(255,215,0,.4)' },
  High:  { color: '#4caf82', bg: 'rgba(76,175,130,.15)', border: 'rgba(76,175,130,.4)' },
  Mid:   { color: 'var(--accent-2)', bg: 'rgba(100,180,255,.12)', border: 'rgba(100,180,255,.3)' },
  Low:   { color: 'var(--text-faint)', bg: 'transparent', border: 'rgba(255,255,255,.1)' },
};

export const PlayerCell = ({ player, showStatus = true, watched = false, ownerTeam = null, isOnMyRoster = false }) => {
  const tierKey = player.seasonTier ? player.seasonTier.charAt(0).toUpperCase() + player.seasonTier.slice(1).toLowerCase() : null;
  const ts = tierKey && TIER_STYLE[tierKey] ? TIER_STYLE[tierKey] : null;
  return (
    <div className="player-cell">
      <PlayerAvatar player={player} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={`player-name${watched ? ' watched' : ''}`}>
          {watched && <span style={{ marginRight: 4, fontSize: 11 }}>★</span>}
          {showStatus && <StatusDot status={player.status} />} {player.name}
          {player.rookie && <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 800, color: '#4ea8ff', background: 'rgba(78,168,255,.15)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 3, padding: '1px 4px', verticalAlign: 'middle' }}>R</span>}
          {ownerTeam && (
            <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: isOnMyRoster ? 'var(--accent)' : ownerTeam.color || 'var(--text-dim)', verticalAlign: 'middle' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: isOnMyRoster ? 'var(--accent)' : (ownerTeam.color || '#666'), display: 'inline-block', flexShrink: 0 }} />
              {isOnMyRoster ? 'My Team' : ownerTeam.name}
            </span>
          )}
          {ts && tierKey !== 'Low' && (
            <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, borderRadius: 3, padding: '1px 4px', verticalAlign: 'middle' }}>{tierKey.toUpperCase()}</span>
          )}
        </div>
        <div className="player-meta">
          <PosBadge pos={player.pos} /> {player.team} · #{player.num} · BYE {player.bye}
        </div>
      </div>
    </div>
  );
};

export const Sparkline = ({ data, color = 'var(--accent)', width = 60, height = 18 }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  const last = data[data.length - 1];
  const lastX = (data.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 2) - 1;
  const trend = data[data.length - 1] - data[0];
  const stroke = trend > 1 ? 'var(--good)' : trend < -1 ? 'var(--danger)' : 'var(--text-dim)';
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={points} />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
};

export const ProjBar = ({ value, max = 30 }) => (
  <span className="proj-bar"><span style={{ width: `${Math.min(100, (value / max) * 100)}%` }}></span></span>
);

export const Delta = ({ from, to }) => {
  const d = to - from;
  if (Math.abs(d) < 0.1) return <span className="delta-flat mono">—</span>;
  const cls = d > 0 ? 'delta-up' : 'delta-down';
  return <span className={`${cls} mono`}>{d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}</span>;
};

export const AIHint = ({ children }) => <span className="ai-inline">{children}</span>;

export const TeamLogoBadge = ({ team, size = 36 }) => {
  const prefs = (!team) ? (() => { try { return JSON.parse(localStorage.getItem('fantasai_team_prefs') || 'null') || {}; } catch { return {}; } })() : {};
  const color    = prefs.color    ?? team?.color ?? 'var(--accent)';
  const logo     = prefs.logo     ?? team?.logo  ?? (team?.name ? team.name.slice(0, 2).toUpperCase() : '??');
  const logoImg  = prefs.logoImg  ?? team?.logoImg ?? null;
  const textColor = prefs.logoTextColor ?? (team?.color ? '#ffffff' : '#000000');
  const radius = Math.round(size * 0.28);
  return logoImg ? (
    <img src={logoImg} alt={logo} style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: radius, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.32), fontWeight: 900, color: textColor, flexShrink: 0, letterSpacing: '-0.04em' }}>
      {(logo || '??').slice(0, 2).toUpperCase()}
    </span>
  );
};
