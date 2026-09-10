# Palette

These names and values are taken directly from the product CSS. Roles summarize observed use; accent meanings vary by component.

| Token | Value | Observed use |
| --- | --- | --- |
| `--bg` | `#0f1115` | App background |
| `--fg` | `#d8dee9` | Primary text |
| `--muted` | `#888` | Secondary text |
| `--gutter` | `#4c566a` | Strong rules / gutters |
| `--border` | `#1f2430` | Subtle rules |
| `--accent-cyan` | `#88c0d0` | Primary action / focus / selection |
| `--accent-cyan-hover` | `#8fbcbb` | Alternate cyan |
| `--accent-green` | `#a3be8c` | Success / finalized / chat |
| `--accent-purple` | `#b48ead` | Output kind / detail / agents |
| `--accent-yellow` | `#ebcb8b` | Active tools / in progress / starred |
| `--accent-red` | `#bf616a` | Error / destructive action |

Terminal Markdown uses its own text palette: `--terminal-background: #0f1115`, `--terminal-foreground: #cdd6f4`, `--terminal-muted: #9399b2`, `--terminal-rule: #323232`, `--terminal-cyan: #88c0d0`, `--terminal-gold: #f9e2af`. Source code uses Shiki dark-plus; Markdown code fences use Catppuccin Mocha. Both theme definitions are bundled in `assets/themes/`.

Use `assets/palette.svg` for an editable swatch sheet. Translucent fills and component-specific literal colors are preserved in `style-inventory.json` with selectors and line numbers; this table is the root palette, not every color in the application.
