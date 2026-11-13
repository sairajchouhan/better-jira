# Notch logo kit

## Drop into <head>
```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B0B0E" media="(prefers-color-scheme: dark)">
```
`favicon.svg` swaps ink and accent with the browser theme. `favicon.ico` is the fallback and sits on a dark tile so it reads on any tab.

## Which file where
| Use | File |
|---|---|
| In-app logo, 48px and up, dark UI | svg/notch-mark-on-dark.svg |
| In-app logo, 48px and up, light UI | svg/notch-mark-on-light.svg |
| Under 48px (sidebar, nav, buttons) | svg/notch-small-on-dark.svg / notch-small-on-light.svg |
| One-color (print, embossing, photos, accent fills) | svg/notch-mark-mono-white.svg / mono-black.svg |
| App stores / launchers | svg/notch-app-icon.svg, png/icon-*.png |
| Social profile pictures | png/social-avatar-800.png |

The small cut is pixel-snapped on a 16-unit grid with a wider gap, so the block stays separate at 16-24px. Do not scale the 100-unit master below 48px.

## Colors
- Ink on light: #141417 · Ink on dark: #EDEDF0
- Accent on dark UI: #8B8FF8 · Accent on light UI: #5B60E0 (both clear 3:1 against their backgrounds)
- Icon tile: #17171C
- Clear space: the block's width on every side.
