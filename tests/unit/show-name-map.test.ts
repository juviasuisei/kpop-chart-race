import { SHOW_NAME_MAP, toChartSource } from '../../src/airtable/show-name-map.ts';

describe('SHOW_NAME_MAP', () => {
  it('should contain exactly 6 entries', () => {
    expect(SHOW_NAME_MAP.size).toBe(6);
  });

  it('should map "The Show" to "the_show"', () => {
    expect(SHOW_NAME_MAP.get('The Show')).toBe('the_show');
  });

  it('should map "Show Champion" to "show_champion"', () => {
    expect(SHOW_NAME_MAP.get('Show Champion')).toBe('show_champion');
  });

  it('should map "M Countdown" to "m_countdown"', () => {
    expect(SHOW_NAME_MAP.get('M Countdown')).toBe('m_countdown');
  });

  it('should map "Music Bank" to "music_bank"', () => {
    expect(SHOW_NAME_MAP.get('Music Bank')).toBe('music_bank');
  });

  it('should map "Show! Music Core" to "show_music_core"', () => {
    expect(SHOW_NAME_MAP.get('Show! Music Core')).toBe('show_music_core');
  });

  it('should map "Inkigayo" to "inkigayo"', () => {
    expect(SHOW_NAME_MAP.get('Inkigayo')).toBe('inkigayo');
  });
});

describe('toChartSource', () => {
  it('should return mapped value for known show names', () => {
    expect(toChartSource('The Show')).toBe('the_show');
    expect(toChartSource('Show Champion')).toBe('show_champion');
    expect(toChartSource('M Countdown')).toBe('m_countdown');
    expect(toChartSource('Music Bank')).toBe('music_bank');
    expect(toChartSource('Show! Music Core')).toBe('show_music_core');
    expect(toChartSource('Inkigayo')).toBe('inkigayo');
  });

  it('should lowercase and replace non-alphanumeric with underscores for unknown names', () => {
    expect(toChartSource('Some New Show')).toBe('some_new_show');
  });

  it('should handle special characters in fallback', () => {
    expect(toChartSource('Show! With Specials?')).toBe('show__with_specials_');
  });

  it('should handle empty string', () => {
    expect(toChartSource('')).toBe('');
  });

  it('should handle mixed case in fallback', () => {
    expect(toChartSource('MyShow')).toBe('myshow');
  });

  it('should replace multiple consecutive non-alphanumeric characters individually', () => {
    expect(toChartSource('A--B')).toBe('a__b');
  });
});
