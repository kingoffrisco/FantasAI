import React from 'react';
import { LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { getMyTeamPrefs, saveMyTeamPrefs, clearMyTeamPrefs } from '../lib/leagueStore.js';
import { TeamLogoBadge } from '../components/ui.jsx';
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';

// ── Scoring weight config ─────────────────────────────────────────────────────

const POSITION_FEATURES = {
  QB:  [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'passYds',      label: 'Passing Yards'               },
    { key: 'passTDs',      label: 'Passing TDs'                 },
    { key: 'ints',         label: 'Interceptions'               },
    { key: 'rushYds',      label: 'Rushing Yards'               },
    { key: 'last',         label: 'Last Week Pts'               },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
    { key: 'tier',         label: 'Tier'                        },
    { key: 'cpoe',         label: 'NextGen: Completion % Over Expected' },
    { key: 'timeToThrow',  label: 'NextGen: Avg Time to Throw'  },
    { key: 'aggressiveness', label: 'NextGen: Aggressiveness %' },
  ],
  RB:  [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'rushYds',      label: 'Rushing Yards'               },
    { key: 'rushTDs',      label: 'Rushing TDs'                 },
    { key: 'recYds',       label: 'Receiving Yards'             },
    { key: 'recTDs',       label: 'Receiving TDs'               },
    { key: 'targets',      label: 'Targets'                     },
    { key: 'last',         label: 'Last Week Pts'               },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
    { key: 'tier',         label: 'Tier'                        },
    { key: 'rushEff',      label: 'NextGen: Rush Efficiency (Yds Over Expected)' },
    { key: 'breakaway',    label: 'NextGen: Breakaway Run %'    },
    { key: 'yac',          label: 'NextGen: Yards After Contact'},
  ],
  WR:  [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'recYds',       label: 'Receiving Yards'             },
    { key: 'recTDs',       label: 'Receiving TDs'               },
    { key: 'targets',      label: 'Targets'                     },
    { key: 'tgtShare',     label: 'Target Share %'              },
    { key: 'airYards',     label: 'Air Yards'                   },
    { key: 'last',         label: 'Last Week Pts'               },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
    { key: 'tier',         label: 'Tier'                        },
    { key: 'separation',   label: 'NextGen: Avg Separation'     },
    { key: 'cushion',      label: 'NextGen: Avg Cushion at Snap'},
    { key: 'yac',          label: 'NextGen: Yards After Catch'  },
    { key: 'catchPct',     label: 'NextGen: Catch % Above Avg'  },
  ],
  TE:  [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'recYds',       label: 'Receiving Yards'             },
    { key: 'recTDs',       label: 'Receiving TDs'               },
    { key: 'targets',      label: 'Targets'                     },
    { key: 'tgtShare',     label: 'Target Share %'              },
    { key: 'last',         label: 'Last Week Pts'               },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
    { key: 'tier',         label: 'Tier'                        },
    { key: 'separation',   label: 'NextGen: Avg Separation'     },
    { key: 'cushion',      label: 'NextGen: Avg Cushion at Snap'},
    { key: 'yac',          label: 'NextGen: Yards After Catch'  },
  ],
  K:   [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'fgPct',        label: 'FG Percentage'               },
    { key: 'fgAtt',        label: 'FG Attempts'                 },
    { key: 'longFG',       label: 'Long FG Made'                },
    { key: 'xp',           label: 'Extra Points'                },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
  ],
  DST: [
    { key: 'proj',         label: 'Projected Points'            },
    { key: 'avg',          label: 'Season Avg Pts'              },
    { key: 'ptsAllow',     label: 'Points Allowed'              },
    { key: 'sacks',        label: 'Sacks'                       },
    { key: 'ints',         label: 'Interceptions'               },
    { key: 'fumbles',      label: 'Fumble Recoveries'           },
    { key: 'dstTDs',       label: 'Defensive TDs'               },
    { key: 'ecr',          label: 'ECR Rank'                    },
    { key: 'adp',          label: 'ADP'                         },
    { key: 'oppRank',      label: 'Matchup Rank'                },
    { key: 'owned',        label: 'Ownership %'                 },
    { key: 'pressureRate', label: 'NextGen: QB Pressure Rate'   },
    { key: 'coverage',     label: 'NextGen: Coverage Grade'     },
  ],
};

