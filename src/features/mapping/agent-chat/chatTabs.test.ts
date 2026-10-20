import { expect, it } from 'vitest';
import { activateChatTab, closeChatTab, cycleChatTab } from './chatTabs';
it('opens independent chats, reuses history tabs, and cycles in their visible order', () => {
  let tabs = { ids: ['one'], selected: 'one' };
  tabs = activateChatTab(tabs, 'two'); tabs = activateChatTab(tabs, 'three'); tabs = activateChatTab(tabs, 'one');
  expect(tabs).toEqual({ ids: ['one', 'two', 'three'], selected: 'one' });
  expect(cycleChatTab(tabs, -1).selected).toBe('three');
  expect(cycleChatTab(tabs, 1).selected).toBe('two');
});
it('closing selects the adjacent tab without removing other conversations', () => {
  const tabs = { ids: ['one', 'two', 'three'], selected: 'two' };
  expect(closeChatTab(tabs, 'two')).toEqual({ ids: ['one', 'three'], selected: 'three' });
  expect(closeChatTab(tabs, 'one')).toEqual({ ids: ['two', 'three'], selected: 'two' });
  const last = closeChatTab({ ids: ['one'], selected: 'one' }, 'one');
  expect(last.ids).toEqual([last.selected]); expect(last.selected).toMatch(/^draft:/);
});
