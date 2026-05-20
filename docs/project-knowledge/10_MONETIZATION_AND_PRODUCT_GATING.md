# 10_MONETIZATION_AND_PRODUCT_GATING

## Current Monetization Status

Monetization is not confirmed in repository.

No confirmed usage was found for:

- StoreKit.
- Google Play Billing.
- RevenueCat.
- Stripe.
- In-app purchases.
- Subscriptions.
- Paywall screens.
- Product IDs.
- Restore purchase flow.
- Trial flow.
- Entitlement checks.

## Subscription/Paywall Model

Status: Not confirmed in repository.

There is no dedicated entitlement model, premium state store, subscription service, paywall route, or purchase SDK integration.

## Premium Feature Gating

Not implemented as user/account monetization.

Technical features that could become premium later:

| Candidate capability | Current implementation state | Notes |
| --- | --- | --- |
| WHAM premium solve | Optional backend worker configuration | Config/runtime gated, not user entitlement gated |
| Pro 4-camera capture | Partial mobile/backend session support | Could be premium product tier later |
| Multi-view reconstruction | Worker implementation exists for four videos | Requires stable pro capture UX first |
| Export formats | Local and backend exports exist | No paid/free split |
| Longer video durations | Backend has duration and size limits | Not tied to paid plans |
| Team/project storage | Backend project model exists | No account/org/billing model |

## Free vs Premium Limits

Not confirmed in repository.

Current limits are operational/backend limits, not monetization limits:

- Max video bytes.
- Max metadata bytes.
- Max expected videos.
- Max video duration.
- Worker target FPS and max width.

These are read in `backend/src/config.ts` and should not be presented as product entitlements unless product decides.

## Trial Flow

Not confirmed in repository.

## Restore Purchase Flow

Not confirmed in repository.

## Export Limits/Watermark Rules

Not confirmed in repository.

No watermark code was found in local export, backend export, video overlay, or artifact writers.

## Product IDs

No product IDs were found. Do not invent product IDs.

## Known Monetization Gaps

| Gap | Why it matters | Recommended next step |
| --- | --- | --- |
| No entitlement model | Premium feature decisions need a central truth | Design `EntitlementService` only after product requirements |
| No auth/account foundation | Billing needs stable users | Replace dev bearer-token auth before monetization |
| No paywall route | Product gating UX not defined | Create designs after gating model is decided |
| No restore/purchase handling | App store compliance requirement | Add when StoreKit/Play Billing/RevenueCat is selected |
| No legal/privacy flow | Video/body data can be sensitive | Privacy review before paid production launch |

## Suggested Future Seams Based On Current Architecture

These are architectural suggestions, not implemented facts:

| Seam | Why it fits |
| --- | --- |
| `src/app/di/container.ts` | Add entitlement service alongside backend API client |
| `src/infra/api/MocapApiClient.ts` | Add entitlement/billing endpoints after backend design |
| `MultiViewSetupScreen` | Gate Pro 4-camera creation if product decides |
| `SignedUrlUploadManager` | Check entitlement before high-cost backend processing |
| `ExportResultScreen` | Gate premium reprocessing presets or premium downloads |
| Backend `ProcessingService` | Enforce server-side entitlement for expensive presets |
| Worker config/presets | Map premium presets to server-validated entitlements |

## What Not To Do Yet

- Do not add a payment SDK before auth and entitlement design are settled.
- Do not gate only in mobile UI. Backend must enforce paid limits.
- Do not hardcode product IDs in feature screens.
- Do not treat worker config such as `REMOVED_SOLVER_SELECTOR=wham` as a user entitlement.
- Do not block local review of already captured takes unless product explicitly requires it.

## Future Monetization Opportunities

Potential product directions, requiring product/legal/design decisions:

- Free solo capture with limited duration or export count.
- Paid Pro 4-camera capture.
- Paid WHAM/premium motion solve.
- Paid higher-resolution/longer-duration backend processing.
- Paid team storage/project collaboration.
- Paid advanced export formats or batch exports.

All of these are assumptions/opportunities, not confirmed roadmap items.
