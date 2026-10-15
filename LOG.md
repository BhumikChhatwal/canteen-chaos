# Debug log

Your notes. One entry per bug you fixed, using the template below.

This file is read as carefully as your code. A correct fix you cannot
explain counts for little; a bug you could not fix but investigated
honestly still counts for something.

Delete the example before you submit.



## CC-07 — "Cancelling makes it worse"

**Reproduced:** Hakka Noodles started at stock 5. I placed an order
for 1 → stock 4 (correct). I then cancelled that order (PATCH
`/api/orders/<token>/status {status:'cancelled'}` → 200) and re-read
the menu: stock was **3**, not 5. Every further cancel of another
order would keep eating stock, exactly as the staff member described.

**Cause:** `releaseStock()` in `backend/logic/validation.js` — the
function whose whole job is "put the food back on the shelf" — did
`stock: dish.stock - line.qty`. It subtracted a second time instead of
adding, so cancelling was effectively a second reservation. The
caller in `orders.routes.js` was right to call it; the function itself
had the wrong sign.

**Fix:** Changed the subtraction to `+ line.qty` in `releaseStock()`.
That function is the single place that reverses a reservation (the
cancel path in the route is its only caller), so fixing the sign there
fixes every cancellation without touching the route — keeping the
"reservation bookkeeping lives in logic/validation.js" boundary that
`reserveStock`/`releaseStock` are paired around.

**Checked:** Order 1 from stock 5 → 4; cancel → 5 again. A second
order/cancel cycle ends at 5 again. `reproduce.js` reports OK.

**Time:** ~15 minutes. Half of that was re-reading the cancel path to
make sure points and coupon uses are refunded elsewhere and this
function should only ever touch stock.

## CC-01 — "The search suggestions are behind everything"

**Reproduced:** On a 1280px window I typed `da` in the search box.
The dropdown appeared with 4 suggestions, but its top ~50px sat
*behind* the orange category bar (screenshot in my notes: the first
item, "Dal Tadka Thali", was not visible). I probed the dropdown with
`document.elementFromPoint()` down its left edge: the top band
returned `.cat-tabs` / `.filters`, only the lower part returned
`suggest-item`. A real click on the first item landed at (286, 166)
on `.cat-tabs` — no dish opened, and the click outside
`.search-wrap` made the list close, which reads as "clicking does
nothing".

**Cause:** Stacking, not the dropdown itself. `.suggest-box` has
`z-index: 100`, but it lives inside `.search-wrap { z-index: 1 }`, a
stacking context — a child's z-index only competes *within* its
parent. Sibling `.cat-tabs` is `position: relative; z-index: 40` with
an opaque background, so the whole `.search-wrap` subtree (max 1)
painted below the category row (40). The list hung down over the
category bar and was covered by it.

**Fix:** Raised `.search-wrap` to `z-index: 41` — one step above the
category row inside `.filters`. The search box is the interactive
control the dropdown belongs to; it must stack above its siblings.
Leaving the category row at 40 is harmless (nothing else competes
with it), so only the search box's level changed.

**Checked:** elementFromPoint now returns `suggest-item` for every
point of the dropdown, and a real click on the first suggestion opens
the "Dal Tadka Thali" dish modal. The list still sits above the menu
when it hangs past the filter bar, and keyboard arrows/Enter still
work.

**Time:** ~35 minutes. The interesting part was realising a child's
z-index is trapped inside its parent's stacking context — the
`z-index: 100` on `.suggest-box` looked correct at first glance.

## CC-06 — "I ordered more than they had"

**Reproduced:** Veg Momos (id 21) had `stock 2`. I posted an order for
`qty 5` and got `201 Created`; re-reading the menu showed
`stock: -3`. The order sat in the queue as a normal order for 5 plates
the counter does not have. (`reproduce.js` does exactly this and prints
the stock after.)

**Cause:** `validateLine()` in `backend/logic/validation.js` checked
that a dish exists, that the quantity is a whole number between 1 and
10, that the dish is served now, not disabled, and not *at* zero
stock — but never compared the quantity with the amount in stock. An
order of 5 with 2 left sailed through validation. Then
`reserveStock()` — whose own comment says "re-checks every line, so
two requests cannot take the same last plate" — just subtracted
everything it was given, happily driving stock negative. So the rule
"you cannot sell what you do not have" existed nowhere in the code.

**Fix:** Enforced the rule in both places it belongs:
1. `validateLine()` rejects a line whose quantity exceeds stock
   (`Only 2 of Veg Momos left - you asked for 5`), so the student gets
   a clear 400 before anything is written.
2. `reserveStock()` now re-checks stock line by line while it
   subtracts, as its comment always claimed it did. This is the step
   that runs against the menu as it is *right now*, between validation
   and the write, so a race (two people taking the last plate) or a
   future caller that skips validation cannot push stock below zero.

Validation is the right layer because it already owns every other
"may this order exist" rule (sold out, off menu, per-dish limits) and
runs on the server, which the README calls the owner of the truth.

