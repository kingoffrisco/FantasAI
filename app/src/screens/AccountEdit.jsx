import React from 'react';
import { LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { getMyTeamPrefs, saveMyTeamPrefs, clearMyTeamPrefs } from '../lib/leagueStore.js';

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
  const VALID_THEME_IDS = new Set(THEMES.map(t => t.id));
  const storedTheme = localStorage.getItem('fantasai_theme') || 'sportsbook-dark';
  const [activeTheme, setActiveTheme] = React.useState(VALID_THEME_IDS.has(storedTheme) ? storedTheme : 'sportsbook-dark');
  const [lightMode, setLightMode] = React.useState(localStorage.getItem('fantasai_light_mode') === 'true');
  const [aiPrompt, setAiPrompt]   = React.useState('');
  const [aiImgUrl, setAiImgUrl]   = React.useState('');
  const [promptCopied, setPromptCopied] = React.useState(false);
  const fileRef = React.useRef(null);

  // ── Change Password state ──
  const [currentPass, setCurrentPass]   = React.useState('');
  const [newPass, setNewPass]           = React.useState('');
  const [confirmPass, setConfirmPass]   = React.useState('');
  const [showCurrent, setShowCurrent]   = React.useState(false);
  const [showNew, setShowNew]           = React.useState(false);
  const [showConfirm, setShowConfirm]   = React.useState(false);
  const [passError, setPassError]       = React.useState('');
  const [passStatus, setPassStatus]     = React.useState(null); // null | 'saving' | 'saved' | 'error'

  const API_BASE = 'https://api.fantasai.net';
  const OWNERS_KEY = 'fantasai_owners_config';
  const DEFAULT_PASSWORD = 'fantasy2025';

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
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
      setTimeout(() => setPassStatus(null), 3000);
    } catch {
      setPassStatus('error');
      setPassError('Saved locally but failed to sync to server. Try again.');
    }
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
    const vars = THEME_VARS[themeId] ?? THEME_VARS['sportsbook-dark'];
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
                  border: `2px solid ${activeTheme === t.id ? t.accent : 'rgba(255,255,255,.12)'}`,
                  background: t.bg, color: '#e0e4f0',
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  fontWeight: activeTheme === t.id ? 700 : 400,
                  transition: 'border-color .15s, box-shadow .15s',
                  boxShadow: activeTheme === t.id ? `0 0 0 1px ${t.accent}55, 0 0 16px ${t.accent}28` : '0 2px 8px rgba(0,0,0,.4)',
                }}
              >
                {/* Dual-color swatch */}
                <div style={{ display: 'flex', flexShrink: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)' }}>
                  <div style={{ width: 10, height: 16, background: t.accent }} />
                  <div style={{ width: 10, height: 16, background: t.accent2 }} />
                </div>
                {t.label}
                {activeTheme === t.id && <span style={{ fontSize: 11, color: t.accent, marginLeft: 2 }}>✓</span>}
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

        {/* ── Change Password ── */}
        <div style={{ maxWidth: 640, marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
          <label style={labelStyle}>Change Password</label>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 18, lineHeight: 1.6 }}>
            Update your login password. Changes are saved to your browser and synced to the league server.
          </div>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Current password */}
            <div>
              <label style={labelStyle}>Current Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPass}
                  onChange={e => { setCurrentPass(e.target.value); setPassError(''); }}
                  placeholder="Enter your current password"
                  style={{ width: '100%', paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowCurrent(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                  {showCurrent ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* New password row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>New Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    type={showNew ? 'text' : 'password'}
                    value={newPass}
                    onChange={e => { setNewPass(e.target.value); setPassError(''); }}
                    placeholder="Min. 8 characters"
                    style={{ width: '100%', paddingRight: 40 }}
                  />
                  <button type="button" onClick={() => setShowNew(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                    {showNew ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Confirm New Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPass}
                    onChange={e => { setConfirmPass(e.target.value); setPassError(''); }}
                    placeholder="Repeat new password"
                    style={{ width: '100%', paddingRight: 40 }}
                  />
                  <button type="button" onClick={() => setShowConfirm(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 15, padding: 0, lineHeight: 1 }}>
                    {showConfirm ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            </div>

            {passError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>{passError}</div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                className="btn primary"
                type="submit"
                disabled={passStatus === 'saving' || !currentPass || !newPass || !confirmPass}
                style={{ minWidth: 160 }}
              >
                {passStatus === 'saving' ? 'Saving…' : passStatus === 'saved' ? '✓ Password Updated' : 'Change Password'}
              </button>
              {passStatus === 'saved' && (
                <span style={{ fontSize: 12, color: 'var(--good)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  Synced to server
                </span>
              )}
              {passStatus === 'error' && (
                <span style={{ fontSize: 12, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
                  Saved locally · server sync failed
                </span>
              )}
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
