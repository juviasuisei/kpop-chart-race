# Project Conventions

## Versioning
- Bugfix commits: bump patch version (e.g., 0.9.0 → 0.9.1)
- Feature commits: bump minor version (e.g., 0.9.0 → 0.10.0)
- Major version bumps only when explicitly asked
- Always bump the version in package.json with every commit that changes functionality

## Git
- Commit at top-level task level, not sub-tasks
- Run tests before committing
- Push after every commit
- Run `npx tsc --noEmit` before committing to catch TypeScript errors that block CI deploy
- Always do optional tasks (marked with `*` in tasks.md)

## Data Files
- Each JSON file is a single ArtistEntry (not an array)
- Logo path is derived from the JSON filename (e.g., bts.json → assets/logos/bts.svg)
- Data manifest (public/data/index.json) is auto-generated and gitignored
- Artist logos are white SVGs; source show logos are PNGs
- korean_name and debut are optional fields

## Specs
- Spec numbering: 4-digit zero-padded prefix (0001-, 0002-, etc.) in .kiro/specs/
- Specs are historical records; new bugs/features get new specs
- Tests are the living source of truth

## Chart Sources
- Validated set: inkigayo, the_show, show_champion, music_bank, m_countdown, show_music_core
- Each has a PNG logo in public/assets/sources/

## Crown Levels
- Unbounded total wins (not consecutive)
- Levels 13+ repeat crown-12 icon
- Labels: Win, 2nd Win, Triple Crown, 4th Win, ..., 2nd Triple Crown, etc.
