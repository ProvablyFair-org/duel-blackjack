/**
 * THE DECLARED GAME — rules, side-bet paytables and stakes, stated once.
 *
 * Until 2026-09-24 the side-bet paytable was a literal typed into three files (tests/steps/payouts.ts,
 * tests/steps/simulation.ts, tests/blackjack/BlackjackTests.ts) and the dataset's own
 * `config.multipliers` block (written by capture/capture.js from constants; its entries equal the
 * `multipliers` in evidence E18, Duel's config as fetched from duel.com on 2026-10-05 in a
 * logged-in session, read-only GET) was read by nothing. A
 * paytable edited in one copy and not the others would have been scored against itself. Every step
 * and test now imports this file, and Step 14 scores the dataset's config block against it key for
 * key (profile BLACKJACK-26).
 *
 * Each multiplier is kept as its DECIMAL STRING as well as a number: money is reconciled exactly
 * (src/money.ts), and 121.2307692 as a double is not 121.2307692.
 */
import type { BlackjackConfig } from './types';

/** Perfect Pairs, gross return per unit side stake (amount_won = multiplier × amount_placed). */
export const PP_PAYTABLE: Readonly<Record<string, string>> = Object.freeze({
  bj_perfect_pair: '27',
  bj_colored_pair: '11',
  bj_mixed_pair:   '7',
});

/** 21+3, gross return per unit side stake. Suited Trips is 121 + 3/13 rounded to 7 decimals. */
export const T3_PAYTABLE: Readonly<Record<string, string>> = Object.freeze({
  bj_suited_trips:   '121.2307692',
  bj_straight_flush: '53',
  bj_three_kind:     '32',
  bj_straight:       '12',
  bj_flush:          '5',
});

/** The same table in the shape src/sidebets.ts takes. Derived from the strings above, never typed twice. */
export const SIDE_BET_CONFIG: BlackjackConfig = {
  multipliers: {
    side_perfect_pairs: {
      bj_perfect_pair: Number(PP_PAYTABLE.bj_perfect_pair),
      bj_colored_pair: Number(PP_PAYTABLE.bj_colored_pair),
      bj_mixed_pair:   Number(PP_PAYTABLE.bj_mixed_pair),
    },
    side_21_plus_3: {
      bj_suited_trips:   Number(T3_PAYTABLE.bj_suited_trips),
      bj_straight_flush: Number(T3_PAYTABLE.bj_straight_flush),
      bj_three_kind:     Number(T3_PAYTABLE.bj_three_kind),
      bj_straight:       Number(T3_PAYTABLE.bj_straight),
      bj_flush:          Number(T3_PAYTABLE.bj_flush),
    },
  },
};

/** Classifier result → paytable key. */
export const PP_KEY: Readonly<Record<string, string>> = Object.freeze({
  perfect_pair: 'bj_perfect_pair', colored_pair: 'bj_colored_pair', mixed_pair: 'bj_mixed_pair',
});
export const T3_KEY: Readonly<Record<string, string>> = Object.freeze({
  suited_trips: 'bj_suited_trips', straight_flush: 'bj_straight_flush', three_kind: 'bj_three_kind',
  straight: 'bj_straight', flush: 'bj_flush',
});

/** The operator's display label for each category (Step 11 completeness). */
export const PP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bj_perfect_pair: 'Perfect Pair', bj_colored_pair: 'Colored Pair', bj_mixed_pair: 'Mixed Pair',
});
export const T3_LABELS: Readonly<Record<string, string>> = Object.freeze({
  bj_suited_trips: 'Suited Trips', bj_straight_flush: 'Straight Flush', bj_three_kind: 'Three of a Kind',
  bj_straight: 'Straight', bj_flush: 'Flush',
});

/**
 * THE RULE SET the suite replays (src/round.ts) and the engine solves (src/optimal-play.ts).
 * `observed` rules have a witness count printed by a scored step; `assumed` rules were never
 * probed (availability not tested) and are disclosed as ASSUMED — Step 37 and MANIFEST.md DL register.
 */
export const RULES = Object.freeze({
  deck: 'infinite',            // Step 29
  dealerSoft17: 'stand',       // Step 19 (S17)
  peek: true,                  // Step 36 replay: a natural at the deal ends the round before any player action
  naturalPays: '3:2',          // Step 20 — gross 2.5 × stake
  naturalVsDealerNatural: 'push',
  splitPairing: 'rank',        // Step 23
  maxSplits: 1,                // no re-split (ASSUMED — availability never probed)
  splitAcesOneCard: true,      // Step 23
  das: true,                   // Step 23
  doubleOn: 'first-two-cards', // Step 36 replay: `double` only as a hand's first action
  surrender: false,            // ASSUMED — never offered in any available_actions list (Step 28)
  twoCardTwentyOneAfterSplit: 'pays-1:1',
  insurancePays: '2:1',        // ASSUMED — offered on every dealer Ace (Step 25), never funded
});

