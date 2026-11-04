import json
import sys

s = json.load(open(sys.argv[1]))["summary"]
assert s["ok"] >= 15, s
assert s["median_ratio_html"] >= 5.0, s
assert s["warm_ms_p50"] < s["cold_ms_p50"], s
print("html ratio", s["median_ratio_html"], "cold", s["cold_ms_p50"], "warm", s["warm_ms_p50"])
