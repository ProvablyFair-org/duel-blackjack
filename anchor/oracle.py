"""Duel Blackjack -- independent exact-rational RTP oracle (anchor for verify Step 16).

Run:  python3 anchor/oracle.py        (Python 3 standard library only; nothing to install)

WHY IT EXISTS. src/optimal-play.ts solves the declared strategy in floating point with a 10-rank
model (all ten-value cards folded into one rank 'T') and conditions the dealer on "no natural"
with a closed-form posterior. This file answers the same question a different way, so the two can
only agree if both are right:

  - exact Fractions throughout: no floating point, no tolerance;
  - 13 RANKS, not 10: 10, J, Q, K are distinct ranks, so "split by rank" (Duel splits 10-10, never
    10-J) is played exactly as declared instead of approximated by a value pair;
  - the hole card is a CONCRETE card: every (up-card, hole) pair is enumerated, the holes that make
    a natural are removed because the peek has already ended those rounds, and the dealer's final
    distribution is the average over the remaining holes -- no conditional formula;
  - written from the rule set alone (src/config.ts RULES); it does not import or read the engine.

Rules (Duel, src/config.ts RULES): infinite deck; dealer stands on soft 17 (S17); dealer peeks;
natural pays 3:2, pushes against a dealer natural; a dealer natural at the peek takes the base stake
only; double on any first two cards; one split, by rank; split aces receive one card each; double
after split; a two-card 21 after a split is a total (pays 1:1); no re-split; no surrender;
insurance never taken (never +EV at 2:1 on an infinite deck).

It prints the RTP per initial bet under S17 (the declared rule) and under H17 (the negative
control) as exact numerator/denominator. Those strings are pinned in src/config.ts ORACLE_RTP;
Step 16 requires the engine to equal them within 1e-12 under both rules.
"""
from fractions import Fraction as F
from functools import lru_cache

RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
P = F(1, 13)                                  # every rank, infinite deck
VALUE = {r: (11 if r == 'A' else 10 if r in ('10', 'J', 'Q', 'K') else int(r)) for r in RANKS}


def add(total, soft, rank):
    """Add one card to a (total, soft) hand. soft = an Ace is currently counted as 11."""
    if rank == 'A':
        if total + 11 <= 21:
            return total + 11, True
        return total + 1, soft
    total += VALUE[rank]
    if total > 21 and soft:
        return total - 10, False
    return total, soft


def natural(a, b):
    return add(*add(0, False, a), b)[0] == 21


@lru_cache(None)
def dealer_final(total, soft, h17):
    """Distribution of the dealer's final total (17..21, or 22 = bust) from a hand in progress."""
    if total > 21:
        return ((22, F(1)),)
    stands = total > 17 or (total == 17 and (not soft or not h17))
    if stands:
        return ((total, F(1)),)
    out = {}
    for r in RANKS:
        for k, p in dealer_final(*add(total, soft, r), h17):
            out[k] = out.get(k, F(0)) + P * p
    return tuple(sorted(out.items()))


@lru_cache(None)
def dealer_after_peek(up, h17):
    """(P(dealer natural | up), final-total distribution over the holes that are NOT a natural)."""
    holes = [h for h in RANKS if not natural(up, h)]
    p_nat = F(13 - len(holes), 13)
    out = {}
    for h in holes:
        for k, p in dealer_final(*add(*add(0, False, up), h), h17):
            out[k] = out.get(k, F(0)) + p / len(holes)
    return p_nat, tuple(sorted(out.items()))


def solver(up, h17):
    _, dist = dealer_after_peek(up, h17)

    @lru_cache(None)
    def stand(t):
        if t > 21:
            return F(-1)
        ev = F(0)
        for k, p in dist:
            ev += p if (k == 22 or t > k) else (-p if t < k else 0)
        return ev

    @lru_cache(None)
    def play(t, s):
        """Best EV of a hand that may stand or hit (no double, no split)."""
        if t > 21:
            return F(-1)
        return max(stand(t), hit(t, s))

    @lru_cache(None)
    def hit(t, s):
        return sum((P * play(*add(t, s, r)) for r in RANKS), F(0))

    def double(t, s):
        return 2 * sum((P * stand(add(t, s, r)[0]) for r in RANKS), F(0))

    def two_card(t, s, may_double):
        best = play(t, s)
        return max(best, double(t, s)) if may_double else best

    def split_hand(c):
        """One post-split hand that starts with card c: its second card, then the declared play."""
        ev = F(0)
        for r in RANKS:
            t, s = add(*add(0, False, c), r)
            if c == 'A':                    # split aces: one card each, then stand
                ev += P * stand(t)
            else:                           # DAS; a two-card 21 here is a total (stand(21))
                ev += P * two_card(t, s, True)
        return ev

    def best(a, b):
        t, s = add(*add(0, False, a), b)
        ev = two_card(t, s, True)
        if a == b:                          # split by rank: 10-10 yes, 10-J no
            ev = max(ev, 2 * split_hand(a))
        return ev

    return best, split_hand, stand


def rtp(h17):
    total = F(0)
    for up in RANKS:
        p_nat, _ = dealer_after_peek(up, h17)
        best, _, _ = solver(up, h17)
        for a in RANKS:
            for b in RANKS:
                pc = P * P * P
                if natural(a, b):
                    total += pc * (p_nat * 1 + (1 - p_nat) * F(5, 2))
                else:
                    total += pc * (p_nat * 0 + (1 - p_nat) * (1 + best(a, b)))
    return total


def split_tens_chosen(h17):
    used = []
    for up in RANKS:
        _, split_hand, stand = solver(up, h17)
        if 2 * split_hand('10') > stand(20):
            used.append(up)
    return used


if __name__ == '__main__':
    for name, h17 in (('S17 (declared)', False), ('H17 (negative control)', True)):
        r = rtp(h17)
        print(f'{name:24s} RTP per initial bet = {float(r) * 100:.10f}%   exact = {r.numerator}/{r.denominator}')
        print(f'{"":24s} a 10-10 split beats standing on 20 against up-cards: {split_tens_chosen(h17) or "none"}')
