import { useState } from 'react';

export function CopyDiagramAsciiButton({ ascii }: { ascii: string }) {
  const [status, setStatus] = useState('');
  return <button type="button" aria-label="Copy diagram as ASCII" aria-live="polite"
    title="Copy the complete diagram as plain ASCII, including collapsed content"
    onBlur={() => setStatus('')}
    onClick={async () => {
      try { await navigator.clipboard.writeText(ascii); setStatus('Copied'); }
      catch { setStatus('Copy failed'); }
    }}>{status || 'Copy ASCII'}</button>;
}