**Checked:** Qty 5 with stock 2 → 400 with the message above, stock
untouched at 2. Qty 2 → 201, stock 0, next attempt rejected as "sold
cancelled". `reproduce.js` reports OK for both.

**Time:** ~25 minutes; the rest of the hour was spent making sure the
check could not break the normal path (a stock change by staff between
validate and reserve, which is what point 2 covers).

## CC-08 — "An old coupon still works"

**Reproduced:** With the canteen open, I quoted a Rs. 264 cart with
`couponCode: "FRESHERS24"` (data says `expiresAt 2024-09-30`, last
year). The reply was `couponDiscount: 30, couponError: null` — full
discount, no complaint. Placing the order would charge it the same way.
(`reproduce.js` prints the same result.)

**Cause:** `applyCoupon()` in `backend/logic/pricing.js` is the only
place that decides whether a coupon applies, and it checked uses
remaining, minimum order, veg-only and slots — but never
`expiresAt`. The `GET /api/coupons` listing does filter expired
codes, so FRESHERS24 is not offered in the UI; typing the code into
the coupon box goes straight to pricing, which accepted it. The rule
lived in the list, not in the decision.

**Fix:** Added an expiry check at the top of `applyCoupon()`, next to
the "coupon exists" check, returning `"FRESHERS24 has expired"`.
Pricing is the right layer: every path that can charge a discount
(the cart quote and the real order) runs through this one function, so
the rule now holds no matter how the code arrives.

**Checked:** Quote and order with FRESHERS24 now fail with "has
expired" and discount 0; BYTE10 (valid until 2027) still discounts
normally; the coupon list is unchanged.

**Time:** ~20 minutes, most of it tracing which endpoints accept a
coupon code (quote and POST /orders both call calculateBill).

## CC-09 — "The menu shows more dishes than it should"

**Reproduced:** `GET /api/menu?limit=5&page=1` came back with
`total 37, pages 8, hasMore true` — but `dishes` contained all 37
dishes, not 5. In the browser this is visible without dev tools: the
counter on the menu page says "requested page size 5" next to
"Showing 37 dishes", and the first paint dumps the entire menu instead
of one small page for the infinite scroll to extend.

**Cause:** `paginate()` in `backend/logic/search.js` sliced the list
correctly into a local variable `items`, but then returned
`items: list` — the whole filtered list — instead of `items: items`.
The route sends `dishes: paged.items`, so every page returned every
dish; `page`, `pages` and `hasMore` were computed from the slice and
looked right, which is why the response looked internally
contradictory.

**Fix:** Return the slice (`items`) from `paginate()`. The function
already computed it; the wrong variable was handed back. Pagination
lives here rather than in the route because search, filters and sort
all feed into it and all expect the same paging semantics.

**Checked:** `limit=5&page=1` returns 5 dishes, `pages 8`, `hasMore`
true; page 2 returns the next 5 with no overlap. The browser now first
paints 5 cards, and the "Load more" / scroll-sentinel path appends the
rest 5 at a time to 37.

**Time:** ~10 minutes.

## CC-10 — "Sorting by price is backwards"

**Reproduced:** With the server running, I asked the menu endpoint for
`?sort=price-asc&limit=48` and printed the first prices: 138.5, 135,
133, 119.5 … — the most expensive dishes first. `price-desc` returned
16.5, 21, 23, 26 … — the cheapest first. Same thing in the browser:
picking "Price: low to high" in the sort dropdown showed the expensive
dishes at the top of the grid. (`backend/test/reproduce.js` prints
this comparison.)

**Cause:** The sort table in `backend/logic/search.js` had the two
comparators swapped: `price-asc` was defined as `b.price - a.price`
(descending) and `price-desc` as `a.price - b.price` (ascending). Every
sort option goes through this one table, so both price options were
exactly inverted while `rating-desc`, `name-asc` etc. were fine.

**Fix:** Swapped the two comparator functions back in `SORTERS`. The
comparator is the place that decides what "asc" means, and it is the
only definition of price ordering in the app — the route and the
browser both call `sortDishes()` — so fixing it there fixes every
caller at once.

**Checked:** `reproduce.js` now reports both price sorts OK; in the
browser, "low to high" starts at Rs. 16.5 and "high to low" starts at
Rs. 138.5. Rating and name sorts are unchanged.

**Time:** ~15 minutes. Most of it was working out that sorting only
happens server-side (the select just sends `sort=`), so there was one
definition to check rather than two.



## Could not fix

For anything you investigated but did not solve. Say what you tried and
where you got to. This is worth marks — leaving it blank when you got
stuck is not.

### CC-0X — "<the complaint>"

**What I tried:**

**Where I got to:**

**What I would try next:**



## Extra credit

Anything not on the bug log: a problem you found yourself, a test you
wrote, or a fix you are unsure about. Same format, plus one line on how
you noticed it.
