"""Summarize recorded activity generation runs as Markdown."""
import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import mean

DEFAULT_LOG = Path(__file__).resolve().parent / "logs/generation_logs.jsonl"


def summarize(rows):
    passed = [r for r in rows if r["passed"]]
    pairs = [r for r in rows if r["is_regeneration"] and r["level"] == 2]
    attempts = [r["attempts"] for r in passed]
    failures = Counter(f for r in rows for f in r["failure_categories"])

    def rate(hits, total):
        return f"{100 * hits / total:.1f}%" if total else "N/A"

    return {
        "First-pass success rate": rate(sum(r["first_pass_success"] for r in rows), len(rows)),
        "Mean attempts to pass": f"{mean(attempts):.2f}" if attempts else "N/A",
        "Max attempts to pass": max(attempts, default="N/A"),
        "Schema conformance rate (runs accepted)": rate(len(passed), len(rows)),
        "L1 → L2 regeneration success rate": rate(sum(r["passed"] for r in pairs), len(pairs)),
        **{k: failures[k] for k in ("json_parse_error", "schema_validation_error", "api_error")},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    path = parser.parse_args().log
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    print("| Metric | Value |\n|---|---:|")
    for name, value in summarize(rows).items():
        print(f"| {name} | {value} |")


if __name__ == "__main__":
    main()
