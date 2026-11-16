import { LineChartController } from '../../src/views/line-chart-controller.ts';
import { computeChartWins } from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist, ParsedRelease } from '../../src/models.ts';

/**
 * Win credit must be attributed to the SONG that won, not to every song of the
 * winning artist (hover tooltip crown + win totals, songs mode).
 */

const DATES = ['2024-01-01', '2024-01-02', '2024-01-03'];
const D = '2024-01-02';

function release(id: string, values: Record<string, [number, string]>): ParsedRelease {
  return {
    id,
    title: `Song ${id}`,
    artistIds: ['a'],
    embeds: new Map(),
    dailyValues: new Map(
      Object.entries(values).map(([d, [value, source]]) => [d, { value, source, episode: 1 }]),
    ),
  } as ParsedRelease;
}

function artist(id: string, releases: ParsedRelease[]): ParsedArtist {
  return {
    id, name: id, artistType: 'girl_group', generation: 4, logoUrl: '',
    releases, albumReleases: [],
  } as ParsedArtist;
}

function buildStore(artists: ParsedArtist[]): DataStore {
  const ds: DataStore = {
    artists: new Map(artists.map((a) => [a.id, a])),
    dates: DATES, startDate: DATES[0], endDate: DATES[2],
    firstAppearance: new Map(), chartWins: new Map(), releaseWinDates: new Map(),
  };
  const w = computeChartWins(ds);
  ds.chartWins = w.chartWins;
  ds.releaseWinDates = w.releaseWinDates;
  return ds;
}

interface Harness { ctrl: any; shown: any[] }

function harness(ds: DataStore, filter = 'all'): Harness {
  const ctrl: any = Object.create(LineChartController.prototype);
  const shown: any[] = [];
  ctrl.dataStore = ds;
  ctrl.currentSourceFilter = filter;
  ctrl.lineMetadata = new Map<string, unknown>([
    ['a::x', { label: 'X', artistId: 'a', releaseId: 'x' }],
    ['a::y', { label: 'Y', artistId: 'a', releaseId: 'y' }],
    ['a', { label: 'A', artistId: 'a' }],
  ]);
  ctrl.state = { dates: DATES, viewportStart: 0, viewportEnd: 2, currentDateIndex: 2 };
  ctrl.renderer = { getSize: () => ({ width: 310, height: 400 }) };
  ctrl.tooltip = { show: (d: unknown) => shown.push(d) };
  return { ctrl, shown };
}

// width 310 - right padding 210 = 100px chart; 3 dates -> date index = round(x/100*3)
const X_FOR_D = 100 / 3;

function hover(h: Harness, lineId: string) {
  h.ctrl.showRichTooltip(X_FOR_D, 100, { lineId, color: '#fff', points: [] }, 0);
  return h.shown[h.shown.length - 1];
}

// artist "a" has two songs on the board; song x beats the rival on D, song y does not.
function twoSongStore(ySource = 'inkigayo'): DataStore {
  return buildStore([
    artist('a', [
      release('x', { [D]: [500, 'inkigayo'] }),
      release('y', { [D]: [50, ySource] }),
    ]),
    artist('b', [{ ...release('r', { [D]: [100, 'inkigayo'] }), artistIds: ['b'] }]),
  ]);
}

describe('song win attribution on hover (songs mode)', () => {
  it('shows the crown for the song that actually won', () => {
    const h = harness(twoSongStore());
    expect(hover(h, 'a::x').winInfo).toBeDefined();
    expect(hover(h, 'a::x').songBreakdown).toBeUndefined();
  });

  it('does NOT show the crown for a sibling song that did not win that day', () => {
    const h = harness(twoSongStore());
    expect(hover(h, 'a::y').winInfo).toBeUndefined();
  });

  it('artists mode still credits the artist, with only the winning song marked in the breakdown', () => {
    const h = harness(twoSongStore());
    const t = hover(h, 'a');
    expect(t.winInfo).toBeDefined();
    const flags = Object.fromEntries(t.songBreakdown.map((s: any) => [s.title, !!s.isWin]));
    expect(flags).toEqual({ 'Song x': true, 'Song y': false });
  });

  it('with a source filter, a song does not inherit a win its artist earned on that source with another song', () => {
    // x wins inkigayo on D; y (the_show) wins the_show on D (rival only on inkigayo).
    const ds = buildStore([
      artist('a', [release('x', { [D]: [500, 'inkigayo'] }), release('y', { [D]: [50, 'the_show'] })]),
      artist('b', [{ ...release('r', { [D]: [100, 'inkigayo'] }), artistIds: ['b'] }]),
    ]);
    const h = harness(ds, 'the_show');
    expect(hover(h, 'a::x').winInfo).toBeUndefined();
    expect(hover(h, 'a::y').winInfo).toBeDefined();
  });
});

describe('win totals (right-hand label)', () => {
  it('songs mode, all sources: counts only the song\'s own wins', () => {
    const h = harness(twoSongStore());
    expect(h.ctrl.getWinCount('a::x')).toBe(1);
    expect(h.ctrl.getWinCount('a::y')).toBe(0);
  });

  it('songs mode with a source filter: a win on another source is not credited', () => {
    const ds = buildStore([
      artist('a', [release('x', { [D]: [500, 'inkigayo'] }), release('y', { [D]: [50, 'the_show'] })]),
      artist('b', [{ ...release('r', { [D]: [100, 'inkigayo'] }), artistIds: ['b'] }]),
    ]);
    const h = harness(ds, 'the_show');
    expect(h.ctrl.getWinCount('a::x')).toBe(0);
    expect(h.ctrl.getWinCount('a::y')).toBe(1);
  });

  it('artists mode counts every win of the artist', () => {
    const h = harness(twoSongStore());
    expect(h.ctrl.getWinCount('a')).toBe(1);
  });
});
