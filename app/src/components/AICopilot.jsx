import React from 'react';

export default function AICopilot({ active, aiMode }) {
  const [messages, setMessages] = React.useState([
    { type: 'system', text: "I'm watching your roster, the waiver wire, and league news. Ask anything." },
  ]);
  const [input, setInput] = React.useState('');

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

  function send() {
    if (!input.trim()) return;
    setMessages([...messages, { type: 'user', text: input }, { type: 'ai', text: 'Looking into that — give me a sec while I run the model...' }]);
    setInput('');
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

      <div className="ai-body">
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
            <div className="label">{m.type === 'user' ? 'YOU' : 'FANTASAI'}</div>
            <div>{m.text}</div>
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <div className="mono faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Quick Asks</div>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {['Optimize my lineup', 'Top 3 waiver targets', 'Grade my roster', 'Who should I trade?'].map(q => (
              <button key={q} className="btn sm ghost" onClick={() => setMessages([...messages, { type: 'user', text: q }])} style={{ fontSize: 10 }}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="ai-input">
        <input className="input" placeholder="Ask FantasAI anything..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <button className="btn ai" onClick={send}>↗</button>
      </div>
    </div>
  );
}
