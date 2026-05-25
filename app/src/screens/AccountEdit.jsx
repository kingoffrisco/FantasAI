import React from 'react';
import { LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { getMyTeamPrefs, saveMyTeamPrefs, clearMyTeamPrefs } from '../lib/leagueStore.js';

const LIGHT_SURFACE_VARS = {
  '--bg': '#f4f5f8', '--bg-2': '#eceef4', '--panel': '#ffffff',
  '--panel-2': '#f0f1f6', '--panel-3': '#e7eaf2',
  '--border': '#d3d7e8', '--border-strong': '#b6bbcf', '--hover': '#e4e7f0',
  '--text': '#191c2e', '--text-dim': '#4a5270', '--text-faint': '#8890aa',
};

const THEMES = [
  { id: 'sportsbook-dark', label: 'Sportsbook Dark', accent: '#c6ff3a', bg: '#060912' },
  { id: 'midnight-gold',   label: 'Midnight Gold',   accent: '#ffd700', bg: '#080808' },
  { id: 'raven-purple',    label: 'Raven Purple',    accent: '#b78bff', bg: '#07050f' },
  { id: 'gridiron-green',  label: 'Gridiron Green',  accent: '#00e676', bg: '#050c08' },
  { id: 'blitz-red',       label: 'Blitz Red',       accent: '#ff4d6d', bg: '#0c0608' },
];

const THEME_VARS = {
  'sportsbook-dark': {
    '--bg': '#060912', '--bg-2': '#0a0f1d', '--panel': '#0f1424', '--panel-2': '#161d33',
    '--panel-3': '#1c2540', '--border': '#1f2740', '--border-strong': '#2c365a', '--hover': '#19223b',
    '--accent': '#c6ff3a', '--accent-ink': '#0a1300', '--accent-2': '#4ea8ff',
  },
  'midnight-gold': {
    '--bg': '#080808', '--bg-2': '#0d0d0d', '--panel': '#141414', '--panel-2': '#1a1a1a',
    '--panel-3': '#212121', '--border': '#2a2a2a', '--border-strong': '#3c3c3c', '--hover': '#1f1f1f',
    '--accent': '#ffd700', '--accent-ink': '#1a1200', '--accent-2': '#ffa733',
  },
  'raven-purple': {
    '--bg': '#07050f', '--bg-2': '#0c0918', '--panel': '#110d20', '--panel-2': '#17112b',
    '--panel-3': '#1d1535', '--border': '#271f42', '--border-strong': '#382c5c', '--hover': '#1a1430',
    '--accent': '#b78bff', '--accent-ink': '#120040', '--accent-2': '#ff8bcc',
  },
  'gridiron-green': {
    '--bg': '#050c08', '--bg-2': '#091410', '--panel': '#0c1610', '--panel-2': '#111e16',
    '--panel-3': '#16261b', '--border': '#1e3427', '--border-strong': '#2b4d38', '--hover': '#132019',
    '--accent': '#00e676', '--accent-ink': '#001a0d', '--accent-2': '#ffb700',
  },
  'blitz-red': {
    '--bg': '#0c0608', '--bg-2': '#150a0d', '--panel': '#1a0e11', '--panel-2': '#211218',
    '--panel-3': '#27161e', '--border': '#361e27', '--border-strong': '#502c3d', '--hover': '#1f1015',
    '--accent': '#ff4d6d', '--accent-ink': '#1a0010', '--accent-2': '#ffb547',
  },
};

function LogoPreview({ logo, logoImg, color, size = 64 }) {
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
        : <span style={{ fontSize: size * 0.28, fontWeight: 900, color: '#000', letterSpacing: '-0.04em' }}>
            {(logo || '??').slice(0, 2).toUpperCase()}
          </span>
      }
    </div>
  );
}

