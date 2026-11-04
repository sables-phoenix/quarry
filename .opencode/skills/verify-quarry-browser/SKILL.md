---
name: verify-quarry-browser
description: Prove the browser delta ladder and replay protocol still work, and recheck the formal model. Use before shipping any change to browser-probe/ or formal/.
---

run `scripts/verify-browser.sh`. it starts the fixture site on port 8899 if needed.

it proves:

1. four flows complete under the delta ladder and under replay
2. at least three flows show a 5x or better token win over a screenshot per step
3. replay catches a deliberately broken login page, and the failure report stays under 300 tokens
4. tlc finds no invariant violation in the passing and failing assertion configurations

set `CHROME` to the browser binary when it is not `chrome-headless-shell` on `PATH`.
