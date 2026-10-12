# Paystack escrow — activation (Stage 4)

The marketplace can collect a confirmed order's payment, hold it in **escrow**, and
release it to the seller. All secret-key work runs in Supabase **Edge Functions**;
the browser never sees the Paystack secret key.

**Nothing charges real money in test mode.** Use your Paystack **test** keys
(`pk_test_…` / `sk_test_…`) until you deliberately switch to live keys.

## Money flow

```
order confirmed ──buyer pays──▶ awaiting_payment ──Paystack charge.success (webhook)──▶ in_escrow
      ▲                                                                                     │
   seller confirms                                              buyer confirms receipt ─────┘
                                                                          ▼
                                                                      released
```

Loamy holds the funds in its Paystack balance while the order is `in_escrow`.
Automated payout/transfer to the seller's bank on `released` is the next
increment; today `released` records the buyer's authorisation to settle.

## One-time setup

1. **Get test keys** — Paystack Dashboard → Settings → API Keys & Webhooks (Test mode).

2. **Frontend gate** — add the public key to `.env` (browser-safe; only enables the Pay UI):
   ```
   VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxx
   ```
   Restart `npm run dev` after editing `.env`.

3. **Edge Function secrets** — the SECRET key never goes in `.env`:
   ```
   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx APP_URL=http://localhost:5173
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

4. **Deploy the functions:**
   ```
   supabase functions deploy paystack-initialize
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```
   `--no-verify-jwt` is required for the webhook: Paystack calls it without a
   Supabase JWT (it is instead authenticated by the signature check).

5. **Register the webhook** — in the Paystack Dashboard, set the webhook URL to:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook
   ```
   Paystack sends `charge.success` here; the function verifies the signature +
   re-verifies the transaction, then moves the order into escrow.

## Test the flow

1. Sign in as a buyer, place an order, and have the seller confirm it.
2. On **Orders → My orders**, the confirmed order shows **Pay securely**.
3. Pay with a Paystack **test card** (e.g. `4084 0840 8408 4081`, any future
   expiry, any CVV). You're redirected back to `/orders?paid=…`.
4. Within a few seconds the webhook moves the order to **in escrow**.
5. Click **Confirm receipt & release** to move it to **released**.

## Seller payouts (Transfers) — completing the loop

When a buyer confirms receipt (**release**), Loamy transfers the escrowed funds
to the seller's bank via Paystack Transfers.

**Setup (once):**
1. Deploy the payout functions:
   ```
   supabase functions deploy paystack-banks
   supabase functions deploy paystack-create-recipient
   supabase functions deploy paystack-payout
   ```
2. In **Paystack Dashboard → Settings → Transfers**, **enable Transfers** and, for
   automated test-mode payouts, **disable the Transfer OTP** (otherwise `/transfer`
   returns `otp` and each transfer must be finalized with a code).
3. Test mode needs a test **balance** to transfer from (Paystack funds test balance
   automatically as test charges succeed).

**How it flows:**
- A seller adds their bank under **Settings → Payout account**. Loamy validates it
  with Paystack (resolves the real account name) and stores a transfer recipient.
- On **Confirm receipt & release**, Loamy calls `paystack-payout`, which transfers
  the order total to the seller's recipient and marks the order **completed**.
- If the seller hasn't added a payout account yet, the order is released and the
  seller is notified to add one — the transfer runs once they do (buyer or admin
  can re-trigger release/payout).

**Verify:** as a seller, Settings → Payout account → pick a bank + a test account
number (e.g. `0000000000`) → it resolves a name and saves. Then release a paid
order and check the seller's balance / the `order_payouts` row.

## Security notes

- The Paystack **secret key** exists only as a Supabase secret, never in the repo
  or the browser bundle.
- The webhook **verifies the `x-paystack-signature` HMAC** over the raw body AND
  re-verifies the transaction with Paystack before trusting it.
- `order_payments` is readable only by the order's buyer, seller, or an admin
  (RLS); it is written exclusively by the Edge Functions via the service role.
- Amounts are computed **server-side** from the order subtotal — the client never
  states an amount.