/**
 * THE RULES AS THE CODE READS THEM (profile BLACKJACK-26: the rule set is single-sourced). Until
 * 2026-09-24 RULES above was a register that Step 37 checked against the data while src/round.ts,
 * src/optimal-play.ts and src/simulate.ts each carried their own copy of the rules in code (a literal
 * `< 17` dealer loop, `'stand', true` engine defaults, a local SOFT17_RULE / DAS_ALLOWED pair, a
 * literal 2.5 for a natural). They now read the values below, which are derived from RULES and from
 * nothing else. A RULES value the code cannot play (a re-split, surrender, a finite shoe, a natural
 * paying anything but 3:2 or 1:1, a pushing natural that is not a push, split tens by value) THROWS
 * here, at load, instead of being silently played as the old rule — so an edited RULES either moves
 * every consumer or stops the suite.
 */
export interface RulesInEffect {
  soft17: 'stand' | 'hit';
  peek: boolean;
  das: boolean;
  splitAcesOneCard: boolean;
  /** Gross return of a player natural against a dealer non-natural, in HALF-stakes (3:2 → 5). */
  naturalHalfStakes: bigint;
  naturalGross: number;
}
export function rulesInEffect(r: typeof RULES = RULES): RulesInEffect {
  const unsupported: string[] = [];
  if (r.deck !== 'infinite') unsupported.push(`deck ${r.deck}`);
  if (r.dealerSoft17 !== 'stand' && r.dealerSoft17 !== 'hit') unsupported.push(`dealerSoft17 ${r.dealerSoft17}`);
  if (r.peek !== true) unsupported.push('no peek');
  if (r.maxSplits !== 1) unsupported.push(`maxSplits ${r.maxSplits}`);
  if (r.surrender !== false) unsupported.push('surrender');
  if (r.splitPairing !== 'rank') unsupported.push(`splitPairing ${r.splitPairing}`);
  if (r.doubleOn !== 'first-two-cards') unsupported.push(`doubleOn ${r.doubleOn}`);
  if (r.naturalVsDealerNatural !== 'push') unsupported.push(`naturalVsDealerNatural ${r.naturalVsDealerNatural}`);
  if (r.twoCardTwentyOneAfterSplit !== 'pays-1:1') unsupported.push(`twoCardTwentyOneAfterSplit ${r.twoCardTwentyOneAfterSplit}`);
  const nat: Record<string, bigint> = { '3:2': 5n, '1:1': 4n };
  if (!(r.naturalPays in nat)) unsupported.push(`naturalPays ${r.naturalPays}`);
  if (unsupported.length) throw new Error(`src/config.ts RULES: the replay, settlement and engine cannot play ${unsupported.join(', ')}`);
  return {
    soft17: r.dealerSoft17 as 'stand' | 'hit', peek: r.peek === true, das: r.das === true,
    splitAcesOneCard: r.splitAcesOneCard === true,
    naturalHalfStakes: nat[r.naturalPays], naturalGross: Number(nat[r.naturalPays]) / 2,
  };
}
export const RULES_IN_EFFECT: Readonly<RulesInEffect> = Object.freeze(rulesInEffect());

/** Per-phase main stake of the capture plan, as decimal strings (Step 33). */
export const PHASE_STAKE: Readonly<Record<string, string>> = Object.freeze({
  A: '0.01', B: '0.01', C: '0.01', D: '0.01', E: '10', F: '0.01',
});

/**
 * External references for the RTP ENGINE (Step 16, profile BLACKJACK-18), since 2026-09-25. The
 * two Wizard of Odds infinite-deck pages below state rule sets that RE-SPLIT, not Duel's (no
 * re-split); no page stating Duel's rule set was found (the search, 48 pages, looked for the figure
 * 99.4296 % / 0.5704 %, evidence E16). So the engine is anchored on the rule sets these pages DO state: the same infinite-deck engine,
 * switched to each page's rules, must reproduce the page's figure to half a unit of its last printed
 * digit. Both pages were fetched by GET on 2026-09-25 (by the ProvablyFair.org HouseBets Blackjack
 * audit; re-fetched by GET for this package the same day, byte-identical: same SHA-256). They were
 * vendored byte for byte under evidence/ until 2026-09-28; since then each is a CITATION (evidence
 * E14, E15: a small JSON with the URL, the read date, the page's own SHA-256 as read, and the one
 * sentence the figure is printed in, quoted verbatim; plus a cropped screenshot of that sentence) —
 * third-party pages are cited, not shipped (Framework 1.0 review F17). The citation file is pinned
 * here (`sha256`); Step 16 reads the figure OUT OF the pinned citation's quote (`pattern`), so no
 * literal in this file is what is compared.
 *
 * Rules the pages STATE are in `statedRules`. The rest (EXTERNAL_REFERENCE_ASSUMED_RULES) are not
 * stated on either page; Step 16 flips each one and prints how far the figure moves, so a wrong
 * assumption would miss the page figure by far more than the tolerance.
 */
