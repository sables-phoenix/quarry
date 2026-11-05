# rules

- executable playbook steps live only in the local store; a shared memory page is a pointer, never the source of truth.
- browser-less tools must not launch chrome; get the browser session only in the branch that needs it.
- a 402 from a paid service is blocked, not failed; do not retry or top up without approval.
- filter playbooks by normalized site before ranking goal text, then return the top three.
- no api keys, credentials, customer data, or secret values in playbooks, pointer pages, logs, or commits.
- one unit, one check, keep it or revert it.
- a check that exits 2 is blocked and never counts as passing.
