import json
import sys

s = json.load(open(sys.argv[1]))["summary"]
assert s["recall"] >= 0.8, s
assert s["total_ratio"] >= 3.0, s
print("selection recall", s["recall"], "total ratio", s["total_ratio"])