export const EXTERNAL_RTP_REFERENCES = Object.freeze([
  Object.freeze({
    id: 'E14',
    url: 'https://wizardofodds.com/games/blackjack/expected-return-infinite-deck/',
    file: 'evidence/E14-woo-expected-return-infinite-deck-2026-09-25.json',
    sha256: '7ccefea9363d9e8ba1ecf76349b05080f84e703c0fbb10ce7785ac87aed808ab',
    /** SHA-256 of the full page as read on 2026-09-25 (vendored until 2026-09-28; no longer shipped). */
    pageSha256: '6c029ae1c0fb8919bf47d6e2493ea9d61f64ef20c76dd19c2aadc7f6a83d3d66',
    dateRead: '2026-09-25',
    pageLastUpdated: 'Aug 03, 2026',
    /** The page sentence (the citation's `quote`) the figure is read from; group 1 = the player's EV in percent. */
    pattern: "Based on these rules, the player's expected value is (-?\\d+\\.\\d+)%",
    figureIs: 'player EV' as 'player EV' | 'house edge',
    statedRules: 'dealer stands on a soft 17, an infinite deck, the player may double after a split, split up to three times except for aces, and draw only one card to split aces',
    maxHands: 4,
  }),
  Object.freeze({
    id: 'E15',
    url: 'https://wizardofodds.com/games/blackjack/player-expected-return/',
    file: 'evidence/E15-woo-player-expected-return-2026-09-25.json',
    sha256: 'a8326ce02b00d2646c3960b21c81e37d4ca0d9fd3c20c3a8da6de23c7bb42187',
    pageSha256: '52913fc0d694858115124ea15b7ef3b25e169242faa080c2490049371eb3bf25',
    dateRead: '2026-09-25',
    pageLastUpdated: 'Aug 03, 2026',
    pattern: 'Based on these rules the house edge is (\\d+\\.\\d+)%',
    figureIs: 'house edge' as 'player EV' | 'house edge',
    statedRules: 'dealer stands on a soft 17, double after split allowed, infinite resplitting, split aces get one card each, infinite number of decks',
    maxHands: Infinity,
  }),
]);
/** Engine settings the pages do not state — the standard game; Step 16 prints each one's leverage. */
export const EXTERNAL_REFERENCE_ASSUMED_RULES = 'blackjack pays 3:2, double on any two cards, no surrender, dealer peeks behind an ace and a ten, a natural pushes against a dealer natural, a two-card 21 after a split pays 1:1, split aces are not re-split';

/**
 * RETIRED 2026-09-25 — NOT a Wizard of Odds figure. Until then this package (and the published
 * v1.0.0 / v1.0.1) called 0.994296 "the Wizard of Odds reference for Duel's exact rule set". It was
 * not found on the 48 Wizard of Odds pages read on 2026-09-25 (evidence E16; MANIFEST.md, Errata — 25 September
 * 2026); it equals THIS ENGINE's own figure for Duel's rules, 99.4296119877 %, at six decimals.
 * It is scored by nothing. It survives only because the pinned simulation artifact
 * (outputs/simulation-results.json) carries it under the legacy field name `optimalPlay.wooReference`
 * and `npm run test:full` must still regenerate that artifact byte for byte.
 */
export const RETIRED_FIGURE_FORMERLY_CALLED_WOO = 0.994296;

/**
 * INDEPENDENT EXACT-RATIONAL ORACLE (profile BLACKJACK-18). anchor/oracle.py — Python standard library,
 * exact Fractions, 13 distinct ranks (split by rank exactly), concrete hole cards with the natural
 * holes removed by the peek, written from RULES without reading src/optimal-play.ts — printed these
 * RTPs per initial bet on 2026-09-24. Step 16 requires the engine to equal both within ORACLE_TOL:
 * the declared rule (S17) and the negative control (H17).
 */
export const ORACLE_RTP: Readonly<Record<'stand' | 'hit', readonly [string, string]>> = Object.freeze({
  stand: ['7016161098045143337706614398', '7056410014866816666030739693'] as const,    // 99.4296119877 %
  hit:   ['91009361114781483510240679590', '91733330193268616658399616009'] as const,  // 99.2107894950 %
});
export const ORACLE_TOL = 1e-12;
/** num/den → float64 without losing precision in the conversion (both exceed 2^53). */
export const oracleValue = ([n, d]: readonly [string, string]): number => Number((BigInt(n) * 10n ** 30n) / BigInt(d)) / 1e30;
