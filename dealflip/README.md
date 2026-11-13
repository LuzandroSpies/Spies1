# DealFlip

A deal finder and contract-assignment ("wholesaling") calculator with AI drafting.
Inspired by "AI house flipping" videos, but built to show the real numbers, not just the headline.

## What it does

1. **Browse deals.** Tax deed, tax lien, foreclosure, probate and off-market listings, filterable by sale type, state and price. Add your own.
2. **Check the numbers.** Replace the listing's "estimated value" with your own after-repair value (ARV), repairs and title/lien costs.
3. **Get it under contract.** Slide your offer price and set closing days, earnest money, inspection period, seller credits and an "and/or assigns" clause. Draft a letter of intent.
4. **Get cash buyers.** Match your buyers list against the deal (county, price range, property type, rehab level, proof of funds) and draft an email to each one.
5. **See what you'd actually make.** Your assignment fee and net, plus the end buyer's all-in cost and profit. The tool flags when the buyer would lose money, which is when a deal won't sell.
6. **Contracts.** Two fill-in templates built from each deal:
   - **Purchase agreement** (seller to you, "and/or assigns"). You can cancel for any reason during a free-look period and get your earnest money back. After that, the seller's only remedy is keeping the earnest money. It includes a plain assignment disclosure the seller initials.
   - **Assignment agreement** (you to your cash buyer). States the assignment fee, the investor's deposit, and that your ARV and repair numbers are estimates.
   These are starting drafts for a local real estate attorney to review, not finished legal documents.
7. **AI deal review.** Claude reviews the deal, ranks the risks for that sale type and gives a due-diligence checklist.

The first sample deal uses the numbers from the video ($11,559 price, $74,000 value, $50,000 buyer price). The headline $38,441 fee is correct arithmetic. But once you add $18k of repairs and $3.5k of title costs, a 70%-rule investor would pay about $30,300, and at $50,000 the end buyer loses about $6,400.

## Run it

```bash
cd dealflip
npm install
npm start            # http://localhost:3100
npm test
```

AI features use Claude (`claude-opus-5-5`). Set `ANTHROPIC_API_KEY` (or log in with `ant auth login`) to turn them on.
If Claude declines a request on a safety classifier, the API retries on a fallback model (`fallbacks: "default"`).
Without credentials, the app still works and uses plain templates for every draft.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | Server port |
| `DEALFLIP_MODEL` | `claude-opus-5-5` | Claude model |
| `DEALFLIP_STORE` | `data/store.json` | Where added deals and buyers are saved |

## Important

- Sample deals and buyers are fictional. Real listings come from county tax sale lists, the MLS, or a data provider. Connecting one is the next step.
- County tax deed and tax lien sales are usually **auctions**. You bid, pay in full within days, and generally can't assign the purchase.
- Many states regulate wholesaling (licensing, disclosure, marketing a property you don't own). Check yours.
- This is an educational tool, not legal or financial advice.
