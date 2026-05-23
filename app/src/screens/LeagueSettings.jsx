import React from 'react';

const STORAGE_KEY = 'fantasai_league_settings';

const DEFAULTS = {
  // General
  leagueName:    'ATO Tau League',
  season:        2025,
  numTeams:      12,
  scoringFormat: 'Half PPR',
  // Roster
  qb: 1, rb: 2, wr: 2, te: 1, flex: 1, k: 1, dst: 1, bench: 6, ir: 1,
  // Playoffs
  playoffTeams:  6,
  playoffStart:  15,
  playoffWeeks:  3,
  // Waivers
  waiverType:    'FAAB',
  faabBudget:    200,
  tradeDeadline: 13,
  // Rules — free-form sections
  rules: {
    general:   'All roster moves must be completed by the weekly lock time (Sunday 1:00pm ET).\nManagers are responsible for setting their own lineups each week.\nIf a manager fails to set a lineup, no changes will be made on their behalf.',
    scoring:   'Half PPR scoring (0.5 points per reception).\nOffensive touchdowns: 6 pts. Two-point conversions: 2 pts.\nFumbles lost: -2 pts. Interceptions thrown: -2 pts.',
    rosters:   'Each team carries 15 players (9 starters, 6 bench, 1 IR).\nIR slot may only be used for players with official IR/PUP designation.\nViolation of IR rules results in a forfeit for that week.',
    trades:    'Trade deadline is Week 13. No trades after the deadline.\nTrades process within 48 hours unless vetoed by the commissioner.\nColluding trades will be reversed and may result in removal from the league.',
    waivers:   'FAAB (Free Agent Acquisition Budget) waiver system.\nBudget resets to $200 each season. Minimum bid is $0.\nWaiver claims process Tuesday mornings. Ties broken by inverse standings.',
    playoffs:  'Top 6 teams qualify. Weeks 15–17 are playoff weeks.\nSeeds 1–2 receive first-round byes.\nChampionship in Week 17. Third-place game played simultaneously.',
  },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) return { ...DEFAULTS, ...saved, rules: { ...DEFAULTS.rules, ...saved.rules } };
  } catch {}
  return DEFAULTS;
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const SCORING_OPTIONS  = ['Standard', 'Half PPR', 'PPR'];
const WAIVER_OPTIONS   = ['Rolling', 'FAAB', 'Free Agent'];

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max = 999, canEdit }) {
  return canEdit ? (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: 70 }}
    />
  ) : (
    <div style={{ fontSize: 14, fontWeight: 600, padding: '6px 0' }}>{value}</div>
  );
}

