import { NFL_TEAMS } from '../lib/data.js';

export const PosBadge = ({ pos, solid }) => (
  <span className={`pos-badge pos-${pos} ${solid ? 'solid' : ''}`}>{pos}</span>
);

export const StatusDot = ({ status }) => {
  if (!status || status === 'OK') return null;
  const titles = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured Reserve' };
  return <span className={`status-dot status-${status}`} title={titles[status]} />;
};

export const PlayerAvatar = ({ player, size, src }) => {
  const team = NFL_TEAMS.find(t => t.abbr === player.team) || { color: '#333' };
  const initials = player.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const sizeClass = size === 'lg' ? 'lg' : size === 'xl' ? 'xl' : '';
  return (
    <div className={`avatar ${sizeClass}`} style={{
      background: `linear-gradient(135deg, ${team.color}cc, ${team.color}55)`,
      position: 'relative', overflow: 'hidden',
    }}>
      <span className="stripe"></span>
      <span style={{ position: 'relative', zIndex: 1 }}>{initials}</span>
      {src && (
        <img
          src={src}
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

export const PlayerCell = ({ player, showStatus = true, watched = false }) => (
  <div className="player-cell">
    <PlayerAvatar player={player} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div className={`player-name${watched ? ' watched' : ''}`}>
        {watched && <span style={{ marginRight: 4, fontSize: 11 }}>★</span>}
        {showStatus && <StatusDot status={player.status} />} {player.name}
      </div>
      <div className="player-meta">
        <PosBadge pos={player.pos} /> {player.team} · #{player.num} · BYE {player.bye}
      </div>
    </div>
  </div>
);

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
