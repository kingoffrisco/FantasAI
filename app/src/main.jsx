import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Catch pre-React module errors and display them in the DOM
let _reactMounted = false;
window.addEventListener('error', (e) => {
  if (_reactMounted) return; // React ErrorBoundary will handle render errors
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '';
    root.style.cssText = 'font-family:monospace;padding:32px;color:#ff5a6e;background:#0d0d0d;min-height:100vh';
    root.innerHTML = `<h2>Script Error</h2><pre style="white-space:pre-wrap;font-size:13px">${e.message}\n\n${e.filename}:${e.lineno}\n\n${e.error?.stack || ''}</pre>`;
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (_reactMounted) return;
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '';
    root.style.cssText = 'font-family:monospace;padding:32px;color:#ff5a6e;background:#0d0d0d;min-height:100vh';
    root.innerHTML = `<h2>Unhandled Promise Rejection</h2><pre style="white-space:pre-wrap;font-size:13px">${String(e.reason)}\n\n${e.reason?.stack || ''}</pre>`;
  }
});

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: 'monospace', padding: 32, color: '#ff5a6e', background: '#0d0d0d', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 12 }}>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{String(this.state.error)}</pre>
          {this.state.error.stack && (
            <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontSize: 11, color: '#888' }}>{this.state.error.stack}</pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  _reactMounted = true;
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (e) {
  _reactMounted = false;
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '';
    root.style.cssText = 'font-family:monospace;padding:32px;color:#ff5a6e;background:#0d0d0d;min-height:100vh';
    root.innerHTML = `<h2>Mount Error</h2><pre style="white-space:pre-wrap;font-size:13px">${String(e)}\n\n${e.stack || ''}</pre>`;
  }
}
