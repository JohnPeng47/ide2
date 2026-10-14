export type ThemeName = 'dark' | 'light';
export const themeDefinitions = {
  dark: { label: 'Current Dark', source: 'dark-plus', markdown: 'catppuccin-mocha', browserColor: '#0f1115' },
  light: { label: 'Neutral Light', source: 'light-plus', markdown: 'catppuccin-latte', browserColor: '#f3f4f6' }
} as const;
