import { useLayoutEffect, useRef, useState } from 'react';

export type WindowPanelCommand = 'toggle-panel' | 'search-canvas' | 'search-project' | 'llm' | 'chat' | 'new-chat' | 'previous-chat' | 'next-chat';
export function windowPanelCommand(key: string, shift: boolean): WindowPanelCommand | undefined {
  switch (key.toLowerCase()) {
    case 'b': return 'toggle-panel';
    case 'f': return shift ? 'search-project' : 'search-canvas';
    case 'l': return 'llm';
    case 'a': return 'chat';
    case 'c': return 'new-chat';
    case 'pageup': return 'previous-chat';
    case 'pagedown': return 'next-chat';
  }
}

/** One global capture listener routes an explicitly armed sequence before editors/canvas shortcuts. */
export function useWindowPanelHotkeys(dispatch: (command: WindowPanelCommand) => void) {
  const handler = useRef(dispatch); handler.current = dispatch;
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    let armed = false, rightControl = false, timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { armed = false; clearTimeout(timer); setPending(false); };
    const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'ControlRight') rightControl = true;
      if (event.isComposing || event.key === 'Process') { cancel(); return; }
      if (event.code === 'ControlLeft') rightControl = false;
      const prefix = event.ctrlKey && !rightControl && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b';
      if (prefix) {
        consume(event);
        if (event.repeat) return;
        if (armed) { cancel(); handler.current('toggle-panel'); return; }
        cancel(); armed = true; setPending(true); timer = setTimeout(cancel, 2000); return;
      }
      if (!armed || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      const command = !event.metaKey && !event.altKey ? windowPanelCommand(event.key, event.shiftKey) : undefined;
      cancel();
      if (event.key === 'Escape') { consume(event); return; }
      if (command) { consume(event); if (!event.repeat) handler.current(command); }
      // Unknown keys resume ordinary typing rather than swallowing the user's input.
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'ControlRight') rightControl = false; };
    const blur = () => { rightControl = false; cancel(); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', blur);
    return () => {
      clearTimeout(timer); window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', blur);
    };
  }, []);
  return pending;
}
