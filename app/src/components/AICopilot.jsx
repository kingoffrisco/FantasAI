import React from 'react';
import { findPlayer, LEAGUE_TEAMS } from '../lib/data.js';

const API_BASE = 'https://api.fantasai.net';

async function callChat(question, context, rosterPlayers) {
  const res = await fetch(`${API_BASE}/api/v1/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ question, context, rosterPlayers }),
    signal:  AbortSignal.timeout(35000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.answer;
}

function buildRosterContext(user, myRosterIds) {
  const team    = LEAGUE_TEAMS.find(t => t.id === user?.teamId);
  const players = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean);

  const byPos = {};
  for (const p of players) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }

  const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const rosterLines = posOrder
    .filter(pos => byPos[pos])
    .flatMap(pos => byPos[pos].map(p =>
      `  ${pos}: ${p.name} (${p.team})${p.status !== 'OK' ? ` [${p.status}]` : ''} | Proj: ${p.proj} | Avg: ${p.avg} | Last: ${p.last}`
    ))
    .join('\n');

  return `You are FantasAI, an expert fantasy football assistant for the TAU Fantasy League.

The user's team is: ${team?.name || 'Unknown Team'}
Their team ID is: ${user?.teamId ?? 'N/A'}

CURRENT ROSTER (${players.length} players):
${rosterLines || '  (No roster data available)'}

Use this roster data to answer questions specifically about this team. When asked about players on the roster, only refer to the players listed above.`;
}

export default function AICopilot({ active, aiMode, user, myRosterIds }) {
  const [messages, setMessages] = React.useState([
    { type: 'system', text: "I'm watching your roster, the waiver wire, and league news. Ask anything." },
  ]);
  const [input, setInput]     = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const bodyRef = React.useRef(null);

  const contextNotes = {
    dashboard: [
      { label: 'LINEUP DECISION', cls: '', text: "Start James Cook over Jahmyr Gibbs at FLEX. Cook's matchup vs MIA's 24th-ranked rush D is significantly better than Gibbs vs GB. Edge: +1.4 pts." },
      { label: 'WATCH', cls: 'warn', text: "CMC's calf hasn't been cleared. If listed Out by Saturday, I'll promote Cook to RB2 and slide Achane to FLEX automatically." },
      { label: 'OPPORTUNITY', cls: 'good', text: "Eagles D/ST is on waivers and has the best matchup of any DST this week. You'd drop Steelers (BYE next week)." },
    ],
    players: [
      { label: 'TIER BREAK', cls: '', text: "Only 4 RBs left in the RB2 tier (Cook, Jacobs, Kamara, Williams). After them, ~8 pts/wk drop-off." },
      { label: 'BUY LOW', cls: 'good', text: "Marvin Harrison Jr.'s ownership is at 96% but only 12% of managers are 'starting' him. Window is closing." },
      { label: 'FADE', cls: 'warn', text: "DJ Moore — soft tissue injury, owner trying to trade him. Don't bite this week." },
    ],
    news: [
      { label: 'SUMMARY', cls: '', text: "9 news items in last 4 hours. 2 affect your starters (Allen ✓, CMC ⚠). Top story for the league: Burrow wrist." },
      { label: 'ACTION', cls: '', text: "Want me to ping you when Mixon's status updates? He's a key handcuff for Pierce stashers." },
    ],
    compare: [
      { label: 'VERDICT', cls: '', text: "Chase wins in 67% of simulated weeks. The matchup is the swing factor — BAL is league-average vs WR, DET is bottom-10." },
      { label: 'NUANCE', cls: '', text: "If you need a ceiling outcome (must-win scenario), prefer Chase. For floor in a tight matchup, St. Brown is steadier." },
    ],
    watchlist: [
      { label: 'MOVERS', cls: '', text: "MHJ rostership +4.2% this week. Caleb Williams trending up after streaming success." },
    ],
    trade: [
      { label: 'TRADE READ', cls: '', text: "This deal slightly favors you. The other manager (Marcus) tends to overvalue rookies — he might bite if you swap Bowers for Kelce." },
      { label: 'COUNTER', cls: 'warn', text: "If he counters with McBride instead of Kelce, walk away — that's a downgrade for you." },
    ],
    draft: [
      { label: 'NEXT PICK', cls: '', text: "Your pick is in 4 spots. I've ranked 3 candidates by roster fit × value × scarcity. Top: Aaron Jones." },
      { label: 'TIER BREAK', cls: 'warn', text: "After this pick, only 2 TE1s remain. Strongly consider Kittle if Jones gets sniped." },
      { label: 'STRATEGY', cls: '', text: "Your build is RB-heavy. We should prioritize WR depth over the next 3 picks." },
    ],
  };

  const notes = contextNotes[active] || [];

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  async function send(questionOverride) {
    const q = (questionOverride ?? input).trim();
    if (!q || loading) return;
    setInput('');
    const thinking = { type: 'ai', text: '◆ Thinking…', pending: true };
    setMessages(prev => [...prev, { type: 'user', text: q }, thinking]);
    setLoading(true);
    try {
      const context       = buildRosterContext(user, myRosterIds);
      const rosterPlayers = [...(myRosterIds || [])].map(id => findPlayer(id)).filter(Boolean)
        .map(p => ({ name: p.name, pos: p.pos, team: p.team, id: p.id }));
      const answer = await callChat(q, context, rosterPlayers);
      setMessages(prev => {
        const next = [...prev];
        const idx  = next.findLastIndex(m => m.pending);
        if (idx !== -1) next[idx] = { type: 'ai', text: answer };
        return next;
      });
    } catch (err) {
      setMessages(prev => {
        const next = [...prev];
        const idx  = next.findLastIndex(m => m.pending);
        if (idx !== -1) next[idx] = { type: 'ai', text: `Sorry, couldn't reach the AI: ${err.message}` };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai">
      <div className="ai-head">
        <div className="ai-orb"></div>
        <div>
          <div className="title">FantasAI</div>
          <div className="mono faint" style={{ fontSize: 10 }}>v2.4 · {aiMode}</div>
        </div>
        <div className="live">LIVE</div>
      </div>

      <div className="ai-body" ref={bodyRef}>
        <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>Watching this view</div>
        {notes.map((n, i) => (
          <div key={i} className="ai-msg note">
            <div className={`label ${n.cls}`}>{n.label}</div>
            <div>{n.text}</div>
          </div>
        ))}

        <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginTop: 8 }}>Conversation</div>
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.type === 'ai' || m.type === 'system' ? 'note' : ''}`}>
            <div className="label" style={m.pending ? { color: 'var(--accent)', opacity: 0.6 } : {}}>
              {m.type === 'user' ? 'YOU' : 'FANTASAI'}
            </div>
            <div style={m.pending ? { color: 'var(--text-faint)', fontStyle: 'italic' } : {}}>{m.text}</div>
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Quick Asks</div>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {['Optimize my lineup', 'Top 3 waiver targets', 'Grade my roster', 'Who should I trade?'].map(q => (
              <button key={q} className="btn sm ghost" onClick={() => send(q)} disabled={loading} style={{ fontSize: 10 }}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="ai-input">
        <input
          className="input"
          placeholder={loading ? 'Waiting for FantasAI…' : 'Ask FantasAI anything...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
        />
        <button className="btn ai" onClick={() => send()} disabled={loading}>
          {loading ? '…' : '↗'}
        </button>
      </div>
    </div>
  );
}
