/**
 * Unit tests for firstAppearance computation in the data loader.
 * Validates that each artist's earliest data date is correctly identified.
 */

import { describe, it, expect } from 'vitest';
import { loadAll } from '../../src/data-loader.ts';

describe('firstAppearance', () => {
  it('is populated as a Map in the DataStore', async () => {
    const dataStore = await loadAll('data');
    expect(dataStore.firstAppearance).toBeInstanceOf(Map);
  });

  it('has an entry for every artist that has dailyValues', async () => {
    const dataStore = await loadAll('data');
    for (const [artistId, artist] of dataStore.artists) {
      let hasData = false;
      for (const release of artist.releases) {
        if (release.dailyValues.size > 0) {
          hasData = true;
          break;
        }
      }
      if (hasData) {
        expect(dataStore.firstAppearance.has(artistId)).toBe(true);
      }
    }
  });

  it('each firstAppearance date is the earliest dailyValue date for that artist', async () => {
    const dataStore = await loadAll('data');
    for (const [artistId, artist] of dataStore.artists) {
      let earliest: string | undefined;
      for (const release of artist.releases) {
        for (const date of release.dailyValues.keys()) {
          if (!earliest || date < earliest) earliest = date;
        }
      }
      if (earliest) {
        expect(dataStore.firstAppearance.get(artistId)).toBe(earliest);
      }
    }
  });

  it('firstAppearance dates are valid YYYY-MM-DD format', async () => {
    const dataStore = await loadAll('data');
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const [, date] of dataStore.firstAppearance) {
      expect(date).toMatch(dateRegex);
    }
  });

  it('firstAppearance dates fall within the dataStore date range', async () => {
    const dataStore = await loadAll('data');
    for (const [, date] of dataStore.firstAppearance) {
      expect(date >= dataStore.startDate).toBe(true);
      expect(date <= dataStore.endDate).toBe(true);
    }
  });
});
