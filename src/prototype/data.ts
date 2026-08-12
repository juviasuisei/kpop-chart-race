/**
 * Hardcoded fake data for the visual prototype.
 * ~25 lines simulating songs with varying activity levels and cumulative values.
 */

export interface PrototypeEvent {
  dateIndex: number; // index into the line's data points
  type: "win" | "live_performance" | "chart_appearance" | "mv" | "release";
  label: string;
}

/** Chart show source for each data point that has a gain */
export type ChartSource = "inkigayo" | "the_show" | "show_champion" | "music_bank" | "m_countdown" | "show_music_core";

export const SOURCE_LABELS: Record<ChartSource, string> = {
  inkigayo: "Inkigayo",
  the_show: "The Show",
  show_champion: "Show Champion",
  music_bank: "Music Bank",
  m_countdown: "M Countdown",
  show_music_core: "Show Music Core",
};

export const SOURCE_LOGOS: Record<ChartSource, string> = {
  inkigayo: "/kpop-chart-race/assets/sources/inkigayo.png",
  the_show: "/kpop-chart-race/assets/sources/the_show.png",
  show_champion: "/kpop-chart-race/assets/sources/show_champion.png",
  music_bank: "/kpop-chart-race/assets/sources/music_bank.png",
  m_countdown: "/kpop-chart-race/assets/sources/m_countdown.png",
  show_music_core: "/kpop-chart-race/assets/sources/show_music_core.png",
};

export interface PrototypeLine {
  id: string;
  name: string;
  artistName: string;
  color: string;
  artistType: "boy_group" | "girl_group" | "solo_male" | "solo_female" | "mixed_group";
  /** Cumulative values at each date index (monotonically increasing) */
  values: number[];
  /** Days since last activity (for dimming computation) */
  daysSinceActivity: number;
  /** Lifetime total points (for z-index tie-breaking) */
  ltdPoints: number;
  /** Events on this line */
  events: PrototypeEvent[];
  /** Map of dateIndex → chart source for days with point gains */
  sources?: Map<number, ChartSource>;
}

/** Color palette matching the project's artist type colors */
const COLORS = {
  boy_group: "#2E7D32",
  girl_group: "#7B1FA2",
  solo_male: "#81C784",
  solo_female: "#CE93D8",
  mixed_group: "#1565C0",
};

/** Cycle through chart sources to assign a show to each gain day */
const ALL_SOURCES: ChartSource[] = ["m_countdown", "show_champion", "music_bank", "show_music_core", "inkigayo", "the_show"];

function generateSources(values: number[]): Map<number, ChartSource> {
  const sources = new Map<number, ChartSource>();
  let sourceIdx = Math.floor(Math.random() * ALL_SOURCES.length);
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) {
      sources.set(i, ALL_SOURCES[sourceIdx % ALL_SOURCES.length]);
      sourceIdx++;
    }
  }
  return sources;
}

/** Generate a rising curve with some randomness */
function generateCurve(startValue: number, points: number, avgGain: number, variance: number): number[] {
  const values: number[] = [];
  let current = startValue;
  for (let i = 0; i < points; i++) {
    current += avgGain + (Math.random() - 0.3) * variance;
    if (current < startValue) current = startValue;
    values.push(Math.round(current));
  }
  return values;
}

/** Generate data with a promotion window (gains during promo, flat after) */
function generatePromoLine(startValue: number, totalPoints: number, promoLength: number, avgGain: number, variance: number): number[] {
  const values: number[] = [];
  let current = startValue;
  for (let i = 0; i < totalPoints; i++) {
    if (i < promoLength) {
      current += avgGain + (Math.random() - 0.2) * variance;
    }
    // After promo: flat (no gains)
    values.push(Math.round(current));
  }
  return values;
}

