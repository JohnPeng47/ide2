import { useState } from 'react';
export function CopyButton({ text, label = 'Copy' }: { text: string | (() => string); label?: string }) {
  const [status, setStatus] = useState('');
  return <button type="button" title={status || label} aria-label={status || label} onBlur={() => setStatus('')}
    onClick={async () => { try { await navigator.clipboard.writeText(typeof text === 'function' ? text() : text); setStatus('Copied'); } catch { setStatus('Copy failed'); } }}>{status || label}</button>;
}