const DEFAULT_WEIGHT_DIST = {
  QB:  [25, 20, 12, 10, 5,  8, 5,  8,  3,  2,  1,  1, 0, 0, 0],
  RB:  [25, 18, 12,  8,  8, 6,  5, 4,  7,  3,  2,  1,  1, 0, 0, 0],
  WR:  [25, 18, 12,  8,  8, 6,  5, 4,  7,  3,  2,  1,  1, 0, 0, 0, 0],
  TE:  [25, 18, 14,  8,  8, 6,  4, 8,  3,  2,  3,  1, 0, 0, 0],
  K:   [30, 20, 15, 10,  8, 7,  5,  3,  1,  1],
  DST: [25, 18, 12, 10,  8, 7,  5, 7,  3,  3,  2, 0, 0],
};

function buildDefaultWeights() {
  const result = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
    const features = POSITION_FEATURES[pos];
    const dist = DEFAULT_WEIGHT_DIST[pos];
    result[pos] = features.map((f, i) => ({ ...f, weight: dist[i] ?? 0 }));
  }
  return result;
}

function loadScoringWeights() {
  try {
    const saved = getPrefs().scoringWeights;
    if (!saved) return buildDefaultWeights();
    const defaults = buildDefaultWeights();
    const result = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      if (Array.isArray(saved[pos]) && saved[pos].length > 0) {
        // Merge saved order/weights; add any new features not in saved list
        const savedKeys = new Set(saved[pos].map(f => f.key));
        const extras = (defaults[pos] || []).filter(f => !savedKeys.has(f.key));
        result[pos] = [...saved[pos], ...extras];
      } else {
        result[pos] = defaults[pos];
      }
    }
    return result;
  } catch { return buildDefaultWeights(); }
}

const SCORE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

const LIGHT_SURFACE_VARS = {
  '--bg': '#b8bfd4', '--bg-2': '#aeb5ca', '--panel': '#c4cbde',
  '--panel-2': '#bec5da', '--panel-3': '#b6bdd2',
  '--border': '#7e88a8', '--border-strong': '#626c90', '--hover': '#b2b9d0',
  '--text': '#070a1c', '--text-dim': '#1a2038', '--text-faint': '#343c62',
};

const THEMES = [
  { id: 'sportsbook-dark', label: 'Sportsbook Dark', accent: '#c6ff3a', accent2: '#4ea8ff', bg: '#060912' },
  { id: 'steel-city',      label: 'Steel City',      accent: '#ffb800', accent2: '#00aaff', bg: '#0a0c10' },
  { id: 'coastal-dusk',    label: 'Coastal Dusk',    accent: '#00e0c8', accent2: '#ff6050', bg: '#04101e' },
  { id: 'ember',           label: 'Ember',            accent: '#ff7c20', accent2: '#00cfff', bg: '#0e0c08' },
  { id: 'royal-crimson',   label: 'Royal Crimson',   accent: '#e53338', accent2: '#ffd700', bg: '#0c0808' },
];

