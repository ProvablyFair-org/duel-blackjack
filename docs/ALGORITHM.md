# Duel.com Blackjack: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/blackjack/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Blackjack.

This document is the only input an implementer needs to rebuild Duel Blackjack's
card derivation, round replay and settlement. It was written without opening any
Duel source code, any port of it, or any copy of Duel's in-site verifier code
(see §8 for every file and URL opened). Every step names where it came from:

- **PAGE**: Duel's public pages, quoted with location and date. Captured images
  are under `evidence/` (E01–E12, captured
  4 May 2026); live pages were rendered with GET and no login on 20 Oct 2026.
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed; HMAC-SHA256 keyed by the server
  seed over the client seed, nonce and a cursor; bytes to integer; integer to
  card).
- **DATA**: fixed by testing the standard candidates against the 6,000 live
  rounds in `data/blackjack-dataset-6000hands.json`
  (rounds created 30 Apr 2026 21:31 – 1 May 2026 13:15 UTC). The data chose;
  Duel's code did not.
- **CONFIG**: Duel's public blackjack config, `GET /api/v2/blackjack/config`,
  captured 5 Oct 2026 as `evidence/E18-blackjack-config-2026-10-05.json`
  (headers in its `.meta.json`).

The pages say what goes in and state the table rules in one line each. They do
not say how the inputs are combined or how a number becomes a card, so all of
§2 was settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the pair is rotated | PAGE: "Server seed - a random string provided by us" (E03; live `duel.com/provably-fair`, 20 Oct 2026). Form: DATA (all 120 revealed seeds are 64 hex chars) |
| `clientSeed` | text string chosen or accepted by the player | PAGE: "Client seed - a random string provided by you" (E03). E12 shows a player-typed seed `pfaudit_bj_seed01`; E05/E07 show 16-char default seeds |
| `nonce` | non-negative integer; 0 on the first round after a rotation, +1 per round | PAGE: "Nonce - a number that increases with each bet" (E03); "Nonce 0" on a fresh pair (E05, E07). DATA: every one of the 120 seed epochs holds exactly 50 rounds |
| `actions` | the player's decisions in the order made: `hit`, `stand`, `double`, `split`, `no_insurance` (and, unwitnessed, `insurance`) | DATA (`bets[].actions`); PAGE: Hit / Stand / Split / Double buttons (E01, E10), "Insurance? No / Yes" (E09) |
| `stake` | main-bet amount, decimal (`amount_currency`) | DATA |
| side stakes | Perfect Pairs and 21+3 amounts (`side_bet_results.*.amount_placed`), optional | DATA; PAGE: E08/E11 bet panel |

One round = one nonce. The stake, the side stakes and the actions are **not**
inputs to the card stream; the actions only decide how many cards are drawn and
where each goes.

### 1.2 Commitment

PAGE (`duel.com/provably-fair`, Overview tab; E03, and rendered 20 Oct 2026):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."
>
> "After the game, we reveal the unhashed Server Seed. You can verify that: The
> server seed matches the original hash. The combined seeds generated the exact
> result you played."

The page does not say what bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** the 64 hex characters encode, not the ASCII text.

- SOURCE: STANDARD (SHA-256 commitment) + DATA for the encoding.
- Candidates: SHA-256 over the ASCII hex string → **0 / 120** round hashes
  resolve; SHA-256 over the hex-decoded bytes → **120 / 120**, covering
  **6,000 / 6,000** rounds.
