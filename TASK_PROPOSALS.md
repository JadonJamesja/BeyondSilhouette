# Codebase Task Proposals

## 1) Typo Fix Task
**Issue found:** There is a duplicated word in a backend comment: `// DB connectivity smoke test (Prisma) (Prisma)`.

**Task:** Update the duplicated comment text in `server/src/server.js` so it reads cleanly and consistently (single `(Prisma)`).

**Why this matters:** Small typo-level issues in comments make the code feel less maintained and can distract during debugging/review.

**Suggested acceptance criteria:**
- The duplicated `(Prisma)` is removed.
- No behavior changes are introduced.

---

## 2) Bug Fix Task
**Issue found:** `page()` normalizes route names to values like `checkout`, `orders`, `account`, and `edit-profile`, but `gateCheckoutAndOrders()` checks for `checkout.html`, `orders.html`, `account.html`, and `edit-profile.html`.

**Task:** Fix `gateCheckoutAndOrders()` in `client/js/main.js` to match the normalized values returned by `page()`.

**Why this matters:** Auth gating is currently skipped for protected pages, so unauthenticated users can access pages that were intended to require login.

**Suggested acceptance criteria:**
- `needsAuth` becomes true for `checkout`, `orders`, `account`, and `edit-profile`.
- Unauthenticated access to these routes redirects to `login.html`.
- Authenticated users can still access these routes.

---

## 3) Code Comment / Documentation Discrepancy Task
**Issue found:** The top-level header comment in `client/js/main.js` says `Cart + auth + checkout + orders remain production (DB-backed)`, but the same file defines in-memory state with `// IN-MEMORY STATE (NO browser storage)` and `__MEM` structures that are used for demo/session fallback logic.

**Task:** Update the top-of-file comment block in `client/js/main.js` so the architecture note accurately reflects current behavior (server-backed with in-memory/demo fallback where applicable).

**Why this matters:** Mismatched comments lead to incorrect assumptions for maintainers and can cause incorrect debugging paths.

**Suggested acceptance criteria:**
- Header comment accurately describes current persistence/auth flow.
- No functional code changes are required.

---

## 4) Test Improvement Task
**Issue found:** There are no automated tests validating route auth gating behavior in frontend logic.

**Task:** Add a focused unit/integration test around the page routing + auth gate behavior in `client/js/main.js`, specifically asserting that protected routes trigger login redirect for guests and allow authenticated users.

**Why this matters:** This would have caught the route-name mismatch bug in `gateCheckoutAndOrders()` before shipping.

**Suggested acceptance criteria:**
- Add test coverage for at least `checkout` and `orders` protected routes.
- Test verifies redirect for guest users.
- Test verifies no redirect for authenticated users.
- Test runs in CI/local with a documented command.
