# Debug log

One entry per bug: how I reproduced it on this machine, what was
actually wrong, what I changed and why that was the right place.
The "Could not fix" section holds the two decisions I would flag in
code review; the extra-credit section holds two unreported bugs I
found and the regression test for all of it.

The automated checks live in `backend/`:

    npm test                   - the regression suite (node --test)
    node scripts/reproduce.js  - the manual repro, needs a running
                                 server started with TZ=UTC

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
## CC-02 — "Can't read anything in dark mode"

**Reproduced:** My laptop reports `prefers-color-scheme: dark`, so
the site boots straight into dark theme (that is the "looks like this
the moment they open the site" half of the report — `boot()` applies
`preferredTheme()` before anything renders). I measured the computed
colours on a dish card: name and price were `rgb(43, 33, 24)`
(#2b2118) on the dark card `#201913` — a contrast ratio of **1.33:1**
(effectively invisible). The meta line under the name used
`var(--muted)` and measured 6.85:1, which is why "the grey line under
the name is fine".

**Cause:** `.dish-body` in `frontend/style.css` hard-coded
`color: #2b2118` — the light-theme ink — instead of using the theme
variable. The dish name, price, quantity control and Add-to-Cart label
all inherit from `.dish-body`, so everything inside the card content
kept the light-theme colour after the palette swapped to dark.

**Fix:** Replaced the hard-coded colour with `var(--ink)`. The dark
theme already redefines `--ink` to `#f2e8df`, so the one variable is
the theme's job; that is exactly what every other text rule in the
file uses. Nothing else changes in light mode because `--ink` *is*
#2b2118 there.

**Checked:** Re-measured in dark mode: name and price now
`rgb(242, 232, 223)` on `#201913` — about 12:1. Switched back to
light: colours byte-identical to before. The two other hard-coded
#2b2118 uses (`.toast-warn`, `.slot-bar.rush`) sit on amber
backgrounds in both themes and are correct as they are.

**Time:** ~15 minutes, mostly confirming the other two #2b2118 uses
were intentional.
## CC-03 — "The menu is wider than my phone"

**Reproduced:** At a 481px-wide window (a phone just above the
`max-width: 480px` block, where the grid becomes two columns) the
menu grid computed to `257px 325px` tracks and the page's scrollWidth
was 615 vs a 464px viewport — sideways scrolling, with the entire
second column (Add to Cart included) hanging off the right edge, cut
off. Measuring each card showed *why* the tracks were too wide: the
long-named dish ("Paneer Butter Masala with Butter Naan") had a
`.name-btn` 300px wide — its full unwrapped name — and every card's
image contributed ~255px of min-content (its `aspect-ratio: 3/2`
width at `height: 170px`). Grid tracks default to
`minmax(auto, 1fr)`, so a track can never shrink below its content's
min-content: the columns inflated until everything fit, pushing the
page sideways. Narrower phones (≤480) hid the same overflow behind
`.view { overflow-x: hidden }` (see CC-05) — the Add to Cart buttons
on the right were clipped off-screen instead.

**Fix:** Three parts, all in `frontend/style.css`, one per cause:
1. All four `.menu-grid` column rules now use `minmax(0, 1fr)` so
cards may shrink below their min-content; the card clips
(`overflow: clip` is already set) and images cover-crop instead of
widening the page. This is the standard cure for grid blowout.
2. Removed `.name-btn { width: max-content }` (the ≤760px rule). It
stopped dish names from wrapping, so a long name set its card's
minimum width; the button is an inline-block and shrink-to-fit
already, so the rule bought nothing and cost the layout. With it
gone, "Paneer Butter Masala with Butter Naan" wraps to two lines
inside a 208px card.
3. The header row (brand + 3 links + theme + cart) measured ~590px
and overflowed between 481–600px, adding its own sideways scroll.
That is why the nav only collapses to a hamburger at ≤480. I moved
the collapse breakpoint to `max-width: 600px` so the row fits
whenever the full nav is shown.

**Checked:** 481px: `scrollWidth == clientWidth`, tracks 208/208, the
long-name card wraps and sits fully inside the screen. 320px: no
overflow, the card keeps its 16px right padding and the Add to Cart
button is fully visible. 1280px: unchanged 4-column layout, no
hamburger. Because removing CC-05's `overflow-x: hidden` unmasks
overflow everywhere, I also re-checked the other views at 320px:
the Counter's stock rows were a five-control grid that could not fit
one line (390px wide), so at ≤480px they now wrap (name on its own
line) — no sideways scroll there either; the orders table still
scrolls inside its own `.table-wrap` as designed.

**Time:** ~50 minutes. Two of those were the useful kind: proving the
blowout numerically (tracks equal to min-content, then a live
`width: auto` injection on `.name-btn` shrinking track 2 from 325 to
257) rather than guessing at which element was "too wide".
## CC-04 — "The buttons don't work on my tablet"

**Reproduced:** I resized a browser to 820×1180 (a tablet in
portrait, inside the 761–900px band the reporter's tablet hits).
`document.elementFromPoint()` on the middle of an "Add to Cart"
button returned the `<article class="dish-card">` itself — not the
button. Same for the favourite star (returned `.img-wrap`). A real
click on the button did nothing: cart count stayed 0, no toast, no
stepper. On a 1280px window the same click works, and my 820px
measurement showed the media query active — the tablet-only
band was the tell.

**Cause:** A block in `frontend/style.css` scoped to
`@media (min-width: 761px) and (max-width: 900px)` draws two
pseudo-element overlays on every dish card: `.dish-card::after`
(bottom 58px, `z-index: 3` — the strip with the Add to Cart button)
and `.img-wrap::after` (52×52 top-right, `z-index: 1` — over the
star). They are `background: transparent`, so nothing looks wrong,
but their z-index puts them above the buttons, and pseudo-elements
receive pointer events unless told otherwise. Every click in those
bands hit an overlay, so the delegated `[data-action]` handler never
saw a match. Laptops (>900) and phones (≤760) never draw them —
exactly "works on my laptop, works on my friend's phone".

**Fix:** Added `pointer-events: none` to both pseudo-elements. They
are decoration (the `.blocked` variant tints a card); decoration must
not own the pointer. Removing the whole block would also have worked,
but it would silently drop the blocked-card tint that exists in that
band, and the point of a fix is not to change unrelated behaviour.

**Checked:** At 820px: clicked Add to Cart on Hakka Noodles — cart
count went to 1 and the button became the quantity stepper; clicked
the star — `aria-pressed` toggled and the id persisted in
localStorage. At 1280px nothing changed (media query does not apply).

**Time:** ~20 minutes. Most of it was trusting the measurement over
the screenshot: the overlays are invisible, so elementFromPoint and a
click are the only honest evidence.
## CC-05 — "The category bar scrolls away on my phone"

**Reproduced:** At a 400×800 viewport (≤480px, phone) I scrolled to
y=600 and measured: `.filters` was at viewport `[-507, -275]` — the
whole bar (search, chips, categories) had scrolled off the top. It
never stuck. `.site-header` correctly stayed at [0, 93].

**Cause:** Two things, both in `frontend/style.css`:
1. `@media (max-width: 480px) { .view { overflow-x: hidden; } }`.
   `overflow: hidden` on an ancestor turns it into the scroll
   container for its sticky descendants. `.filters` is sticky inside
   `.view`, but `.view` itself is not the thing scrolling (the page
   is), so the bar had nothing to stick to and travelled with the
   content. This rule only exists below 480px — which is why the
   complaint says "on smaller screens". It was also masking real
   horizontal overflow (see CC-03) rather than letting it show.
2. With that gone, `.filters { top: 0 }` would stick the bar *under*
   the sticky `.site-header` (z-index 50, 93px tall, also `top: 0`),
   so the bar would stay "stuck" but invisible — I confirmed this
   overlap exists on desktop today: at scrollY 298 on a 1280px
   window the filter bar sits at [0, 106] behind the header [0, 93],
   and `elementFromPoint` on the search box returns the header's
   brand text. That is the same defect the phone reporter sees from
   the other side.

**Fix:** Deleted the `overflow-x: hidden` rule (it hides symptoms;
CC-03 fixes the cause of the overflow it was hiding), and changed
`.filters` to stick at `top: var(--header-h)` (93px) so the bar parks
*below* the header at every width. One custom property on `:root`
documents how the 93 is made up (62px bar + one-line slot bar +
border) instead of a bare magic number.

**Checked:** Phone 400×800, scrolled to 600: bar stuck at [93, 325],
fully visible under the header, search input at y107. Desktop 1280,
scrolled: bar at [93, 199], search input clickable (it used to be
behind the header). The open nav dropdown on phones still overlays
correctly because it belongs to the header's stacking context.

**Time:** ~30 minutes. The `overflow` ancestor rule is a classic
sticky-breaker but easy to miss; the header-height offset came from
re-reading the complaint ("staying *visible* at the top") and
testing what "stuck at 0" would actually look like behind a sticky
header.
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
out". `reproduce.js` reports OK for both.

**Time:** ~25 minutes; the rest of the hour was spent making sure the
check could not break the normal path (a stock change by staff between
validate and reserve, which is what point 2 covers).
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
dishes at the top of the grid. (`backend/scripts/reproduce.js` prints
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

(Nothing stayed unfixed — but see "fixes I am unsure about" below for
two decisions I would want a second opinion on.)

### Honesty note — two fixes I would flag in review

**1. The 93px sticky offset (`--header-h`).** CC-05's "bar stays
visible" fix parks `.filters` at `top: var(--header-h)` with 93px
computed from today's header (62px bar + one-line 30px slot bar +
1px border). I measured it at 320–1280px and the slot bar is one line
everywhere with the current strings — but if the slot text ever wraps
two lines (a longer status message, browser font scaling), the header
grows and the filter bar would tuck under it again. The robust fix is
to measure the header once in JS and set the variable, or to make the
header and filter bar one sticky element (which would require moving
`.filters` out of the menu view and would show it on the other views).
I did not do either; the CSS-only version is honest about its
assumption and easy to replace.

**2. Coupon use counting is check-then-write.** The decrement reads
`coupons`, subtracts 1 and writes back. Two orders racing for the
last advertised use of a coupon could both pass `applyCoupon()` and
take the counter to -1 — the same class of race that stock reservation
now guards against (CC-06's `reserveStock` re-check). In this app the
server is single-process and synchronous between read and write, so
the window is a few milliseconds of a hypothetical concurrent runner;
I left it rather than restructure `store.update` for one counter. If
this app ever ran more than one process, both stock and coupons would
need the same transactional treatment.
## Extra credit

Anything not on the bug log: a problem you found yourself, a test you
wrote, or a fix you are unsure about. Same format, plus one line on
how you noticed it.

### Unreported bug 1 — "My Orders" can never show anything

**How I noticed:** While testing CC-06 I read `frontend/js/orders.js`
to see which endpoint feeds the My Orders page; it calls
`api.listOrders({ memberId: deviceId() })`. Then I read the server's
`GET /api/orders` and the filter did not look like it could ever
match.

**Reproduced:** Placed an order with `X-Member-Id: dev-test-123` →
201, response `memberId: "dev-test-123"`. Then
`GET /api/orders?memberId=dev-test-123` → `count: 0`, empty list. In
the browser the My Orders page shows "No orders found … This browser
has N saved order token(s)" forever, no matter how many orders this
device places. A student's order exists on the counter dashboard but
is invisible to them.

**Cause:** In `backend/routes/orders.routes.js` the query filter was
`orders.filter((o) => o.memberId === req.query.userId)` — it read a
`userId` query parameter that nothing ever sends. The filter compared
every order's memberId with `undefined` and matched nothing, so the
endpoint answered "this member has no orders" for every member.

**Fix:** Read `req.query.memberId` — the parameter the route advertises
and the only one the frontend sends. One word; the mistake was a
wrong property name in exactly one place.

**Checked:** After the fix the same call returns `count: 2` (both
test orders for that member), and other members' orders are not in
the list. The staff endpoint (`?status=…`) is unaffected.

**Time:** ~10 minutes.

### Unreported bug 2 — coupon uses are never counted, and cancelling
mints new ones

**How I noticed:** While writing CC-08 I followed what happens to a
coupon after a successful order and found the placement path's
coupon update was `{ ...c, usesLeft: c.usesLeft }` — a no-op dressed
up as bookkeeping, while the cancel path gave a use *back*
(`usesLeft + 1`).

**Reproduced:** `BYTE10.usesLeft` started at 501. Ordered 2 Hakka
Noodles with `couponCode: BYTE10` (discount 13.2 applied, 201) →
usesLeft still **501**. Cancelled that order → usesLeft **502** — one
more use than the coupon has ever had. Every use+cancel cycle mints a
use; "This coupon is fully used" can never happen in practice, and
cancelling dilutes the counter without limit.

**Cause:** Two halves of one rule living apart: `applyCoupon()`
enforces `usesLeft <= 0`, but nothing ever decrements the counter
when the coupon is actually spent. The cancel path in
`PATCH /:token/status` already assumed the decrement existed and
reversed it, so cancelling inflated the counter.

**Fix:** In `POST /api/orders`, the placeholder map now decrements
`usesLeft` when `bill.couponCode` is set (i.e. the coupon was applied
and charged). The cancel path's `+1` was already correct and is now
balanced. The idempotent-replay path returns the stored order before
this code, so a double-tapped "Place Order" still counts one use.

**Checked:** Uses 501 → order with coupon → 500 → cancel → 501.
Repeat cycles stay balanced. An expired or invalid coupon never
reaches the decrement (pricing rejects it first), and ordering with
no coupon does not touch the counter.

**Time:** ~15 minutes.

### Extra: a regression test (`npm test`)

`backend/test/regression.test.js` is a `node:test` suite (no new
dependencies — Node has had a test runner and fetch built in for
years) that boots the real server as a child process on a free port
with `TZ=UTC` so the canteen is open, drives it over HTTP exactly as
the browser does, and restores `menu.json`/`coupons.json` afterwards.
`npm test` in `backend/` runs it.

It covers every backend rule from the log plus the two extra fixes:
sort order, one page per request, expired-coupon rejection (and that
a valid coupon still works), refusing quantities above stock without
touching stock, restoring stock on cancel, listing orders by
`memberId`, and coupon uses being spent exactly once per order —
including that replaying an idempotency key does not spend a second
use and cancelling gives the use back.

**Proof it is a regression test:** I checked out the original commit
(`0b2f232`) into a temporary `git worktree`, copied the suite in, and
ran it against the unfixed code with the main repo's `node_modules`
on `NODE_PATH`. Result: **7 of 8 tests fail** (only "a valid coupon
still works" passes — it asserts behaviour that was never broken).
Against the fixed tree: **8 of 8 pass**, including a second
consecutive run with the first run's data still in place, which
caught a bug in my own first draft — a fixed idempotency key collided
with the previous run's order and the server (correctly) replayed it
instead of placing a new one. The key is now generated per run.

**Time:** ~45 minutes, including the fails-before run and fixing my
own test bug.