- Pairing: pair each round to its revealed seed by hashing (find the seed whose
  commitment equals the round's `server_seed_hashed`), not by record position.
- Forward chain: the seed panel shows "Active server seed (Hashed)" and "Next
  server seed (Hashed)" before every rotation (E05, E07, E12). In the capture,
  the `nextServerSeedHash` recorded at rotation *i* equals the
  `serverSeedHashed` of rotation *i+1* on **120 / 120** links. E05's next hash
  `5b612938a7adb84d630426cee19f0bb30db718ee…` is E07's active hash, the same
  link seen on screen.

---

## 2. Outcome derivation

PAGE gives only the inputs, not the combination: "Fair result = Server seed +
Client seed + Nonce" (E03; same text on the live page 20 Oct 2026).

### Step 1: one HMAC per card

The *k*-th card drawn in a round (k = 0, 1, 2, … in draw order, see Step 4) is:

```
key     = hex_decode(serverSeed)                                   # 32 bytes
message = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(k) )
digest  = HMAC-SHA256(key, message)                                # 32 bytes
```

e.g. the first card of V1 (§5) uses message `pf_Naa0pBEOuWmz6:0:0`, the second
`pf_Naa0pBEOuWmz6:0:1`. `decimal()` is plain base 10: no padding, no sign.

- SOURCE: STANDARD (HMAC-SHA256, server seed as key, colon-joined client seed,
  nonce and cursor as message) + DATA for the key form, the message and
  "one digest per card".
- Note for implementers: the cursor here counts **cards**, one fresh HMAC per
  card. It is not the common "cursor counts 32-byte blocks, 8 floats per block"
  scheme; that scheme was tried and fails (table below).

### Step 2: bytes to card index

```
v   = digest[0..3] read as an unsigned 32-bit BIG-ENDIAN integer
idx = v mod 52                                   # 0 … 51
```

Rejection sampling (STANDARD, not witnessed, see O1):

```
LIMIT = floor(2^32 / 52) * 52  = 4294967248
for i in 0, 4, 8, …, 28:
    v = u32_BE(digest[i..i+3]); if v < LIMIT: return v mod 52
```

A first chunk ≥ LIMIT happens with probability 48 / 2^32 ≈ 1.1 × 10⁻⁸ per
card; **0** of the cards drawn for the 6,000 rounds hit it, so the data cannot
tell rejection from plain `v mod 52`. For the bias bound (profile check
BLACKJACK-08): 2^32 = 52 × 82,595,524 + 48, so under plain `mod 52` indices
0–47 have 82,595,525 preimages and indices 48–51 have 82,595,524; each index's
probability differs from 1/52 by less than 2^-32. With rejection it is exactly
1/52.

### Step 3: index to card (infinite deck)

```
RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A]
SUITS = [D, H, S, C]          # diamonds, hearts, spades, clubs
card  = RANKS[idx div 4]  of  SUITS[idx mod 4]
```

So idx 0 = 2♦, 1 = 2♥, 2 = 2♠, 3 = 2♣, 4 = 3♦, … 48 = A♦, 51 = A♣.
Each card is drawn independently from all 52 (no removal).

- SOURCE: PAGE for the deck: "Deck — Infinite decks / continuous shuffle."
  (rules modal, Standard tab, `duel.com/blackjack`, rendered 20 Oct 2026). DATA
  for the table: on the first 1,465 unsplit rounds the 52 indices each mapped to
  exactly one observed card (52 / 52 functional, 94–147 sightings each), and the
  table then reproduces every card of all 6,000 rounds (Step 5). The same card
  appears twice in one round (V1: 2♣ three times), as an infinite deck requires.

### Step 4: draw order

```
k = 0  player card 1
k = 1  dealer up card
k = 2  player card 2
k = 3  dealer hole card (drawn now, shown face down)
k = 4… every later card, in the order it enters play (Step 5)
```

- SOURCE: DATA. Candidates for the first four cards, over all 6,000 rounds
  (match = all four initial cards equal):

  | Key | Message | Mapping | P1,D1,P2,D2 | P1,P2,D1,D2 |
  |---|---|---|---|---|
  | hex-decoded | `c:n:k` (one HMAC per card) | u32 BE mod 52 | **6,000 / 6,000** | 114 / 6,000 |
  | hex-decoded | `c:n:k` | u32 LE mod 52 | 0 | 0 |
  | hex-decoded | `c:n:k` | float (Σ bᵢ/256^(i+1)) × 52, floor | 0 | 0 |
  | hex-decoded | `c:n-k` | each of the 3 mappings | 0 | 0 |
  | hex-decoded | `c:n` one digest, card k = chunk k | each of the 3 mappings | 0 | 0 |
  | hex-decoded | `c:n:0` one digest, card k = chunk k | each of the 3 mappings | 0 | 0 |
  | ASCII hex string | all 4 messages above | each of the 3 mappings | 0 | 0 |

  (114 in the second column are rounds where player card 2 and the dealer up
  card happen to be the same card.)

### Step 5: round replay (where each later card goes)

Replay with the recorded `actions`, drawing from the stream in this order:

1. **Insurance prompt.** If the up card is an Ace, the next action is the
   insurance choice (`no_insurance` in every captured case). No card is drawn.
2. **Dealer natural (peek).** If up + hole is a two-card 21, the round ends now:
   no more cards, no player action. Witnessed 314 times (176 with a ten-value
   up card and no actions at all; 138 with an Ace up after `no_insurance`).
3. **Player natural.** If player cards 1 + 2 are a two-card 21, the round ends:
   the dealer does not draw. Witnessed 260 times (plus 17 "both naturals",
   counted under 2).
4. **Split** (only as the first action, on two cards of the same rank). The
   original hand becomes two hands: hand 1 (`type: main`) keeps player card 1,
   hand 2 (`type: split`) takes player card 2. Then **hand 1 gets the next card,
   then hand 2 gets the next card**, and only after that does play begin on
   hand 1, then hand 2.
   - Data-determined: this "both second cards first" order reproduces
     **269 / 269** split rounds card for card; dealing hand 2's second card only
     after hand 1 finishes reproduces **106 / 269**.
   - Split Aces: each hand keeps exactly its two cards, no action (34 / 34 split
     Ace rounds). PAGE: "Split once per hand - you cannot hit on split Aces."
   - No re-split: no round has more than two hands; on every captured split hand
     that was again a pair (47 responses), `split` was not in
     `available_actions`.
5. **Play each hand in order** (hand 1, then hand 2): consume actions until the
   hand stands, reaches 21 or more, or doubles.
   - `hit`: draw one card to this hand.
   - `double`: draw exactly one card to this hand, the hand's stake doubles, the
     hand ends. Allowed on any first two cards (PAGE: "Double down on any first
     two cards."; DATA: doubles taken on two-card totals 4 to 20, 1,368 hands)
     and after a split (186 doubled split hands).
   - `stand`: the hand ends.
   - A hand that reaches 21 or busts ends without a further action.
6. **Dealer draws** only if at least one player hand is not bust: the dealer
   draws while the dealer total is below 17 and **stands on every 17, soft 17
   included** (S17). PAGE: "Dealer — Stands on 17." DATA: the dealer stood on
   soft 17 in 93 rounds and drew on soft 17 in 0. When every player hand
   busted, the dealer drew nothing (1,210 rounds).

Hand totals: 2–10 face value, J/Q/K = 10, A = 11 or 1 (count A as 11, then
subtract 10 per Ace while the total exceeds 21). A total is soft if an Ace still
counts 11.

Result of the replay on the dataset: every player hand and the dealer hand
equal the derived cards in order on **6,000 / 6,000** rounds, and the replay
consumes the recorded actions exactly on **6,000 / 6,000**.

---

## 3. Win condition and payout

### 3.1 Main bet

Per hand, with `S` = the round's `amount_currency` and the hand stake `s = S`,
or `2S` if the hand doubled. "Natural" = a two-card 21 in an **unsplit** hand.

| Case (first match wins) | Label (`result`) | Return |
|---|---|---|
| player natural, dealer no natural | `blackjack` | 2.5 × S (3:2) |
| player natural, dealer natural | `push` | S |
| dealer natural | `lose` | 0 |
| player total > 21 | `bust` | 0 |
| dealer total > 21, or player total > dealer total | `win` | 2 × s |
| totals equal | `push` | s |
| otherwise | `lose` | 0 |

- A two-card 21 after a split is an ordinary 21, paid `win` 1:1, never 3:2
  (30 such hands, all `win`).
- SOURCE: PAGE: table felt "BLACKJACK PAYS 3 TO 2" (E01, E08); "Natural
  blackjack ends the game immediately."; "Ties — Blackjack vs blackjack is a
  push." (rules modal, 20 Oct 2026). DATA: hand labels **6,000 / 6,000**, hand
  and dealer `value` fields 6,000 / 6,000.
- The return is exact: no rounding was needed or observed (stakes 0.01 and 10;
  e.g. a natural on 0.01 returns 0.025).

### 3.2 Side bets (snapshot = the first two player cards + dealer up card)

The side bets read **player card 1, player card 2 and the dealer up card**
(k = 0, 2, 1), even after a split (hand 1 card 1, hand 2 card 1).
DATA: 267 / 267 split rounds with side bets; reading hand 1's own first two
cards instead gives 7 / 267.

**Perfect Pairs** (player cards 1 and 2), PAGE: "Your first two cards form a
pair." (E02; live Sidebets tab 20 Oct 2026):

| Category | Rule | Multiplier |
|---|---|---|
| Perfect Pair | same rank, same suit | 27 |
| Colored Pair | same rank, different suit, same colour (♦♥ red, ♠♣ black) | 11 |
| Mixed Pair | same rank, different colour | 7 |

**21 + 3** (player cards 1, 2 + dealer up card), PAGE: "Your two cards + the
dealer's up card make a 3-card hand." (E02; live 20 Oct 2026). Precedence top
to bottom:

| Category | Rule | Multiplier |
|---|---|---|
| Suited Trips | three of one rank, one suit | 121.2307692 (page shows "~121x") |
| Straight Flush | straight and flush | 53 |
| Three of a Kind | three of one rank | 32 |
| Straight | three consecutive ranks; Ace low (A-2-3) **and** high (Q-K-A); no wrap (K-A-2 is not a straight) | 12 |
| Flush | one suit | 5 |

- Straight edges, DATA: A-2-3 → Straight 8, Straight Flush 2; Q-K-A → Straight
  12; K-A-2 → nothing 16, Flush 1.
- Return = `amount_placed × multiplier` (the multiplier is total return, stake
  included; E11: $0.01 Perfect Pair shows $0.27), else 0. Multipliers from
  CONFIG `data.multipliers` (identical to the dataset's own `config` block).
  DATA: labels **11,600 / 11,600**, side `amount_won` exact **11,600 / 11,600**.
- PAGE (E02): "Bets are processed in the following order: 21 + 3, Perfect
  Pairs, Main Bet. This may affect your effective house edge depending on your
  remaining zero edge limits." Every captured side bet carried
  `effective_edge: 0` and paid the unscaled multipliers above. The CONFIG also
  has `scaling_edge` tiers for both side bets with reduced multipliers
  (e.g. Perfect Pair 26.973 at edge 0.001 = 27 × 0.999); when those apply is
  not settled (O3).

### 3.3 Round total

```
amount_won = Σ main-hand returns + Perfect Pairs return + 21+3 return
```

DATA: **6,000 / 6,000** exact in decimal arithmetic. `amount_won` is served with
or without trailing zeros ("0.07", "0.020000000000000000"); compare numerically.
`amount_currency` stays the initial main stake even when a hand doubles or
splits (doubling and splitting are visible only in the hands).

### 3.4 Insurance

Offered iff the dealer up card is an Ace (462 / 462 Ace-up rounds; never
otherwise), including when the player holds a natural (22 rounds; no separate
"even money" action). PAGE: felt "INSURANCE PAYS 2 TO 1" (E01, E09). Every
captured offer was declined, so an insurance payout is **unwitnessed** (O2).

### 3.5 Fields an implementation must not read

`result`, `value`, `is_win`, `amount_won`, `side_bet_results.*.label /
multiplier / amount_won`, `effective_edge`, `available_actions` and every card
field are the operator's claims, to be checked. The derivation reads only
`serverSeed`, `clientSeed`, `nonce`, `actions`, the stakes and the CONFIG
multipliers.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | E03 / live overview, 20 Oct 2026 |
| Commitment = hex SHA-256 | PAGE + STANDARD | E03 "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 120/120 hashes, 6,000 rounds (ASCII 0/120) |
| Forward chain next hash → active hash | PAGE + DATA | E05→E07 on screen; 120/120 links |
| HMAC-SHA256, key = hex-decoded seed | STANDARD + DATA | 6,000/6,000 (ASCII key 0) |
| Message `clientSeed:nonce:k`, one HMAC per card | STANDARD + DATA | 6,000/6,000; `c:n-k`, `c:n`, `c:n:0`-chunks all 0 |
| First 4 bytes, u32 BE, mod 52 | DATA | 6,000/6,000; LE and float×52 0 |
| Rejection ≥ 4294967248 | STANDARD | not exercised (0 cards); O1 |
| Index → card, rank-major 2…A × D,H,S,C | DATA | 52/52 indices functional; all cards 6,000/6,000 |
| Infinite deck | PAGE + DATA | rules modal "Infinite decks / continuous shuffle." |
| Deal P1, D-up, P2, D-hole | DATA | 6,000/6,000 (P1,P2,D1,D2: 114) |
| Split: both second cards first | DATA | 269/269 (sequential 106/269) |
| Split once; split Aces one card | PAGE + DATA | "Split once per hand - you cannot hit on split Aces."; 34/34 |
| Double any two cards, one card, DAS | PAGE + DATA | "Double down on any first two cards."; 1,368 doubles, 186 after split |
| Peek: dealer natural ends round | PAGE + DATA | "Natural blackjack ends the game immediately."; 314 rounds |
| Dealer S17; no draw if all hands bust | PAGE + DATA | "Stands on 17."; soft 17 stood 93, drew 0; 1,210 |
| Main settlement, 3:2, push on BJ vs BJ | PAGE + DATA | felt, rules modal; labels 6,000/6,000 |
| Side-bet categories and multipliers | PAGE + CONFIG + DATA | E02 / live Sidebets tab; 11,600/11,600 |
| Round total | DATA | 6,000/6,000 exact |
| Insurance 2:1 | PAGE only | felt; never taken (O2) |

---

## 5. Test vectors (from the dataset)

Copied from `blackjack-dataset-6000hands.json`; the server seed is the revealed
seed whose commitment equals the round's `server_seed_hashed`. For each card:
the first four HMAC bytes, `u32` (big-endian), `idx = u32 mod 52`, the card.

Full digests for V1, as a byte-level check:
`HMAC(key, "pf_Naa0pBEOuWmz6:0:0")` = `9fa6f6bfd79a0c761bf728f64cc0b389367f21e470ae118e7f2788d4a5351a5b`,
`HMAC(key, "pf_Naa0pBEOuWmz6:0:1")` = `fd30ac9732b35170cd06b9c9fcd9fc52de1a257fd368bc22eb28e2ccaa18cebd`.

**V1: round 13418615** (Phase A; hits, dealer busts, 21+3 Flush)
```
serverSeed  b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556
commitment  94c218c91df8997d4e7b1280687e90a3573c98739bd9220cd2fdd595699ef34f
clientSeed  pf_Naa0pBEOuWmz6   nonce 0   stake 0.01   PP 0.01   21+3 0.01
actions     hit, hit, hit, stand
k=0 9fa6f6bf 2678519487 idx 7  3♣  player 1
k=1 fd30ac97 4247825559 idx 3  2♣  dealer up
k=2 ad860917 2911242519 idx 3  2♣  player 2
k=3 6d2f341c 1831810076 idx 44 K♦  dealer hole
k=4 893accec 2302332140 idx 4  3♦  hit
k=5 b28b9f1f 2995494687 idx 3  2♣  hit
k=6 7be6b490 2078717072 idx 16 6♦  hit (16, stand)
k=7 07dd5c83  131947651 idx 43 Q♣  dealer draws (2+10+10 = 22, bust)
player 3♣ 2♣ 3♦ 2♣ 6♦ = 16 → win, return 0.02
PP: 3♣/2♣ no pair → 0;  21+3: 3♣ 2♣ 2♣ = Flush → 0.01 × 5 = 0.05
amount_won 0.07 (served "0.07")
```

**V2: round 13418745** (Phase A; split, both second cards first)
```
serverSeed  b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556
clientSeed  pf_Naa0pBEOuWmz6   nonce 26   stake 0.01   PP 0.01   21+3 0.01
actions     split, hit, hit, stand, hit, stand
k=0 ea6eaf5a idx 6  3♠  player 1            k=6  e671b131 idx 1  2♥  hand 1 hit
k=1 ca197c27 idx 15 5♣  dealer up           k=7  c9ea5146 idx 38 J♠  hand 1 hit (17, stand)
k=2 ca81913f idx 7  3♣  player 2            k=8  b0f61703 idx 19 6♣  hand 2 hit (12, stand)
k=3 dd7a7fea idx 14 5♠  dealer hole         k=9  f2ba7937 idx 7  3♣  dealer draws (13)
k=4 d71a95a2 idx 2  2♠  hand 1 second card  k=10 b7265d50 idx 44 K♦  dealer draws (23, bust)
k=5 d70b8278 idx 4  3♦  hand 2 second card
hand 1 3♠ 2♠ 2♥ J♠ = 17 → win 0.02;  hand 2 3♣ 3♦ 6♣ = 12 → win 0.02
PP: 3♠/3♣ same colour → Colored Pair 0.11;  21+3: 3♠ 3♣ 5♣ → 0
amount_won 0.15 (served "0.15")
```

**V3: round 13421503** (Phase A; player natural 3:2)
```
serverSeed  779a8530d053bd9a81d15c3bf2e685aafd999235e547ffb16ecefb3313848203
commitment  5b1a5f07fb1a96326c9072261396521111caca101316eccd574124f5f4a12320
clientSeed  pf_2oHahABmWrqZW   nonce 49   stake 0.01   PP 0.01   21+3 0.01   actions (none)
k=0 17651de1  392502753 idx 45 K♥  player 1
k=1 f2e9c929 4075407657 idx 9  4♥  dealer up
k=2 42a545c1 1118127553 idx 49 A♥  player 2
k=3 b4f0515f 3035648351 idx 47 K♣  dealer hole (14; dealer does not draw)
player K♥ A♥ natural → blackjack 2.5 × 0.01 = 0.025
21+3: K♥ A♥ 4♥ = Flush 0.05;  PP 0
amount_won 0.075 (served "0.075")
```

**V4: round 13418794** (Phase A; Ace up, insurance declined, dealer natural)
```
serverSeed  b6f2cbcd411eedbd53587902410f17f43e962f2e374e97ccbec24088debd0556
clientSeed  pf_Naa0pBEOuWmz6   nonce 37   stake 0.01   PP 0.01   21+3 0.01
actions     no_insurance
k=0 dae7703a 3672600634 idx 14 5♠  player 1
k=1 d2c9d634 3536442932 idx 48 A♦  dealer up → insurance offered
k=2 f4b8a8ad 4105742509 idx 37 J♥  player 2
k=3 0b48371b  189282075 idx 47 K♣  dealer hole → A♦ K♣ natural, round ends
player 5♠ J♥ = 15 → lose 0;  side bets 0
amount_won 0 (served "0")
```

**V5: round 13444246** (Phase E, 10 USDT, no side bets; double)
```
serverSeed  99a6d624d830675a44fb4e725fe64c6f61d36cedf371c80f79eeba41c0c1ddad
commitment  e18f4b87c0d30b8c55827e21d14de004e1d527b2f35855568ef87c31915350c5
clientSeed  pf_MWIcFWH1ipUlx   nonce 28   stake 10   actions double
k=0 9395bf63 2476064611 idx 7  3♣  player 1
k=1 fcdbfb75 4242275189 idx 9  4♥  dealer up
k=2 030696fd   50763517 idx 25 8♥  player 2
k=3 13042a92  319040146 idx 22 7♠  dealer hole
k=4 99333e55 2570272341 idx 13 5♥  double card (16, hand ends, stake 20)
k=5 b375b066 3010834534 idx 6  3♠  dealer draws (14)
k=6 da25ed2a 3659918634 idx 34 10♠ dealer draws (24, bust)
→ win 2 × 20 = 40 (served "40")
```

**V6: round 13443435** (Phase D, player-set client seed; split Aces)
```
serverSeed  5256f032e5b22d722ca97e261ba2fb9fa0d737d42da24fe22457fc6b37d41942
commitment  869d43bde40281ca705b2593698a06976aa0e243911159b9d4295962864ecb9f
clientSeed  pfaudit_bj_seed05   nonce 16   stake 0.01   PP 0.01   21+3 0.01   actions split
k=0 9aa9e97e idx 50 A♠  player 1          k=4 9c68cb0c idx 32 10♦ hand 1 second card
k=1 37865028 idx 8  4♦  dealer up         k=5 1a2abd9d idx 21 7♥  hand 2 second card
k=2 709ff693 idx 51 A♣  player 2          k=6 ea5c3ff1 idx 5  3♥  dealer draws (17, stands)
k=3 4309079f idx 43 Q♣  dealer hole
hand 1 A♠ 10♦ = 21 after split → win 0.02 (not 3:2);  hand 2 A♣ 7♥ = 18 → win 0.02
PP: A♠/A♣ same colour → Colored Pair 0.11;  21+3: A♠ A♣ 4♦ → 0
amount_won 0.15 (served "0.15")
```

---

## 6. Open points the public sources do not settle

- **O1: rejection.** The spec rejects `u32 ≥ 4294967248` and moves to the next
  4-byte chunk of the same digest. No drawn card hit it (probability ≈ 1.1 ×
  10⁻⁸ per card), so the data cannot tell this from plain `mod 52`, and the
  behaviour if all 8 chunks are rejected (≈ 10⁻⁶³) is unspecified. To settle
  it: Duel's written rules, or a nonce/cursor whose first chunk is ≥ LIMIT
  found on a revealed seed and checked on Duel's own verifier.
- **O2: insurance.** Offered on every Ace up card and never taken in the
  capture; the 2:1 payout, the insurance stake (conventionally S/2) and how it
  enters `amount_won` are PAGE-only (felt text), not witnessed. The record field
  `insurance_result` reads `"LOSE"` on the 138 declined offers where the dealer
  had a natural and `null` on the 324 others; its meaning when insurance is
  declined is not settled.
- **O3: edge tiers and "zero edge limits".** Every round's main
  `effective_edge` was 0.1 (%) on 5,997 rounds and 0 on 3 (13423989,
  13434469, 13480484), yet main payouts were the fixed 3:2 / 1:1 / push on all
  6,000: the served main edge did not change any payout. Every side bet carried
  `effective_edge: 0` and the full multipliers. The CONFIG `scaling_edge` tiers
  (main 0.001–0.0057; side bets with scaled multipliers) and the per-account
  "zero edge limits" (E02) say when reduced side multipliers apply; that was
  never exercised, and the CONFIG was captured 5 Oct 2026, five months after the
  rounds (30 Apr – 1 May 2026).
- **O4: split rules beyond the capture.** Splitting two different ten-value
  ranks (e.g. K-Q) was never offered (428 such starting hands; `split` absent
  from `available_actions`). Splitting after the first action, and hitting or
  doubling split Aces, are not possible per the page and never seen. Only one
  split per round was seen (page: "Split once per hand").
- **O5: action-ordering assumptions.** The replay assumes the insurance choice
  precedes any play and that `split` can only be the first play action. Both hold
  in all 6,000 rounds; no surrender action exists in any record or on the page.
- **O6: client-seed encoding beyond ASCII.** UTF-8 is assumed; all captured
  client seeds are ASCII.
- **O7: the public page names no algorithm.** "Fair result = Server seed +
  Client seed + Nonce" does not say HMAC, key form, separator, per-card cursor,
  mapping or card table. Everything in §2 rests on STANDARD + DATA, not on a
  written Duel rule. The Verify tab of `duel.com/provably-fair` was not opened
  (it shows code), so no on-site Verify result was used as a cross-check.

---

## 7. Reproduction of this spec

Implemented independently of any audit package in a throwaway script
(the spec author's check script `spec_check.py`, outside the repo) and run on every
round. Output, verbatim (5.2 s):

```
commitment SHA256(bytes(serverSeed)) resolves: 120/120 hashes, 6000/6000 rounds
commitment SHA256(ascii(serverSeed)) resolves: 0/120 hashes, 0/6000 rounds
forward chain links nextServerSeedHash(i) == serverSeedHashed(i+1): 120/120
card-for-card draw order [sequential split]: all 5837/6000  unsplit 5731/5731  split 106/269
card-for-card draw order [both-first split]: all 6000/6000  unsplit 5731/5731  split 269/269
rounds where a chunk was rejected (u32 >= 4294967248): 0
initial-deal candidates (4 initial cards all equal), over all rounds:
  key=bytes msg={c}:{n}:{k}  u32be%52  P1,D1,P2,D2: 6000/6000  P1,P2,D1,D2: 114/6000
  (all 23 other key/message/mapping candidates: 0/6000 in both orders)
full replay from the derived stream: cards (player hands + dealer) 6000/6000; recorded actions consumed exactly 6000/6000
hand result labels 6000/6000; hand + dealer values 6000/6000
side-bet labels 11600/11600; side-bet amount_won == stake x multiplier (exact) 11600/11600
round amount_won == sum(main hand returns) + side returns (exact decimal) 6000/6000
mismatches (first 10): []
  witness: all player hands bust, dealer did not draw: 1210
  witness: both naturals (push): 17
  witness: dealer natural ends round (peek): 314
  witness: dealer stood on soft 17: 93
  witness: doubled after split (hands): 186
  witness: doubled hands: 1368
  witness: insurance offered (up = A): 462
  witness: player natural paid 3:2: 260
  witness: player natural, dealer did not draw: 260
  witness: split aces (1 card each): 34
  witness: split rounds: 269
  witness: two-card 21 after split (pays 1:1): 30
  witness: 21+3 A-2-3 -> Straight: 8
  witness: 21+3 A-2-3 -> Straight Flush: 2
  witness: 21+3 K-A-2 (wrap) -> Flush: 1
  witness: 21+3 K-A-2 (wrap) -> None: 16
  witness: 21+3 Q-K-A -> Straight: 12
  witness: deal record: hole card face_down with empty rank: 5579
  witness: deal record: hole card shown (round already over): 421
  witness: split rounds with side bets: PP/21+3 use the ORIGINAL two cards (main[0], split[0]): 267
```

(The 23 zero rows are printed individually by the script; collapsed here.)
"dealer drew on soft 17" has no line because its count is 0.

---

## 8. Files and URLs opened while writing this spec

Read: the task brief; the audit framework's `games/dice/ALGORITHM.md`
(shape model, not Duel code); the audit framework's `games/blackjack/profile.json`;
`data/blackjack-dataset-6000hands.json`;
`evidence/` E01, E02, E03, E05, E06, E07,
E08, E09, E10, E11, E12 (PNG), `E18-blackjack-config-2026-10-05.json` and its
`.meta.json`. Directory listings (names only) of
this package's directory, its `data/` and `evidence/` (filtered to
drop verify-tab names), and the audit framework's `games/blackjack/`.

URLs (GET, no login, no bets, 20 Oct 2026): `https://duel.com/provably-fair`,
`https://duel.com/blackjack`, `https://duel.com/originals/blackjack` by curl
(each returned only the 4,308-byte app shell); `https://duel.com/provably-fair`
(Overview tab) and `https://duel.com/blackjack` with its rules modal (Standard
and Sidebets tabs) rendered in a browser, read as accessibility snapshots.

Not opened: any `verify-tab` or `verifier-parity` file, any `src/`, `tests/`,
`scripts/`, `capture/`, `verify.js`, `test.js`, `MANIFEST.md`, `README.md` of a
Duel package, any saved Duel JS bundle, Duel's Verify tab, E14/E15/E16 (Wizard
of Odds material), E19, or `client-seed-origin.png`.
