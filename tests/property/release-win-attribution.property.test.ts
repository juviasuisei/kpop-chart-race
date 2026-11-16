import fc from 'fast-check';
import { computeChartWins, getReleaseWinOnDate } from '../../src/chart-engine.ts';
import type { DataStore, ParsedArtist } from '../../src/models.ts';

const DATES = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];
const SOURCES = ['inkigayo', 'the_show', 'music_bank'];

// artists -> releases -> optional (value, source) per date
const arbStore = fc.array(
  fc.array(
    fc.array(
      fc.option(fc.record({ value: fc.integer({ min: 1, max: 5 }), source: fc.constantFrom(...SOURCES) }), { nil: undefined }),
      { minLength: DATES.length, maxLength: DATES.length },
    ),
    { minLength: 1, maxLength: 3 },
  ),
  { minLength: 1, maxLength: 4 },
);

function build(shape: any[][][]): DataStore {
  const artists = new Map<string, ParsedArtist>();
  shape.forEach((releases, ai) => {
    const id = `a${ai}`;
    artists.set(id, {
      id, name: id, artistType: 'girl_group', generation: 4, logoUrl: '', albumReleases: [],
      releases: releases.map((days, ri) => ({
        id: `r${ri}`, title: `r${ri}`, artistIds: [id], embeds: new Map(),
        dailyValues: new Map(days.flatMap((dv, di) => (dv ? [[DATES[di], { ...dv, episode: 1 }] as const] : []))),
      })),
    } as ParsedArtist);
  });
  const ds: DataStore = {
    artists, dates: DATES, startDate: DATES[0], endDate: DATES[3],
    firstAppearance: new Map(), chartWins: new Map(), releaseWinDates: new Map(),
  };
  const w = computeChartWins(ds);
  ds.chartWins = w.chartWins;
  ds.releaseWinDates = w.releaseWinDates;
  return ds;
}

describe('getReleaseWinOnDate', () => {
  it('credits at most one song per artist per (date, source), and only a song that has data there', () => {
    fc.assert(fc.property(arbStore, (shape) => {
      const ds = build(shape);
      for (const [artistId, artist] of ds.artists) {
        for (const date of DATES) {
          for (const src of ['all', ...SOURCES]) {
            const credited = artist.releases.filter(
              (r) => getReleaseWinOnDate(ds, artistId, r.id, date, src),
            );
            if (src !== 'all') expect(credited.length).toBeLessThanOrEqual(1);
            for (const r of credited) {
              const dv = r.dailyValues.get(date)!;
              expect(dv).toBeDefined();
              if (src !== 'all') expect(dv.source).toBe(src);
              expect(ds.chartWins.get(date)!.get(dv.source)!.artistIds).toContain(artistId);
              // the credited song is the artist's strongest on that (date, source)
              for (const o of artist.releases) {
                const odv = o.dailyValues.get(date);
                if (odv && odv.source === dv.source) expect(dv.value).toBeGreaterThanOrEqual(odv.value);
              }
            }
          }
        }
      }
    }), { numRuns: 200 });
  });
});
