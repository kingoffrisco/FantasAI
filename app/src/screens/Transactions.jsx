import React from 'react';
import { api } from '../api.js';
import { LEAGUE_TEAMS } from '../lib/data.js';

const CATEGORY_LABELS = {
  schedule:  { label: 'Schedule',  color: '#ffb547' },
  scoring:   { label: 'Scoring',   color: '#4ea8ff' },
  roster:    { label: 'Roster',    color: '#c084fc' },
  waivers:   { label: 'Waivers',   color: '#34d399' },
  playoffs:  { label: 'Playoffs',  color: '#f87171' },
  general:   { label: 'General',   color: 'var(--text-faint)' },
  matchup:   { label: 'Matchup',   color: '#ffb547' },
  fees:      { label: 'Fees',      color: '#34d399' },
  draft:     { label: 'Draft',     color: '#a78bfa' },
  events:    { label: 'Events',    color: '#60a5fa' },
  divisions: { label: 'Divisions', color: '#ffb547' },
};

const TYPE_META = {
  add:          { icon: '➕', label: 'Add',        color: '#4caf82' },
  drop:         { icon: '➖', label: 'Drop',       color: '#ff5a6e' },
  trade:        { icon: '↔',  label: 'Trade',      color: '#4ea8ff' },
  trade_offer:  { icon: '📩', label: 'Trade Offer', color: '#ffb547' },
  league_settings: { icon: '⚙', label: 'Settings', color: '#c6ff3a' },
};

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1d ago' : `${d}d ago`;
}

