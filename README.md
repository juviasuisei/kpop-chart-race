# K-Pop Chart Race

An animated bar chart race visualization showing K-pop artist chart performance over time. Watch artists compete as their cumulative scores grow across music show appearances.

## Features

- Animated horizontal bar chart race with smooth transitions
- Color-coded bars by artist type (boy group, girl group, solo, mixed)
- Generation badges, featured release labels, and chart win crowns
- Play/pause controls with timeline scrubber
- Detail panel with vertical timeline, embedded media (YouTube, Apple Music, Instagram, TikTok)
- Responsive design (mobile + desktop)
- Accessibility: colorblind-friendly palette, screen reader paced mode, WCAG AA contrast

## Tech Stack

- Vanilla TypeScript (no framework)
- Vite (build tool)
- Vitest + fast-check (TDD with property-based testing)
- GitHub Pages (hosting)

## Getting Started

```bash
# Requires Node 20+ (use nvm if needed)
nvm use

# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Data

Artist data lives in `data/` as individual JSON files (one per artist). See `data/index.json` for the manifest. Placeholder data is included for development — swap with real data when ready.

## License

MIT