export const PROTOTYPE_LINES: PrototypeLine[] = [
  // === HIGH ACTIVITY (days 0-3) — bright, foreground, top z ===
  {
    id: "aespa-rich-man",
    name: "Rich Man",
    artistName: "aespa",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generateCurve(0, 90, 520, 300),
    daysSinceActivity: 1,
    ltdPoints: 45000,
    events: [
      { dateIndex: 5, type: "release", label: "Rich Man (6th Mini Album)" },
      { dateIndex: 5, type: "mv", label: "Rich Man MV" },
      { dateIndex: 12, type: "live_performance", label: "M Countdown Stage" },
      { dateIndex: 15, type: "win", label: "1st Win — Inkigayo" },
      { dateIndex: 18, type: "live_performance", label: "Music Bank Stage" },
      { dateIndex: 20, type: "chart_appearance", label: "Show Champion Ep. 571" },
      { dateIndex: 22, type: "win", label: "2nd Win — Show Champion" },
      { dateIndex: 30, type: "chart_appearance", label: "Inkigayo Ep. 1286" },
      { dateIndex: 45, type: "live_performance", label: "Show Music Core" },
    ],
  },
  {
    id: "stray-kids-chk",
    name: "Chk Chk Boom",
    artistName: "Stray Kids",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generateCurve(0, 90, 480, 350),
    daysSinceActivity: 0,
    ltdPoints: 42000,
    events: [
      { dateIndex: 3, type: "release", label: "Chk Chk Boom (Single)" },
      { dateIndex: 3, type: "mv", label: "Chk Chk Boom MV" },
      { dateIndex: 10, type: "win", label: "1st Win — M Countdown" },
      { dateIndex: 14, type: "live_performance", label: "Music Bank Stage" },
      { dateIndex: 20, type: "win", label: "Triple Crown — Inkigayo" },
    ],
  },
  {
    id: "ive-heya",
    name: "HEYA",
    artistName: "IVE",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generateCurve(0, 90, 450, 280),
    daysSinceActivity: 2,
    ltdPoints: 39000,
    events: [
      { dateIndex: 8, type: "release", label: "HEYA (2nd EP)" },
      { dateIndex: 8, type: "mv", label: "HEYA MV" },
      { dateIndex: 16, type: "win", label: "1st Win — Music Bank" },
      { dateIndex: 25, type: "live_performance", label: "Inkigayo Stage" },
    ],
  },
  {
    id: "newjeans-howsweet",
    name: "How Sweet",
    artistName: "NewJeans",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generateCurve(0, 90, 430, 250),
    daysSinceActivity: 3,
    ltdPoints: 37000,
    events: [
      { dateIndex: 2, type: "release", label: "How Sweet (Single)" },
      { dateIndex: 10, type: "win", label: "1st Win — The Show" },
      { dateIndex: 18, type: "live_performance", label: "M Countdown Stage" },
    ],
  },

  // === MODERATE ACTIVITY (days 4-7) — still full opacity ===
  {
    id: "seventeen-maestro",
    name: "MAESTRO",
    artistName: "SEVENTEEN",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generateCurve(0, 90, 400, 300),
    daysSinceActivity: 5,
    ltdPoints: 35000,
    events: [
      { dateIndex: 6, type: "release", label: "MAESTRO (17th Album)" },
      { dateIndex: 14, type: "win", label: "1st Win — Show Champion" },
    ],
  },
  {
    id: "bts-dynamite",
    name: "Dynamite",
    artistName: "BTS",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 60, 550, 200),
    daysSinceActivity: 6,
    ltdPoints: 52000,
    events: [
      { dateIndex: 0, type: "release", label: "Dynamite (Digital Single)" },
      { dateIndex: 0, type: "mv", label: "Dynamite MV" },
      { dateIndex: 8, type: "win", label: "1st Win — Inkigayo" },
      { dateIndex: 12, type: "win", label: "Triple Crown" },
      { dateIndex: 20, type: "live_performance", label: "Music Bank Stage" },
    ],
  },
  {
    id: "lesserafim-easy",
    name: "EASY",
    artistName: "LE SSERAFIM",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generateCurve(0, 90, 380, 260),
    daysSinceActivity: 7,
    ltdPoints: 32000,
    events: [
      { dateIndex: 4, type: "release", label: "EASY (3rd Mini Album)" },
      { dateIndex: 12, type: "win", label: "1st Win — M Countdown" },
    ],
  },

  // === BEGINNING TO DIM (days 8-14) ===
  {
    id: "txt-deja-vu",
    name: "Deja Vu",
    artistName: "TXT",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 45, 350, 200),
    daysSinceActivity: 9,
    ltdPoints: 28000,
    events: [
      { dateIndex: 5, type: "release", label: "Deja Vu (6th Mini Album)" },
      { dateIndex: 15, type: "win", label: "1st Win — Show Champion" },
    ],
  },
  {
    id: "riize-boom-boom",
    name: "Boom Boom Bass",
    artistName: "RIIZE",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 40, 320, 250),
    daysSinceActivity: 10,
    ltdPoints: 25000,
    events: [
      { dateIndex: 3, type: "release", label: "Boom Boom Bass (Single)" },
      { dateIndex: 11, type: "live_performance", label: "Inkigayo Stage" },
    ],
  },
  {
    id: "illit-magnetic",
    name: "Magnetic",
    artistName: "ILLIT",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(0, 90, 35, 300, 200),
    daysSinceActivity: 12,
    ltdPoints: 22000,
    events: [
      { dateIndex: 0, type: "release", label: "Magnetic (Debut Single)" },
      { dateIndex: 8, type: "win", label: "1st Win — The Show" },
    ],
  },
  {
    id: "jungkook-seven",
    name: "Seven",
    artistName: "Jung Kook",
    color: COLORS.solo_male,
    artistType: "solo_male",
    values: generatePromoLine(0, 90, 50, 420, 300),
    daysSinceActivity: 14,
    ltdPoints: 38000,
    events: [
      { dateIndex: 0, type: "release", label: "Seven (Single)" },
      { dateIndex: 0, type: "mv", label: "Seven MV" },
      { dateIndex: 7, type: "win", label: "1st Win — Music Bank" },
    ],
  },

  // === MODERATELY DIMMED (days 15-21) ===
  {
    id: "iu-love-wins-all",
    name: "Love wins all",
    artistName: "IU",
    color: COLORS.solo_female,
    artistType: "solo_female",
    values: generatePromoLine(0, 90, 40, 380, 200),
    daysSinceActivity: 16,
    ltdPoints: 34000,
    events: [
      { dateIndex: 2, type: "release", label: "Love wins all (6th Album)" },
      { dateIndex: 10, type: "win", label: "1st Win — Inkigayo" },
    ],
  },
  {
    id: "nct-dream-smoothie",
    name: "Smoothie",
    artistName: "NCT DREAM",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 35, 280, 200),
    daysSinceActivity: 18,
    ltdPoints: 20000,
    events: [
      { dateIndex: 5, type: "release", label: "Smoothie (3rd Album)" },
    ],
  },
  {
    id: "kard-icky",
    name: "ICKY",
    artistName: "KARD",
    color: COLORS.mixed_group,
    artistType: "mixed_group",
    values: generatePromoLine(0, 90, 30, 200, 150),
    daysSinceActivity: 19,
    ltdPoints: 12000,
    events: [
      { dateIndex: 4, type: "release", label: "ICKY (6th Mini Album)" },
    ],
  },
  {
    id: "blackpink-shut-down",
    name: "Shut Down",
    artistName: "BLACKPINK",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(0, 90, 35, 400, 250),
    daysSinceActivity: 20,
    ltdPoints: 36000,
    events: [
      { dateIndex: 0, type: "release", label: "Shut Down (2nd Album)" },
      { dateIndex: 6, type: "win", label: "1st Win — Inkigayo" },
    ],
  },

  // === HEAVILY DIMMED (days 22-27) ===
  {
    id: "nmixx-dash",
    name: "DASH",
    artistName: "NMIXX",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(0, 90, 30, 250, 180),
    daysSinceActivity: 22,
    ltdPoints: 18000,
    events: [
      { dateIndex: 3, type: "release", label: "DASH (2nd EP)" },
    ],
  },
  {
    id: "enhypen-xo",
    name: "XO (Only If You Say Yes)",
    artistName: "ENHYPEN",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 28, 240, 180),
    daysSinceActivity: 23,
    ltdPoints: 16000,
    events: [],
  },
  {
    id: "zerobaseone-sweat",
    name: "SWEAT",
    artistName: "ZEROBASEONE",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 25, 220, 160),
    daysSinceActivity: 24,
    ltdPoints: 14000,
    events: [],
  },
  {
    id: "bibi-bam-yang-gang",
    name: "BAM YANG GANG",
    artistName: "BIBI",
    color: COLORS.solo_female,
    artistType: "solo_female",
    values: generatePromoLine(0, 90, 20, 180, 150),
    daysSinceActivity: 25,
    ltdPoints: 10000,
    events: [
      { dateIndex: 0, type: "release", label: "BAM YANG GANG (Single)" },
    ],
  },
  {
    id: "boynextdoor-earth",
    name: "Earth, Wind & Fire",
    artistName: "BOYNEXTDOOR",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 18, 160, 120),
    daysSinceActivity: 26,
    ltdPoints: 8500,
    events: [],
  },

  // === NEARLY HIDDEN (days 27-28) — just barely visible ===
  {
    id: "kiss-of-life-midas",
    name: "Midas Touch",
    artistName: "KISS OF LIFE",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(0, 90, 22, 200, 140),
    daysSinceActivity: 27,
    ltdPoints: 11000,
    events: [],
  },
  {
    id: "xikers-do-or-die",
    name: "Do or Die",
    artistName: "xikers",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 12, 100, 80),
    daysSinceActivity: 27,
    ltdPoints: 5000,
    events: [],
  },
  {
    id: "plave-way4u",
    name: "Way 4 U",
    artistName: "PLAVE",
    color: COLORS.boy_group,
    artistType: "boy_group",
    values: generatePromoLine(0, 90, 15, 130, 100),
    daysSinceActivity: 28,
    ltdPoints: 6500,
    events: [],
  },

  // === CLUSTER: These three will have very similar values to test disambiguation ===
  {
    id: "cluster-a",
    name: "Supernatural",
    artistName: "NewJeans",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(5000, 90, 30, 180, 50),
    daysSinceActivity: 4,
    ltdPoints: 21000,
    events: [
      { dateIndex: 0, type: "release", label: "Supernatural (Single)" },
      { dateIndex: 7, type: "win", label: "1st Win — Music Bank" },
    ],
  },
  {
    id: "cluster-b",
    name: "Supernova",
    artistName: "aespa",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(4800, 90, 30, 180, 50),
    daysSinceActivity: 5,
    ltdPoints: 20500,
    events: [
      { dateIndex: 2, type: "release", label: "Supernova (5th Mini)" },
      { dateIndex: 10, type: "win", label: "1st Win — Inkigayo" },
    ],
  },
  {
    id: "cluster-c",
    name: "Armageddon",
    artistName: "aespa",
    color: COLORS.girl_group,
    artistType: "girl_group",
    values: generatePromoLine(4600, 90, 30, 180, 50),
    daysSinceActivity: 6,
    ltdPoints: 20000,
    events: [
      { dateIndex: 4, type: "release", label: "Armageddon (1st Album)" },
    ],
  },
];


// Post-process: generate source assignments for each line
for (const line of PROTOTYPE_LINES) {
  line.sources = generateSources(line.values);
}