function TxnRow({ tx }) {
  const meta = TYPE_META[tx.type] || { icon: '◈', label: tx.type, color: 'var(--text-faint)' };
  const isSettings = tx.type === 'league_settings';
  const isHighlight = isSettings && tx.highlight;
  const catInfo = isSettings ? (CATEGORY_LABELS[tx.category] || CATEGORY_LABELS.general) : null;

  return (
    <div style={{
      padding: '12px 18px',
      borderBottom: '1px solid var(--border)',
      background: isHighlight ? 'rgba(255,181,71,.07)' : 'transparent',
      borderLeft: isHighlight ? '3px solid #ffb547' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Icon */}
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: `${meta.color}18`, border: `1px solid ${meta.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13,
        }}>
          {meta.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>
              {meta.label.toUpperCase()}
            </span>
            {catInfo && (
              <span style={{ fontSize: 9, fontWeight: 800, color: catInfo.color, background: `${catInfo.color}20`, border: `1px solid ${catInfo.color}40`, borderRadius: 3, padding: '1px 6px', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>
                {catInfo.label.toUpperCase()}
              </span>
            )}
            {isHighlight && (
              <span style={{ fontSize: 9, fontWeight: 800, color: '#ffb547', background: 'rgba(255,181,71,.2)', border: '1px solid rgba(255,181,71,.4)', borderRadius: 3, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>
                ★ HIGHLIGHTED
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              {timeAgo(tx.timestamp)}
            </span>
          </div>

          {/* Team / By */}
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: isSettings ? 4 : 0 }}>
            {isSettings ? (
              <span>
                <strong style={{ color: 'var(--text)' }}>{tx.changedBy || tx.teamName || 'Commissioner'}</strong>
                {' · '}
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                  {new Date(tx.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </span>
            ) : (() => {
              const team = LEAGUE_TEAMS.find(t => String(t.id) === String(tx.teamId));
              return (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {team && <span style={{ width: 18, height: 18, borderRadius: 4, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{team.logo}</span>}
                  <strong style={{ color: 'var(--text)' }}>{tx.teamName || 'Unknown Team'}</strong>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                    · {new Date(tx.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </span>
              );
            })()}
          </div>

          {/* Description */}
          {isSettings && tx.description && (
            <div style={{ fontSize: 12, color: isHighlight ? '#ffb547' : 'var(--text-dim)', lineHeight: 1.5 }}>
              {tx.description}
            </div>
          )}

          {/* Player add/drop */}
          {(tx.type === 'add' || tx.type === 'drop') && tx.players?.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 800, color: tx.type === 'add' ? '#4caf82' : '#ff5a6e', width: 30 }}>
                {tx.type === 'add' ? 'ADD' : 'DROP'}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.pos} · {p.nflTeam}</span>
            </div>
          ))}

          {/* Trade */}
          {(tx.type === 'trade' || tx.type === 'trade_offer') && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {tx.gave?.length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#ff5a6e', fontFamily: 'var(--font-mono)', marginRight: 8 }}>GAVE</span>
                  {tx.gave.map((p, i) => <span key={i} style={{ color: 'var(--text)', marginRight: 8 }}>{p.name} <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>({p.pos})</span></span>)}
                </div>
              )}
              {tx.got?.length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#4caf82', fontFamily: 'var(--font-mono)', marginRight: 8 }}>GOT</span>
                  {tx.got.map((p, i) => <span key={i} style={{ color: 'var(--text)', marginRight: 8 }}>{p.name} <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>({p.pos})</span></span>)}
                </div>
              )}
              {tx.type === 'trade_offer' && (
                <div style={{ fontSize: 10, color: '#ffb547', fontFamily: 'var(--font-mono)', marginTop: 2 }}>Offer sent to {tx.otherTeamName || 'opponent'}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'roster',   label: 'Roster Moves' },
  { id: 'trades',   label: 'Trades' },
  { id: 'settings', label: 'Settings Changes' },
];

export default function TransactionsScreen() {
  const [txns, setTxns] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [filter, setFilter] = React.useState('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.transactions.get();
      const arr = Array.isArray(data) ? data : (data?.transactions || []);
      setTxns(arr.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
    } catch {
      setError('Could not load transactions. The worker may be offline.');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  const filtered = React.useMemo(() => {
    if (filter === 'all') return txns;
    if (filter === 'roster') return txns.filter(t => t.type === 'add' || t.type === 'drop');
    if (filter === 'trades') return txns.filter(t => t.type === 'trade' || t.type === 'trade_offer');
    if (filter === 'settings') return txns.filter(t => t.type === 'league_settings');
    return txns;
  }, [txns, filter]);

  const highlightCount = txns.filter(t => t.type === 'league_settings' && t.highlight).length;

  return (
    <div style={{ padding: '20px 24px', maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1>Transactions</h1>
            <div className="sub">All roster moves, trades, and league setting changes — visible to everyone</div>
          </div>
          <button className="btn ghost sm" onClick={load} disabled={loading} style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {loading ? '⟳ Loading…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {highlightCount > 0 && (
        <div style={{ padding: '10px 14px', background: 'rgba(255,181,71,.1)', border: '1px solid rgba(255,181,71,.35)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>★</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ffb547' }}>Commissioner Schedule Update</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{highlightCount} highlighted change{highlightCount !== 1 ? 's' : ''} from the commissioner — see below</div>
          </div>
          <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 10, color: '#ffb547', borderColor: 'rgba(255,181,71,.4)' }} onClick={() => setFilter('settings')}>
            View Settings Changes
          </button>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 2, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: filter === f.id ? 700 : 500,
              cursor: 'pointer', border: `1px solid ${filter === f.id ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f.id ? 'rgba(198,255,58,.12)' : 'transparent',
              color: filter === f.id ? 'var(--accent)' : 'var(--text-dim)',
            }}>
              {f.label}
              {f.id === 'settings' && highlightCount > 0 && (
                <span style={{ marginLeft: 5, background: '#ffb547', color: '#000', borderRadius: 10, padding: '1px 5px', fontSize: 9, fontWeight: 900 }}>{highlightCount}</span>
              )}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} {filter === 'all' ? 'total' : 'matching'}
          </span>
        </div>

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            Loading transactions…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: '16px 18px', color: '#ff5a6e', fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No transactions yet{filter !== 'all' ? ' for this filter' : ''}.
          </div>
        )}
        {!loading && filtered.map(tx => <TxnRow key={tx.id} tx={tx} />)}
      </div>
    </div>
  );
}