export default function LeagueSettings({ user }) {
  const canEdit = user?.isAdmin || user?.isCommissioner;
  const [data, setData]     = React.useState(load);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]   = React.useState(null);
  const [saved, setSaved]   = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('settings'); // 'settings' | 'rules'
  const [editingRule, setEditingRule] = React.useState(null);

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(data)));
    setEditing(true);
    setSaved(false);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  function saveSettings() {
    save(draft);
    setData(draft);
    setEditing(false);
    setDraft(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function set(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  function saveRule(key, text) {
    const next = { ...data, rules: { ...data.rules, [key]: text } };
    save(next);
    setData(next);
    setEditingRule(null);
  }

  const d = editing ? draft : data;

  const RULE_SECTIONS = [
    { key: 'general',  label: 'General Rules' },
    { key: 'scoring',  label: 'Scoring Rules' },
    { key: 'rosters',  label: 'Roster Rules' },
    { key: 'trades',   label: 'Trade Rules' },
    { key: 'waivers',  label: 'Waiver Rules' },
    { key: 'playoffs', label: 'Playoff Rules' },
  ];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 820 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 2 }}>
            {data.leagueName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {data.numTeams} teams · {data.scoringFormat} · Season {data.season}
          </div>
        </div>
        {canEdit && activeTab === 'settings' && !editing && (
          <button className="btn ghost sm" onClick={startEdit}>Edit Settings</button>
        )}
        {canEdit && activeTab === 'settings' && editing && (
          <div style={{ display: 'flex', gap: 8 }}>
            {saved && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, alignSelf: 'center' }}>Saved ✓</span>}
            <button className="btn ghost sm" onClick={cancelEdit}>Cancel</button>
            <button className="btn primary sm" onClick={saveSettings}>Save</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {['settings', 'rules'].map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setEditing(false); setDraft(null); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 16px', fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
              color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab === 'settings' ? 'League Settings' : 'Rules'}
          </button>
        ))}
      </div>

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* General */}
          <Section title="General">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
              <Field label="League Name">
                {editing
                  ? <input className="input" value={d.leagueName} onChange={e => set('leagueName', e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                  : <Value>{d.leagueName}</Value>}
              </Field>
              <Field label="Season">
                <NumInput value={d.season} onChange={v => set('season', v)} min={2020} max={2099} canEdit={editing} />
              </Field>
              <Field label="# of Teams">
                <NumInput value={d.numTeams} onChange={v => set('numTeams', v)} min={4} max={32} canEdit={editing} />
              </Field>
              <Field label="Scoring Format">
                {editing
                  ? <Select value={d.scoringFormat} options={SCORING_OPTIONS} onChange={v => set('scoringFormat', v)} />
                  : <Value>{d.scoringFormat}</Value>}
              </Field>
            </div>
          </Section>

          {/* Roster */}
          <Section title="Roster Slots">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 12 }}>
              {[['QB','qb'],['RB','rb'],['WR','wr'],['TE','te'],['FLEX','flex'],['K','k'],['D/ST','dst'],['Bench','bench'],['IR','ir']].map(([label, key]) => (
                <Field key={key} label={label}>
                  <NumInput value={d[key]} onChange={v => set(key, v)} min={0} max={20} canEdit={editing} />
                </Field>
              ))}
            </div>
          </Section>

          {/* Playoffs */}
          <Section title="Playoffs">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
              <Field label="Playoff Teams">
                <NumInput value={d.playoffTeams} onChange={v => set('playoffTeams', v)} min={2} max={d.numTeams} canEdit={editing} />
              </Field>
              <Field label="Start Week">
                <NumInput value={d.playoffStart} onChange={v => set('playoffStart', v)} min={13} max={17} canEdit={editing} />
              </Field>
              <Field label="# of Weeks">
                <NumInput value={d.playoffWeeks} onChange={v => set('playoffWeeks', v)} min={1} max={4} canEdit={editing} />
              </Field>
            </div>
          </Section>

          {/* Waivers */}
          <Section title="Waivers & Transactions">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
              <Field label="Waiver Type">
                {editing
                  ? <Select value={d.waiverType} options={WAIVER_OPTIONS} onChange={v => set('waiverType', v)} />
                  : <Value>{d.waiverType}</Value>}
              </Field>
              {d.waiverType === 'FAAB' && (
                <Field label="FAAB Budget ($)">
                  <NumInput value={d.faabBudget} onChange={v => set('faabBudget', v)} min={0} max={9999} canEdit={editing} />
                </Field>
              )}
              <Field label="Trade Deadline (Week)">
                <NumInput value={d.tradeDeadline} onChange={v => set('tradeDeadline', v)} min={1} max={17} canEdit={editing} />
              </Field>
            </div>
          </Section>

        </div>
      )}

      {/* Rules tab */}
      {activeTab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {RULE_SECTIONS.map(({ key, label }) => (
            <RuleCard
              key={key}
              label={label}
              text={data.rules[key] || ''}
              canEdit={canEdit}
              isEditing={editingRule === key}
              onEdit={() => setEditingRule(key)}
              onCancel={() => setEditingRule(null)}
              onSave={text => saveRule(key, text)}
            />
          ))}
        </div>
      )}

    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Value({ children }) {
  return <div style={{ fontSize: 14, fontWeight: 600, padding: '6px 0' }}>{children}</div>;
}

function Select({ value, options, onChange }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function RuleCard({ label, text, canEdit, isEditing, onEdit, onCancel, onSave }) {
  const [draft, setDraft] = React.useState(text);

  React.useEffect(() => {
    if (isEditing) setDraft(text);
  }, [isEditing, text]);

  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: isEditing ? '1px solid var(--border)' : 'none' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        {canEdit && !isEditing && <button className="btn ghost sm" onClick={onEdit}>Edit</button>}
        {canEdit && isEditing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
            <button className="btn primary sm" onClick={() => onSave(draft)}>Save</button>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 16px' }}>
        {isEditing ? (
          <textarea
            className="input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={5}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}
          />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {text || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No rules defined yet.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
