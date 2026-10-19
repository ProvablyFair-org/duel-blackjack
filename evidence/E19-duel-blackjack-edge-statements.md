# E19 — Duel's statements on the blackjack edge

Duel's descriptions of how its blackjack edge works, as they reached ProvablyFair.org. Each one was relayed to ProvablyFair.org as text; the quotations below are verbatim as relayed, typing included. Times are UTC. None of these statements was tested by this audit.

## 1. Duel, relayed to ProvablyFair.org on 22 April 2026 (02:33 UTC)

Duel's reply to ProvablyFair.org's pre-capture questions on the game rules and the Zero Edge mechanism, among them the Zero Edge rebate formula and limits and whether the rebate applies to the side bets (Perfect Pairs, 21+3) or the main bet only:

> Rules should be: Unlimited decks in play. The result is a push if both you and the dealer have a blackjack. If the dealer has a natural blackjack, the game concludes. This conclusion would be a push if you too have a blackjack. You can only split once. You cannot hit on split aces nor can you double on split aces. You can double on any first two cards. Dealer always stands on 17. You can double after a split. You can split non-like tens such as QT and KQ. Dealer peeks on both A(T hidden) and T(A hidden) and concludes the round if it’s a natural blackjack. Natural blackjack for the player pays 3:2, otherwise normal 1:1, including after a split as it’s not natural. Otherwise, blackjack is 3:2 and insurance pays 2:1. (few months old from my notes when i digged into it but should be correct)
>
> It just gives a 0.44% (or something like that) rakeback to make it 0.1% net edge
>
> 0 edge applies to sidebets also, there's a paytable, it's exactly 0 edge
> yes, applies to the limit, will ask for how it applies

## 2. A Duel staff member's post on X, relayed to ProvablyFair.org on 1 May 2026 (23:35 UTC)

The relay reported a post on X by a person who works at Duel giving blackjack's house edge as 0.57%, and gave the post as `https://x.com/i/status/2050301952852992188`. This audit did not retrieve the post, so its wording is not quoted here.

## 3. Duel, relayed to ProvablyFair.org on 22 May 2026 (08:41 UTC)

Said while explaining how Castle Roulette's edge is computed:

> yeah so zero edge rules apply, the user has the same daily wager limit of up to 50k max 1k per bet.

and, in the same reply:

> 1000 is the max allowed daily zero wager per bet (can be lower if they have lower limits because they exhausted the rest)

## What these statements do not say

- None gives the blackjack rakeback rate as 0.57%. The 22 April reply gives "0.44% (or something like that)".
- None names the `effective_edge` field or says what it means.
- None says how the `scaling_edge` ladders in Duel's blackjack config (E18) apply, within the daily limit or above it. Duel's rules modal (E02) says only that the order in which bets are processed "may affect your effective house edge depending on your remaining zero edge limits."
- The $50,000 daily limit and the $1,000 per-bet limit were stated while describing Castle Roulette, as "the same daily wager limit".