const THEME_VARS = {
  'sportsbook-dark': {
    '--bg': '#060912', '--bg-2': '#0a0f1d', '--panel': '#0f1424', '--panel-2': '#161d33',
    '--panel-3': '#1c2540', '--border': '#1f2740', '--border-strong': '#2c365a', '--hover': '#19223b',
    '--accent': '#c6ff3a', '--accent-ink': '#0a1300', '--accent-2': '#4ea8ff',
  },
  'steel-city': {
    '--bg': '#0a0c10', '--bg-2': '#0e1118', '--panel': '#141820', '--panel-2': '#1a2030',
    '--panel-3': '#202840', '--border': '#282e42', '--border-strong': '#36405a', '--hover': '#1c2234',
    '--accent': '#ffb800', '--accent-ink': '#1a1000', '--accent-2': '#00aaff',
  },
  'coastal-dusk': {
    '--bg': '#04101e', '--bg-2': '#071628', '--panel': '#0c1d34', '--panel-2': '#122442',
    '--panel-3': '#192d52', '--border': '#1e3460', '--border-strong': '#2a4480', '--hover': '#0e2040',
    '--accent': '#00e0c8', '--accent-ink': '#001a16', '--accent-2': '#ff6050',
  },
  'ember': {
    '--bg': '#0e0c08', '--bg-2': '#141008', '--panel': '#1a140a', '--panel-2': '#201a10',
    '--panel-3': '#282016', '--border': '#342810', '--border-strong': '#4a3820', '--hover': '#1e1810',
    '--accent': '#ff7c20', '--accent-ink': '#1a0a00', '--accent-2': '#00cfff',
  },
  'royal-crimson': {
    '--bg': '#0c0808', '--bg-2': '#140c0c', '--panel': '#1a1010', '--panel-2': '#221414',
    '--panel-3': '#2a1818', '--border': '#381c1c', '--border-strong': '#502828', '--hover': '#1e1414',
    '--accent': '#e53338', '--accent-ink': '#1a0002', '--accent-2': '#ffd700',
  },
};

function LogoPreview({ logo, logoImg, color, textColor = '#000000', size = 64 }) {
  const radius = size * 0.18;
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, background: color || '#444',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
      boxShadow: '0 2px 12px rgba(0,0,0,.4)',
    }}>
      {logoImg
        ? <img src={logoImg} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.28, fontWeight: 900, color: textColor, letterSpacing: '-0.04em' }}>
            {(logo || '??').slice(0, 2).toUpperCase()}
          </span>
      }
    </div>
  );
}

const TABS = [
  { id: 'team',       label: 'Team Name',   icon: '🏆' },
  { id: 'sleeper',    label: 'Sleeper',      icon: '😴' },
  { id: 'appearance', label: 'Appearance',  icon: '🎨' },
  { id: 'security',   label: 'Security',    icon: '🔒' },
];

