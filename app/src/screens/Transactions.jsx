import React from 'react';
import { api } from '../api.js';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { findPlayerByName } from '../lib/playerStore.js';

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
  swap:         { icon: '⇄',  label: 'Swapped',    color: '#4ea8ff' },
  waiver_claim: { icon: '📋', label: 'Waiver Claim', color: '#34d399' },
  trade:        { icon: '↔',  label: 'Trade',      color: '#4ea8ff' },
  trade_offer:  { icon: '📩', label: 'Trade Offer', color: '#ffb547' },
  league_settings: { icon: '⚙', label: 'Settings', color: '#c6ff3a' },
};

const POS_COLORS = {
  QB: '#ef4444', RB: '#22c55e', WR: '#3b82f6', TE: '#f59e0b', K: '#a78bfa', DST: '#64748b',
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

function PlayerCard({ p, accent, compact = false }) {
  const live = findPlayerByName(p.name);
  const photo = live?.photoUrl || p.photoUrl || null;
  const pos = p.pos || live?.pos || '';
  const team = p.nflTeam || live?.team || '';
  const avg = live?.avg ? `${live.avg.toFixed(1)} avg` : null;
  const proj = live?.proj ? `${live.proj.toFixed(1)} proj` : null;
  const ecr = live?.ecr && live.ecr < 500 ? `#${live.ecr} ECR` : null;
  const posColor = POS_COLORS[pos] || 'var(--text-faint)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: compact ? 6 : 10,
      padding: compact ? '5px 8px' : '8px 10px',
      background: `${accent}0d`, border: `1px solid ${accent}28`,
      borderRadius: 8, minWidth: 0,
    }}>
      {photo ? (
        <img src={photo} alt={p.name} style={{ width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-2)', border: `2px solid ${posColor}60` }} onError={e => { e.target.style.display = 'none'; }} />
      ) : (
        <div style={{ width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: '50%', flexShrink: 0, background: `${posColor}22`, border: `2px solid ${posColor}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 9 : 11, fontWeight: 900, color: posColor }}>
          {pos || '?'}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {pos && <span style={{ fontSize: 9, fontWeight: 800, color: posColor, background: `${posColor}18`, borderRadius: 3, padding: '1px 4px', fontFamily: 'var(--font-mono)' }}>{pos}</span>}
          {team && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{team}</span>}
          {!compact && avg && <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{avg}</span>}
          {!compact && proj && <span style={{ fontSize: 9, color: '#4ea8ff', fontFamily: 'var(--font-mono)' }}>{proj}</span>}
          {!compact && ecr && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{ecr}</span>}
        </div>
      </div>
    </div>
  );
}

function TxnRow({ tx }) {
  const meta = TYPE_META[tx.type] || { icon: '◈', label: tx.type, color: 'var(--text-faint)' };
  const isSettings = tx.type === 'league_settings';
  const isHighlight = isSettings && tx.highlight;
  const catInfo = isSettings ? (CATEGORY_LABELS[tx.category] || CATEGORY_LABELS.general) : null;
  const isTrade = tx.type === 'trade' || tx.type === 'trade_offer';
  const team = !isSettings ? LEAGUE_TEAMS.find(t => String(t.id) === String(tx.teamId)) : null;

  return (
    <div style={{
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)',
      background: isHighlight ? 'rgba(255,181,71,.07)' : 'transparent',
      borderLeft: isHighlight ? '3px solid #ffb547' : '3px solid transparent',
    }}>
      {/* Header row — for add/drop, player identity lives inline here too (one line, no repeat) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (isSettings && tx.description) ? 8 : 0, flexWrap: 'wrap' }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: `${meta.color}18`, border: `1px solid ${meta.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}>
          {meta.icon}
        </div>
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
        {/* Team badge */}
        {team && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 2 }}>
            <span style={{ width: 16, height: 16, borderRadius: 3, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 900, color: '#000', flexShrink: 0 }}>{team.logo}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{tx.teamName || 'Unknown Team'}</span>
          </span>
        )}
        {isSettings && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--text)' }}>{tx.changedBy || tx.teamName || 'Commissioner'}</strong>
          </span>
        )}
        {/* Add/drop/swap/waiver-claim players — inline, one line. Per-player
            Added/Dropped label only shows when a single transaction mixes
            both actions (swap, waiver claim) — plain add/drop rows already
            say so in the header badge, no need to repeat it. */}
        {['add', 'drop', 'swap', 'waiver_claim'].includes(tx.type) && tx.players?.length > 0 && (() => {
          const mixed = tx.players.some(p => p.action === 'add') && tx.players.some(p => p.action === 'drop');
          return (
            <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 6px', fontSize: 12 }}>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              {tx.players.map((p, i) => {
                const live = findPlayerByName(p.name);
                const pos  = p.pos || live?.pos || '';
                const nflTeam = p.nflTeam || live?.team || '';
                const posColor = POS_COLORS[pos] || 'var(--text-faint)';
                const actionColor = p.action === 'add' ? '#4caf82' : '#ff5a6e';
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ color: 'var(--text-faint)' }}>,</span>}
                    {mixed && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: actionColor, fontFamily: 'var(--font-mono)' }}>
                        {p.action === 'add' ? 'Added' : 'Dropped'}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                    {(pos || nflTeam) && (
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: posColor }}>
                        {pos}{pos && nflTeam ? ' · ' : ''}{nflTeam}
                      </span>
                    )}
                  </span>
                );
              })}
              {tx.type === 'waiver_claim' && tx.waiverPick != null && (
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                  · Claim #{tx.waiverPick}{tx.newWaiverPick != null ? ` → #${tx.newWaiverPick}` : ''}
                </span>
              )}
            </span>
          );
        })()}
        <span
          title={new Date(tx.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0, cursor: 'default' }}
        >
          {timeAgo(tx.timestamp)}
        </span>
      </div>

      {/* Settings description */}
      {isSettings && tx.description && (
        <div style={{ fontSize: 12, color: isHighlight ? '#ffb547' : 'var(--text-dim)', lineHeight: 1.5, marginLeft: 34 }}>
          {tx.description}
        </div>
      )}

      {/* Trade layout */}
      {isTrade && (tx.gave?.length > 0 || tx.got?.length > 0) && (
        <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tx.gave?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 900, color: '#ff5a6e', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', paddingTop: 10, flexShrink: 0, width: 32 }}>GAVE</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tx.gave.map((p, i) => <PlayerCard key={i} p={p} accent="#ff5a6e" compact />)}
              </div>
            </div>
          )}
          {tx.got?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 900, color: '#4caf82', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', paddingTop: 10, flexShrink: 0, width: 32 }}>GOT</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tx.got.map((p, i) => <PlayerCard key={i} p={p} accent="#4caf82" compact />)}
              </div>
            </div>
          )}
          {tx.type === 'trade_offer' && (
            <div style={{ fontSize: 10, color: '#ffb547', fontFamily: 'var(--font-mono)', marginTop: 2, marginLeft: 40 }}>Offer sent to {tx.otherTeamName || 'opponent'}</div>
          )}
        </div>
      )}
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
    if (filter === 'roster') return txns.filter(t => ['add', 'drop', 'swap', 'waiver_claim'].includes(t.type));
    if (filter === 'trades') return txns.filter(t => t.type === 'trade' || t.type === 'trade_offer');
    if (filter === 'settings') return txns.filter(t => t.type === 'league_settings');
    return txns;
  }, [txns, filter]);

  const highlightCount = txns.filter(t => t.type === 'league_settings' && t.highlight).length;

  const stats = React.useMemo(() => ({
    adds:   txns.filter(t => t.type === 'add').length,
    drops:  txns.filter(t => t.type === 'drop').length,
    trades: txns.filter(t => t.type === 'trade').length,
    offers: txns.filter(t => t.type === 'trade_offer').length,
    recent: txns.filter(t => Date.now() - new Date(t.timestamp) < 7 * 864e5).length,
  }), [txns]);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 20 }}>
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

      {/* Stats strip */}
      {!loading && txns.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Adds',    value: stats.adds,   color: '#4caf82' },
            { label: 'Drops',   value: stats.drops,  color: '#ff5a6e' },
            { label: 'Trades',  value: stats.trades, color: '#4ea8ff' },
            { label: 'Offers',  value: stats.offers, color: '#ffb547' },
            { label: 'This Week', value: stats.recent, color: 'var(--accent)' },
          ].map(s => (
            <div key={s.label} style={{ padding: '8px 14px', background: `${s.color}10`, border: `1px solid ${s.color}30`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 72 }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: s.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{s.value}</span>
              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 2, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
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
