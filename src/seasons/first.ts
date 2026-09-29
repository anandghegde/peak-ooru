import type { Season } from '../rules/types'

/** The first season: the city as it stands in January 2026. Amounts in lakh; docs/RULES.md says why each. */
export const firstSeason: Season = {
  id: 'first',
  name: 'First season',
  seed: 1,
  /** ₹2,000 crore in hand. */
  money: 200_000,
  /**
   * ₹32 crore a month from the state at the start, rising each January: with the state's payment for free bus rides
   * (about ₹108 crore in the first month, following the riders), about the ₹140 crore of slice 3.
   */
  grant: 3200,
  months: 120,
  /**
   * The lines being built open on the targets published in August 2026 (Metro Rail News, 24 August 2026, from the
   * Bengaluru Development Minister's revised timelines), as game values. Month 0 is January 2026.
   * Pink Line: Kalena Agrahara to Tavarekere (6 stations, elevated) in October 2026, "September" having passed
   * unopened; the underground rest to Nagawara in March 2027. Blue Line: Central Silk Board to KR Puram (13 stations)
   * in January 2027 ("December or January"); on to Nagawara in July 2027 ("mid-2027"); to the airport in March
   * 2028 (the whole line's target).
   */
  openings: [
    { line: 'pink', month: 9, stations: 6 },
    { line: 'blue', month: 12, stations: 13 },
    { line: 'pink', month: 14, stations: 18 },
    { line: 'blue', month: 18, stations: 19 },
    { line: 'blue', month: 26, stations: 29 },
  ],
  /** The daily allowance is off while the game is being built (PRD TIME-7). */
  allowance: false,
  /**
   * The corporation's elections (PRD EVT-7). None has been held under the Greater Bengaluru Authority; the season sets
   * them in October 2027 and October 2032, five years apart, as game values.
   */
  elections: [21, 81],
  /**
   * The marks (PRD SCORE-10, SCORE-15), published with the season: for each measure, the figure that scores nothing and
   * the figure that scores 100, in the units the rules keep (docs/RULES.md, "The marks"). Set by `tools/playthrough.ts
   * marks` on the model of 29 September 2026, 10:39: the city as it starts at 40 and the best plausible plan at 95, or,
   * where the start is about as good as the best plan reaches (access, clean travel, fairness), doing nothing at 15 and
   * the best at 90; money fixed, so that hoarding scores nothing more.
   * Slice 9: money scores in full from ₹1,000 crore (was ₹3,000 crore), half what the city starts with: a city that pays
   * its way and keeps a reserve scores in full, and sitting on the grant earns nothing more (docs/RULES.md, "Slice 9").
   * The other marks are kept: the model did not change, and `marks --quick` on slice 9's rules moved them only as far as
   * the best plan's own path moved (docs/RULES.md).
   */
  marks: {
    access: { none: 95, full: 160 },
    commute: { none: 4010, full: 2795 },
    clean: { none: 490, full: 570 },
    safety: { none: 985, full: 565 },
    fairness: { none: 355, full: 545 },
    money: { none: -400_000, full: 100_000 },
    approval: { none: 405, full: 765 },
  },
  /** The city as it starts (`tools/playthrough.ts opening`): January 2026 on the model of 29 September 2026, 10:39. */
  opening: { access: 137, commute: 3524, clean: 538, safety: 816, fairness: 448, money: 200_000, approval: 550 },
  /**
   * Slice 8: how much each year counts (docs/RULES.md, "The score of ten years"), thousandths, 2026 first: each year a
   * quarter more than the one before, 3% for 2026 to 22.5% for 2035. Judgement, on the scripted players: a player who
   * sits on the money for seven years and then spends it on what shows at once no longer scores above those who built
   * well throughout.
   */
  years: [30, 38, 47, 59, 73, 92, 114, 143, 179, 225],
}
