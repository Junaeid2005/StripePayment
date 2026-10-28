# Bistro Five — Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched is unconditionally denied (`allow read, write: if false`).
2. **Verified Identity**: Every write operation across all collections requires `request.auth != null && request.auth.token.email_verified == true`.
3. **PII Isolation (`/users/{userId}`)**: Customer emails and profile records can only be read (`get`) by `isOwner(userId)` or `isAdmin()`, and listed only by `isBootstrapAdmin()`. Users can never assign `role` or `isAdmin` fields on their profile.
4. **Admin Privilege Integrity (`/admins/{adminId}`)**: Admin access is never derived from client custom claims; it requires verified email matching the bootstrapped admin (`junaeidshohan2005@gmail.com` with `email_verified == true`) or existence of `/admins/$(request.auth.uid)`.
5. **£1–£5 Price Enforcement (`/menuItems/{itemId}`)**: Only verified admins can create, update, or delete menu items. Every menu item must have `pricePence is int && pricePence >= 100 && pricePence <= 500` (£1.00–£5.00). Public list/get is strictly restricted to `resource.data.available == true`.
6. **Order Integrity & Terminal State Locking (`/orders/{orderId}`)**:
   - An order can only be created if `/users/$(request.auth.uid)` exists, `userId == request.auth.uid`, `status == 'pending'`, `paymentStatus == 'unpaid'`, `currency == 'gbp'`, `stripeSessionId` matches `^cs_[a-zA-Z0-9_]+$`, and `createdAt == request.time`.
   - Immortal fields (`orderNumber`, `userId`, `customerEmail`, `totalPence`, `currency`, `itemCount`, `itemsSummary`, `stripeSessionId`, `createdAt`) cannot be mutated on update.
   - Once `status` reaches `'completed'` or `'cancelled'`, non-admin updates are permanently locked.
7. **Master Gate & Atomic Subcollection (`/orders/{orderId}/items/{lineId}`)**:
   - Line items are stored in a dedicated subcollection (no unbounded arrays) and validated against parent `/orders/{orderId}` ownership via `getAfter()` on atomic creation and `get()` on single-doc reads, with `lineTotalPence == unitPricePence * quantity`.
8. **Zero Cost-Explosion List Queries**: No `get()` or `exists()` calls appear inside any `allow list` rule; every `allow list` evaluates `resource.data` directly or checks verified bootstrap admin token attributes.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Shadow Privilege Injection (`users/uid_alice`)**: Creating a user profile with `{ ..., isAdmin: true }` -> Rejected by `hasOnly()`.
2. **Unverified Admin Email Spoof (`menuItems/item_1`)**: Writing as `junaeidshohan2005@gmail.com` with `email_verified: false` -> Rejected by `isVerifiedUser()`.
3. **Cross-User PII Scrape (`users/uid_bob`)**: Authenticated `uid_alice` attempting `get` on `users/uid_bob` -> Rejected by `isOwner(userId) || isAdmin()`.
4. **Menu Price Out-of-Bounds (`menuItems/item_cheap`)**: Admin attempting to create an item with `pricePence: 50` (£0.50) or `pricePence: 900` (£9.00) -> Rejected by `pricePence >= 100 && pricePence <= 500`.
5. **Unavailable Menu Item Scraping (`menuItems`)**: Unauthenticated client running unfiltered `list` on `menuItems` where `available == false` -> Rejected by `existing().available == true`.
6. **Pre-Paid Order Forgery (`orders/ord_1`)**: Customer creating an order with `status: 'paid', paymentStatus: 'paid'` -> Rejected by `incoming().status == 'pending' && incoming().paymentStatus == 'unpaid'`.
7. **Orphaned Order Without User Profile (`orders/ord_2`)**: Verified user without `/users/{uid}` document creating an order -> Rejected by `exists(/databases/$(database)/documents/users/$(request.auth.uid))`.
8. **Identity Spoofing on Order (`orders/ord_3`)**: `uid_alice` creating an order with `userId: 'uid_bob'` -> Rejected by `incoming().userId == request.auth.uid`.
9. **Terminal State Re-Opening (`orders/ord_done`)**: Owner attempting to update an order whose `existing().status == 'completed'` -> Rejected by terminal state gate.
10. **Order Total Mutation on Update (`orders/ord_4`)**: Owner attempting to reduce `totalPence` while confirming payment -> Rejected by `affectedKeys().hasOnly(...)` and immutable field check.
11. **ID Poisoning Attack (`orders/bad$id!spaces`)**: Creating document with non-alphanumeric ID or >128 chars -> Rejected by `isValidId()`.
12. **Orphaned / Arithmetic-Mismatch OrderItem (`orders/ord_1/items/line_1`)**: Creating an `OrderItem` where `lineTotalPence != unitPricePence * quantity` or parent order does not belong to `request.auth.uid` -> Rejected by `isValidOrderItem` and Master Gate `getAfter()`.