export default function AccountEditScreen({ user }) {
  const teamId = user?.teamId || 1;
  const baseTeam = (getLiveTeamBase(teamId));

  function getLiveTeamBase(id) {
    return LEAGUE_TEAMS.find(t => t.id === id) || LEAGUE_TEAMS[0];
  }

  const savedPrefs = getMyTeamPrefs() || {};

  const [teamName, setTeamName]   = React.useState(savedPrefs.name   ?? baseTeam.name);
  const [ownerName, setOwnerName] = React.useState(savedPrefs.owner  ?? baseTeam.owner);
  const [logo, setLogo]           = React.useState(savedPrefs.logo   ?? baseTeam.logo);
  const [color, setColor]         = React.useState(savedPrefs.color  ?? baseTeam.color);
  const [logoImg, setLogoImg]     = React.useState(savedPrefs.logoImg ?? null);
  const [saved, setSaved]         = React.useState(false);
  const [dragOver, setDragOver]   = React.useState(false);
  const [activeTheme, setActiveTheme] = React.useState(localStorage.getItem('fantasai_theme') || 'sportsbook-dark');
  const [lightMode, setLightMode] = React.useState(localStorage.getItem('fantasai_light_mode') === 'true');
  const [aiPrompt, setAiPrompt]   = React.useState('');
  const [aiImgUrl, setAiImgUrl]   = React.useState('');
  const [promptCopied, setPromptCopied] = React.useState(false);
  const fileRef = React.useRef(null);

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => setLogoImg(e.target.result);
    reader.readAsDataURL(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  function handleSave() {
    const prefs = {
      name: teamName.trim() || baseTeam.name,
      owner: ownerName.trim() || baseTeam.owner,
      logo: logo.slice(0, 2).toUpperCase() || baseTeam.logo,
      color,
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
    setLogoImg(null);
  }

  function applyTheme(themeId, isLight) {
    const vars = THEME_VARS[themeId];
    if (!vars) return;
    const merged = isLight ?? lightMode
      ? { ...vars, ...LIGHT_SURFACE_VARS }
      : vars;
    Object.entries(merged).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    localStorage.setItem('fantasai_theme', themeId);
    setActiveTheme(themeId);
  }

  function toggleLightMode(next) {
    localStorage.setItem('fantasai_light_mode', next ? 'true' : 'false');
    setLightMode(next);
    applyTheme(activeTheme, next);
  }

  React.useEffect(() => {
    const savedTheme = localStorage.getItem('fantasai_theme');
    const savedLight = localStorage.getItem('fantasai_light_mode') === 'true';
    if (savedTheme && THEME_VARS[savedTheme]) applyTheme(savedTheme, savedLight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    setAiPrompt(`Fantasy football team logo for "${teamName}", sports emblem, bold design, dark background, professional`);
  }, [teamName]);

  const labelStyle = { fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6, display: 'block' };
  const inputStyle = { width: '100%' };

  return (
    <div className="col" style={{ height: '100%' }}>

      <div className="page-head">
        <div>
          <h1>My Account &amp; Team</h1>
          <div className="sub">Customize how your team appears in the league</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 40px' }}>

        {/* ── Live preview card ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32,
          padding: 20, borderRadius: 12, background: 'var(--panel-2)',
          border: '1px solid var(--border)',
        }}>
          <LogoPreview logo={logo} logoImg={logoImg} color={color} size={72} />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 20 }}>
              {teamName || '—'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{ownerName || '—'}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-block', width: 16, height: 16, borderRadius: 4,
                background: color, border: '1px solid rgba(255,255,255,.15)',
              }} />
              <span className="mono faint" style={{ fontSize: 11 }}>{color}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                background: color, color: '#000', borderRadius: 3, padding: '1px 6px',
              }}>{logo.slice(0, 2).toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* ── Site Color Theme ── */}
        <div style={{ maxWidth: 640, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Site Color Theme</label>
            {/* Light / Dark toggle */}
            <button
              onClick={() => toggleLightMode(!lightMode)}
              style={{
                display: 'flex', alignItems: 'center', gap: 0,
                padding: 0, border: '1px solid var(--border)', borderRadius: 20,
                background: 'var(--panel-2)', cursor: 'pointer', overflow: 'hidden',
                fontFamily: 'var(--font-body)', fontSize: 11,
              }}
            >
              {['Dark', 'Light'].map(mode => {
                const isActive = mode === 'Light' ? lightMode : !lightMode;
                return (
                  <span key={mode} style={{
                    padding: '5px 14px', borderRadius: 20,
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'var(--accent-ink)' : 'var(--text-faint)',
                    fontWeight: isActive ? 700 : 400,
                    transition: 'background .15s, color .15s',
                  }}>
                    {mode === 'Dark' ? '◗ Dark' : 'Light ◖'}
                  </span>
                );
              })}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => applyTheme(t.id, lightMode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `2px solid ${activeTheme === t.id ? t.accent : 'var(--border)'}`,
                  background: t.bg, color: '#e8ecf7',
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  fontWeight: activeTheme === t.id ? 700 : 400,
                  transition: 'border-color .15s, box-shadow .15s',
                  boxShadow: activeTheme === t.id ? `0 0 0 1px ${t.accent}44, 0 0 12px ${t.accent}22` : 'none',
                }}
              >
                <div style={{ width: 14, height: 14, borderRadius: 3, background: t.accent, flexShrink: 0 }} />
                {t.label}
                {activeTheme === t.id && <span style={{ fontSize: 10, color: t.accent, marginLeft: 2 }}>✓</span>}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
            Changes apply instantly across the whole site and are remembered for your browser.
          </div>
        </div>

        {/* ── Form fields ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 640 }}>

          <div>
            <label style={labelStyle}>Team Name</label>
            <input
              className="input"
              style={inputStyle}
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder={baseTeam.name}
              maxLength={40}
            />
          </div>

          <div>
            <label style={labelStyle}>Owner Name</label>
            <input
              className="input"
              style={inputStyle}
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              placeholder={baseTeam.owner}
              maxLength={40}
            />
          </div>

          <div>
            <label style={labelStyle}>Logo Text (2 letters)</label>
            <input
              className="input"
              style={inputStyle}
              value={logo}
              onChange={e => setLogo(e.target.value.slice(0, 2).toUpperCase())}
              placeholder={baseTeam.logo}
              maxLength={2}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Shown in standings, matchups, and draft tables
            </div>
          </div>

          <div>
            <label style={labelStyle}>Team Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', padding: 2, background: 'var(--panel-2)' }}
              />
              <input
                className="input"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                maxLength={7}
                placeholder="#c6ff3a"
              />
            </div>
          </div>
        </div>

        {/* ── Logo image upload ── */}
        <div style={{ maxWidth: 640, marginTop: 28 }}>
          <label style={labelStyle}>Logo Image (optional)</label>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>
            Upload a PNG or JPG to use instead of the text initials. Shown in your team card and profile.
          </div>

          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '20px 24px', borderRadius: 10,
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
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    Click to replace · drag a new image to swap
                  </div>
                </div>
                <button
                  className="btn sm ghost"
                  style={{ marginLeft: 'auto' }}
                  onClick={e => { e.stopPropagation(); setLogoImg(null); }}
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <div style={{
                  width: 52, height: 52, borderRadius: 10, background: 'var(--panel)',
                  border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 22, flexShrink: 0,
                }}>🖼</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Drop image here or click to browse</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>PNG, JPG, SVG — max 2MB</div>
                </div>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
        </div>

        {/* ── AI Logo Generator ── */}
        <div style={{ maxWidth: 640, marginTop: 28 }}>
          <label style={labelStyle}>AI Logo Generator</label>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12, lineHeight: 1.6 }}>
            Use ChatGPT, DALL·E, or Midjourney to generate a custom logo. Copy the suggested prompt, generate your image, then paste its URL below or upload the file above.
          </div>

          <label style={{ ...labelStyle, marginBottom: 4 }}>Suggested Prompt</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
            />
            <button
              className="btn ghost sm"
              style={{ flexShrink: 0, fontSize: 11 }}
              onClick={() => { navigator.clipboard?.writeText(aiPrompt); setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000); }}
            >
              {promptCopied ? '✓ Copied' : 'Copy Prompt'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <a href="https://chat.openai.com" target="_blank" rel="noreferrer"
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              🤖 Open ChatGPT ↗
            </a>
            <a href="https://labs.openai.com" target="_blank" rel="noreferrer"
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              🎨 Open DALL·E ↗
            </a>
            <a href="https://www.midjourney.com" target="_blank" rel="noreferrer"
              style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--text-dim)', textDecoration: 'none', background: 'var(--panel-2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              ✨ Open Midjourney ↗
            </a>
          </div>

          <label style={{ ...labelStyle, marginBottom: 4 }}>Import from URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              placeholder="Paste image URL from AI generator…"
              style={{ flex: 1, fontSize: 11 }}
              value={aiImgUrl}
              onChange={e => setAiImgUrl(e.target.value)}
            />
            <button
              className="btn primary sm"
              style={{ flexShrink: 0, fontSize: 11 }}
              disabled={!aiImgUrl.startsWith('http')}
              onClick={() => { setLogoImg(aiImgUrl); setAiImgUrl(''); }}
            >
              Use Image
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
            Or download the image and upload it directly using the drop zone above.
          </div>
        </div>

        {/* ── Actions ── */}
        <div style={{ marginTop: 32, display: 'flex', gap: 12, maxWidth: 640 }}>
          <button className="btn primary" onClick={handleSave} style={{ minWidth: 120 }}>
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
          <button className="btn ghost" onClick={handleReset}>
            Reset to Defaults
          </button>
        </div>

        {saved && (
          <div style={{
            marginTop: 12, fontSize: 13, color: 'var(--accent)',
            fontFamily: 'var(--font-mono)', letterSpacing: '.04em',
          }}>
            Changes saved — refresh any screen to see your updated logo and name.
          </div>
        )}

      </div>
    </div>
  );
}
