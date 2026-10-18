"""Merge the test results and the method notes into site/stats.json for the page."""
import json

stats = json.load(open("site/stats.json"))
stats["reader"] = json.load(open("data/reader_metrics.json"))
stats["method"] = json.load(open("scripts/method.json"))
json.dump(stats, open("site/stats.json", "w"), indent=1)
print("site/stats.json updated")