export default function AccountEditScreen({ user }) {
  const teamId = user?.teamId || 1;
  const baseTeam = LEAGUE_TEAMS.find(t => t.id === teamId) || LEAGUE_TEAMS[0];

  const savedPrefs = getMyTeamPrefs() || {};

  const [activeTab, setActiveTab]   = React.useState('team');

  // Team tab state
  const [teamName, setTeamName]   = React.useState(savedPrefs.name   ?? baseTeam.name);
  const [ownerName, setOwnerName] = React.useState(savedPrefs.owner  ?? baseTeam.owner);
  const [logo, setLogo]           = React.useState(savedPrefs.logo   ?? baseTeam.logo);
  const [color, setColor]             = React.useState(savedPrefs.color        ?? baseTeam.color);
  const [logoTextColor, setLogoTextColor] = React.useState(savedPrefs.logoTextColor ?? '#000000');
  const [logoImg, setLogoImg]         = React.useState(savedPrefs.logoImg ?? null);
  const [saved, setSaved]         = React.useState(false);
  const [dragOver, setDragOver]   = React.useState(false);
  const [aiPrompt, setAiPrompt]   = React.useState('');
  const [aiImgUrl, setAiImgUrl]   = React.useState('');
  const [promptCopied, setPromptCopied] = React.useState(false);
  const fileRef = React.useRef(null);

  // Appearance tab state
  const VALID_THEME_IDS = new Set(THEMES.map(t => t.id));
  const _initPrefs = getPrefs();
  const storedTheme = _initPrefs.theme || 'sportsbook-dark';
  const [activeTheme, setActiveTheme] = React.useState(VALID_THEME_IDS.has(storedTheme) ? storedTheme : 'sportsbook-dark');
  const [lightMode, setLightMode] = React.useState(_initPrefs.lightMode || false);

  // Sleeper tab state
  const [sleeperUsername, setSleeperUsername] = React.useState(_initPrefs.sleeperUsername || '');
  const [sleeperLeagueId, setSleeperLeagueId] = React.useState(_initPrefs.sleeperLeagueId || '');
  const [sleeperAdpWeight, setSleeperAdpWeight] = React.useState(_initPrefs.sleeperAdpWeight ?? 70);
  const [sleeperAutoSync, setSleeperAutoSync] = React.useState(_initPrefs.sleeperAutoSync || false);
  const [sleeperSyncing, setSleeperSyncing] = React.useState(false);
  const [sleeperSynced, setSleeperSynced]   = React.useState(false);
  const [sleeperError, setSleeperError]     = React.useState(null);

  // Scoring weights state
  const [scoringPos, setScoringPos]         = React.useState('QB');
  const [scoringWeights, setScoringWeights] = React.useState(() => loadScoringWeights());
  const [weightsSaved, setWeightsSaved]     = React.useState(false);

  // Security tab state
  const [currentPass, setCurrentPass]   = React.useState('');
  const [newPass, setNewPass]           = React.useState('');
  const [confirmPass, setConfirmPass]   = React.useState('');
  const [showCurrent, setShowCurrent]   = React.useState(false);
  const [showNew, setShowNew]           = React.useState(false);
  const [showConfirm, setShowConfirm]   = React.useState(false);
  const [passError, setPassError]       = React.useState('');
  const [passStatus, setPassStatus]     = React.useState(null);

  const API_BASE = 'https://api.fantasai.net';
  const OWNERS_KEY = 'fantasai_owners_config';
  const DEFAULT_PASSWORD = 'fantasy2025';

  React.useEffect(() => {
    setAiPrompt(`Fantasy football team logo for "${teamName}", sports emblem, bold design, dark background, professional`);
  }, [teamName]);

  React.useEffect(() => {
    const p = getPrefs();
    if (p.theme && THEME_VARS[p.theme]) applyTheme(p.theme, p.lightMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveFeature(pos, idx, dir) {
    setScoringWeights(prev => {
      const list = [...prev[pos]];
      const target = idx + dir;
      if (target < 0 || target >= list.length) return prev;
      [list[idx], list[target]] = [list[target], list[idx]];
      return { ...prev, [pos]: list };
    });
  }

  function setFeatureWeight(pos, idx, val) {
    setScoringWeights(prev => {
      const clamped    = Math.max(0, Math.min(100, val));
      const remaining  = 100 - clamped;
      const otherTotal = prev[pos].reduce((s, f, i) => i !== idx ? s + (f.weight || 0) : s, 0);

      const newList = prev[pos].map((f, i) => {
        if (i === idx) return { ...f, weight: clamped };
        if (remaining === 0) return { ...f, weight: 0 };
        if (otherTotal === 0) return { ...f, weight: Math.floor(remaining / (prev[pos].length - 1)) };
        return { ...f, weight: Math.round((f.weight / otherTotal) * remaining) };
      });

      // Fix rounding: total may be off by ±1 after Math.round — adjust the largest other slider
      const diff = 100 - newList.reduce((s, f) => s + f.weight, 0);
      if (diff !== 0) {
        let bestIdx = -1, bestVal = -1;
        newList.forEach((f, i) => { if (i !== idx && f.weight > bestVal) { bestVal = f.weight; bestIdx = i; } });
        if (bestIdx >= 0) newList[bestIdx] = { ...newList[bestIdx], weight: Math.max(0, newList[bestIdx].weight + diff) };
      }

      return { ...prev, [pos]: newList };
    });
  }

  function saveScoringWeights() {
    patchPrefs({ scoringWeights });
    setWeightsSaved(true);
    setTimeout(() => setWeightsSaved(false), 2500);
  }

  function resetScoringWeights() {
    const defaults = buildDefaultWeights();
    setScoringWeights(defaults);
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => setLogoImg(e.target.result);
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  function handleSave() {
    const prefs = {
      name: teamName.trim() || baseTeam.name,
      owner: ownerName.trim() || baseTeam.owner,
      logo: logo.slice(0, 2).toUpperCase() || baseTeam.logo,
      color,
      logoTextColor,
      logoImg: logoImg || null,
    };
    saveMyTeamPrefs(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleReset() {
    clearMyTeamPrefs();
    setTeamName(baseTeam.name);
    setOwnerName(baseTeam.owner);
    setLogo(baseTeam.logo);
    setColor(baseTeam.color);
    setLogoTextColor('#000000');
    setLogoImg(null);
  }

  function applyTheme(themeId, isLight) {
    const vars = THEME_VARS[themeId] ?? THEME_VARS['sportsbook-dark'];
    const merged = isLight ?? lightMode ? { ...vars, ...LIGHT_SURFACE_VARS } : vars;
    Object.entries(merged).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    patchPrefs({ theme: themeId });
    setActiveTheme(themeId);
  }

  function toggleLightMode(next) {
    patchPrefs({ lightMode: next });
    setLightMode(next);
    applyTheme(activeTheme, next);
  }

  function saveSleeperSettings() {
    patchPrefs({
      sleeperUsername: sleeperUsername.trim(),
      sleeperLeagueId: sleeperLeagueId.trim(),
      sleeperAdpWeight,
      sleeperAutoSync,
    });
  }

  async function handleSleeperSync() {
    if (!sleeperUsername.trim() && !sleeperLeagueId.trim()) {
      setSleeperError('Enter a Sleeper username or league ID first.');
      return;
    }
    setSleeperError(null);
    setSleeperSyncing(true);
    saveSleeperSettings();
    try {
      const params = new URLSearchParams();
      if (sleeperUsername.trim()) params.set('username', sleeperUsername.trim());
      if (sleeperLeagueId.trim()) params.set('leagueId', sleeperLeagueId.trim());
      const res = await fetch(`${API_BASE}/api/v1/sleeper/sync?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSleeperSynced(true);
      setTimeout(() => setSleeperSynced(false), 3000);
    } catch (e) {
      setSleeperError(`Sync failed: ${e.message}. Settings saved locally.`);
    } finally {
      setSleeperSyncing(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPassError('');
    setPassStatus(null);
    const overrides = (() => { try { return JSON.parse(localStorage.getItem(OWNERS_KEY) || '{}'); } catch { return {}; } })();
    const myOverride = overrides[teamId] || {};
    const expected = myOverride.password || DEFAULT_PASSWORD;
    if (currentPass !== expected) { setPassError('Current password is incorrect.'); return; }
    if (newPass.length < 8)       { setPassError('New password must be at least 8 characters.'); return; }
    if (newPass !== confirmPass)  { setPassError('New passwords do not match.'); return; }
    setPassStatus('saving');
    const next = { ...overrides, [teamId]: { ...myOverride, password: newPass, passwordSet: true } };
    localStorage.setItem(OWNERS_KEY, JSON.stringify(next));
    try {
      const res = await fetch(`${API_BASE}/api/v1/owners/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error('Server error');
      setPassStatus('saved');
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      setTimeout(() => setPassStatus(null), 3000);
    } catch {
      setPassStatus('error');
      setPassError('Saved locally but failed to sync to server. Try again.');
    }
  }

  const labelStyle = { fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, display: 'block' };
  const inputStyle = { width: '100%' };

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1>My Account &amp; Team</h1>
            <div className="sub">Customize how your team appears in the league</div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-dim)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'color .15s',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 40px' }}>

        {/* ── TEAM NAME TAB ── */}
        {activeTab === 'team' && (
          <div style={{ maxWidth: 640 }}>
            {/* Live preview */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28,
              padding: 20, borderRadius: 12, background: 'var(--panel-2)', border: '1px solid var(--border)',
            }}>
              <LogoPreview logo={logo} logoImg={logoImg} color={color} textColor={logoTextColor} size={72} />
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 20 }}>{teamName || '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{ownerName || '—'}</div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: color, border: '1px solid rgba(255,255,255,.15)' }} />
                  <span className="mono faint" style={{ fontSize: 11 }}>{color}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: color, color: logoTextColor, borderRadius: 3, padding: '1px 6px' }}>{logo.slice(0, 2).toUpperCase()}</span>
                </div>
              </div>
            </div>

            {/* Form fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
              <div>
                <label style={labelStyle}>Team Name</label>
                <input className="input" style={inputStyle} value={teamName} onChange={e => setTeamName(e.target.value)} placeholder={baseTeam.name} maxLength={40} />
              </div>
              <div>
                <label style={labelStyle}>Owner Name</label>
                <input className="input" style={inputStyle} value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder={baseTeam.owner} maxLength={40} />
              </div>
              <div>
                <label style={labelStyle}>Logo Text (2 letters)</label>
                <input className="input" style={inputStyle} value={logo} onChange={e => setLogo(e.target.value.slice(0, 2).toUpperCase())} placeholder={baseTeam.logo} maxLength={2} />
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Shown in standings, matchups, and draft tables</div>
              </div>
              <div>
                <label style={labelStyle}>Logo Background Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', padding: 2, background: 'var(--panel-2)' }} />
                  <input className="input" value={color} onChange={e => setColor(e.target.value)} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} maxLength={7} placeholder="#c6ff3a" />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Logo Text Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={logoTextColor} onChange={e => setLogoTextColor(e.target.value)} style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', padding: 2, background: 'var(--panel-2)' }} />
                  <input className="input" value={logoTextColor} onChange={e => setLogoTextColor(e.target.value)} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} maxLength={7} placeholder="#000000" />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Color of the initials shown inside the logo badge</div>
              </div>
            </div>

            {/* Logo image upload */}
            <div style={{ marginBottom: 28 }}>
              <label style={labelStyle}>Logo Image (optional)</label>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>
                Upload a PNG or JPG to use instead of the text initials.
              </div>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderRadius: 10,
                  border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                  background: dragOver ? 'rgba(198,255,58,.04)' : 'var(--panel-2)',
                  transition: 'border-color .15s, background .15s', cursor: 'pointer',
                }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {logoImg ? (
                  <>
                    <LogoPreview logo={logo} logoImg={logoImg} color={color} size={52} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Image uploaded</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Click to replace · drag a new image to swap</div>
                    </div>
                    <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={e => { e.stopPropagation(); setLogoImg(null); }}>Remove</button>
                  </>
                ) : (
                  <>
                    <div style={{ width: 52, height: 52, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🖼</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Drop image here or click to browse</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>PNG, JPG, SVG — max 2MB</div>
                    </div>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>

            {/* AI Logo Generator */}
            <div style={{ marginBottom: 32 }}>
              <label style={labelStyle}>AI Logo Generator</label>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12, lineHeight: 1.6 }}>
                Use ChatGPT, DALL·E, or Midjourney to generate a custom logo. Copy the prompt, generate, then paste the URL below or upload above.
              </div>
              <label style={{ ...labelStyle, marginBottom: 4 }}>Suggested Prompt</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input" style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} />
                <button className="btn ghost sm" style={{ flexShrink: 0, fontSize: 11 }} onClick={() => { navigator.clipboard?.writeText(aiPrompt); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000); }}>
                  {promptCopied ? '✓ Copied' : 'Copy Prompt'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <a href="https://chat.openai.com" target="_blank" rel="noreferrer" style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>🤖 Open ChatGPT ↗</a>
                <a href="https://labs.openai.com" target="_blank" rel="noreferrer" style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>🎨 Open DALL·E ↗</a>
                <a href="https://www.midjourney.com" target="_blank" rel="noreferrer" style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>✨ Open Midjourney ↗</a>
              </div>
              <label style={{ ...labelStyle, marginBottom: 4 }}>Import from URL</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Paste image URL from AI generator…" style={{ flex: 1, fontSize: 11 }} value={aiImgUrl} onChange={e => setAiImgUrl(e.target.value)} />
                <button className="btn primary sm" style={{ flexShrink: 0, fontSize: 11 }} disabled={!aiImgUrl.startsWith('http')} onClick={() => { setLogoImg(aiImgUrl); setAiImgUrl(''); }}>Use Image</button>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn primary" onClick={handleSave} style={{ minWidth: 120 }}>
                {saved ? '✓ Saved' : 'Save Changes'}
              </button>
              <button className="btn ghost" onClick={handleReset}>Reset to Defaults</button>
            </div>
            {saved && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>Changes saved — refresh any screen to see your updated logo and name.</div>}
          </div>
        )}

        {/* ── SLEEPER TAB ── */}
        {activeTab === 'sleeper' && (
          <div style={{ maxWidth: 600 }}>
            {/* ── Player Ranking Weights ── */}
            <div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text)' }}>Player Ranking Weights — Sleeper Slider</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.6 }}>
                  Rank features by priority and assign each a weight. Weights determine how players are scored and ranked on the Players page. Total should equal 100%.
                </div>
              </div>

              {/* Position pill selector */}
              <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, alignSelf: 'flex-start', marginBottom: 20, marginTop: 16, width: 'fit-content' }}>
                {SCORE_POSITIONS.map(pos => (
                  <button
                    key={pos}
                    onClick={() => setScoringPos(pos)}
                    style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: scoringPos === pos ? 700 : 500,
                      cursor: 'pointer', border: 'none',
                      background: scoringPos === pos ? 'var(--accent)' : 'transparent',
                      color: scoringPos === pos ? 'var(--accent-ink)' : 'var(--text-dim)',
                      transition: 'background .15s, color .15s',
                    }}
                  >{pos}</button>
                ))}
              </div>

              {/* Total bar */}
              {(() => {
                const features = scoringWeights[scoringPos] || [];
                const total = features.reduce((s, f) => s + (f.weight || 0), 0);
                const over  = total > 100;
                const exact = total === 100;
                const barColor = over ? 'var(--danger)' : exact ? 'var(--good)' : 'var(--accent)';
                return (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Total Weight</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: barColor }}>
                        {total}% {over ? '— over by ' + (total - 100) + '%' : exact ? '✓' : '— ' + (100 - total) + '% remaining'}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(total, 100)}%`, background: barColor, borderRadius: 3, transition: 'width .2s, background .2s' }} />
                    </div>
                  </div>
                );
              })()}

              {/* Feature rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(scoringWeights[scoringPos] || []).map((f, idx, arr) => (
                  <div
                    key={f.key}
                    style={{
                      display: 'grid', gridTemplateColumns: '22px 20px 20px 1fr 120px 42px',
                      alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderRadius: 8,
                      background: 'var(--panel-2)', border: '1px solid var(--border)',
                    }}
                  >
                    {/* Rank number */}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
                      {idx + 1}
                    </span>

                    {/* Up / Down */}
                    <button
                      onClick={() => moveFeature(scoringPos, idx, -1)}
                      disabled={idx === 0}
                      style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}
                    >↑</button>
                    <button
                      onClick={() => moveFeature(scoringPos, idx, 1)}
                      disabled={idx === arr.length - 1}
                      style={{ background: 'none', border: 'none', cursor: idx === arr.length - 1 ? 'default' : 'pointer', color: idx === arr.length - 1 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}
                    >↓</button>

                    {/* Feature label */}
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</span>

                    {/* Weight slider */}
                    <input
                      type="range"
                      min={0} max={100} step={1}
                      value={f.weight || 0}
                      onChange={e => setFeatureWeight(scoringPos, idx, Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />

                    {/* Weight % display */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13,
                      color: f.weight > 0 ? 'var(--accent)' : 'var(--text-faint)',
                      textAlign: 'right', whiteSpace: 'nowrap',
                    }}>
                      {f.weight || 0}%
                    </span>
                  </div>
                ))}
              </div>

              {/* Save / Reset */}
              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button className="btn primary" onClick={saveScoringWeights} style={{ minWidth: 140 }}>
                  {weightsSaved ? '✓ Saved' : 'Save Weights'}
                </button>
                <button className="btn ghost" onClick={resetScoringWeights}>Reset to Defaults</button>
              </div>
              {weightsSaved && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  Weights saved — Players page will use these rankings.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── APPEARANCE TAB ── */}
        {activeTab === 'appearance' && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 2 }}>Site Color Theme</label>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Changes apply instantly and sync to your account across all devices</div>
              </div>
              <button
                onClick={() => toggleLightMode(!lightMode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0, padding: 0,
                  border: '1px solid var(--border)', borderRadius: 20, background: 'var(--panel-2)',
                  cursor: 'pointer', overflow: 'hidden', fontFamily: 'var(--font-body)', fontSize: 11,
                }}
              >
                {['Dark', 'Light'].map(mode => {
                  const isActive = mode === 'Light' ? lightMode : !lightMode;
                  return (
                    <span key={mode} style={{ padding: '5px 14px', borderRadius: 20, background: isActive ? 'var(--accent)' : 'transparent', color: isActive ? 'var(--accent-ink)' : 'var(--text-faint)', fontWeight: isActive ? 700 : 400, transition: 'background .15s, color .15s' }}>
                      {mode === 'Dark' ? '◗ Dark' : 'Light ◖'}
                    </span>
                  );
                })}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 32 }}>
              {THEMES.map(t => (
                <button key={t.id} onClick={() => applyTheme(t.id, lightMode)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8,
                  cursor: 'pointer', border: `2px solid ${activeTheme === t.id ? t.accent : 'rgba(255,255,255,.12)'}`,
                  background: t.bg, color: '#e0e4f0', fontFamily: 'var(--font-body)', fontSize: 12,
                  fontWeight: activeTheme === t.id ? 700 : 400, transition: 'border-color .15s, box-shadow .15s',
                  boxShadow: activeTheme === t.id ? `0 0 0 1px ${t.accent}55, 0 0 16px ${t.accent}28` : '0 2px 8px rgba(0,0,0,.4)',
                }}>
                  <div style={{ display: 'flex', flexShrink: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)' }}>
                    <div style={{ width: 10, height: 16, background: t.accent }} />
                    <div style={{ width: 10, height: 16, background: t.accent2 }} />
                  </div>
                  {t.label}
                  {activeTheme === t.id && <span style={{ fontSize: 11, color: t.accent, marginLeft: 2 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── SECURITY TAB ── */}
        {activeTab === 'security' && (
          <div style={{ maxWidth: 480 }}>
            <label style={labelStyle}>Change Password</label>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 24, lineHeight: 1.6 }}>
              Update your login password. Changes are saved to your browser and synced to the league server.
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={labelStyle}>Current Password</label>
                <div style={{ position: 'relative' }}>
                  <input className="input" type={showCurrent ? 'text' : 'password'} value={currentPass} onChange={e => { setCurrentPass(e.target.value); setPassError(''); }} placeholder="Enter your current password" style={{ width: '100%', paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowCurrent(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                    {showCurrent ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>New Password</label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" type={showNew ? 'text' : 'password'} value={newPass} onChange={e => { setNewPass(e.target.value); setPassError(''); }} placeholder="Min. 8 characters" style={{ width: '100%', paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowNew(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                      {showNew ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Confirm New Password</label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" type={showConfirm ? 'text' : 'password'} value={confirmPass} onChange={e => { setConfirmPass(e.target.value); setPassError(''); }} placeholder="Repeat new password" style={{ width: '100%', paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowConfirm(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                      {showConfirm ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </div>
              {passError && <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>{passError}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button className="btn primary" type="submit" disabled={passStatus === 'saving' || !currentPass || !newPass || !confirmPass} style={{ minWidth: 160 }}>
                  {passStatus === 'saving' ? 'Saving…' : passStatus === 'saved' ? '✓ Password Updated' : 'Change Password'}
                </button>
                {passStatus === 'saved' && <span style={{ fontSize: 12, color: 'var(--good)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Synced to server</span>}
                {passStatus === 'error' && <span style={{ fontSize: 12, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>Saved locally · server sync failed</span>}
              </div>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
