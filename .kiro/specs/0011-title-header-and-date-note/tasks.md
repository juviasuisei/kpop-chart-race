# Tasks

- [-] 1. Add title header DOM to ChartRaceRenderer.mount()
  - [x] 1.1 Import `pkg` from `'../package.json'` at the top of `src/chart-race-renderer.ts`
  - [x] 1.2 In `mount()`, create `.chart-race__title-header` div containing `.chart-race__title-text` span ("K-Pop Chart Race"), `.chart-race__version-badge` span (`v${pkg.version}`), and `.chart-race__data-note` div (empty). Insert before the date display element.
  - [x] 1.3 Add private field `dataNote` and assign it during mount; clear it in `destroy()`
- [x] 2. Add `setDataNote(startDate: string)` method to ChartRaceRenderer
  - [x] 2.1 If `startDate` is non-empty, set `this.dataNote.textContent` to `"Includes points earned from {startDate} forward"`; otherwise set it to `""`
- [x] 3. Call `renderer.setDataNote()` in main.ts
  - [x] 3.1 After `renderer.mount(app)`, add `renderer.setDataNote(dataStore.startDate)`
- [x] 4. Add CSS for title header in src/style.css
  - [x] 4.1 Add styles for `.chart-race__title-header`, `.chart-race__title-text`, `.chart-race__version-badge`, `.chart-race__data-note` with appropriate font sizes, positioning, and mobile responsive rules under the existing `@media (max-width: 767px)` block
- [x] 5. Bump version to 0.6.0
  - [x] 5.1 Update `"version"` in `package.json` from `"0.5.0"` to `"0.6.0"`
- [x] 6. Add unit tests
  - [x] 6.1 Add tests in `tests/unit/chart-race-renderer.test.ts` verifying: mount creates `.chart-race__title-header`, title text is "K-Pop Chart Race", version badge contains "v", `setDataNote` sets correct text, `setDataNote("")` leaves note empty, destroy removes title header
