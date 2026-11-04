import json
import sys

d = json.load(open(sys.argv[1]))
assert d["replay_catches_regression"] is True, d
assert d["regression_tokens"] < 300, d
wins = 0
for flow in d["flows"]:
    assert flow["ladder"]["ok"] is True, flow
    assert flow["replay"]["ok"] is True, flow
    if flow["screenshot"]["tokens"] / max(flow["ladder"]["tokens"], 1) >= 5:
        wins += 1
assert wins >= 3, d
print("flows", len(d["flows"]), "ladder wins", wins, "boot", d["boot_ms"])
