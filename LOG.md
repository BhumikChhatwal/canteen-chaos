# Debug log

Your notes. One entry per bug you fixed, using the template below.

This file is read as carefully as your code. A correct fix you cannot
explain counts for little; a bug you could not fix but investigated
honestly still counts for something.

Delete the example before you submit.



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
