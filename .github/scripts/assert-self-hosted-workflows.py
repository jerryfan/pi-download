#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(".github/workflows")
errors = []
workflow_files = sorted(root.glob("*.yml")) + sorted(root.glob("*.yaml"))

for path in workflow_files:
    runs_on_count = 0

    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()

        if stripped.startswith("runs-on:"):
            runs_on_count += 1
            if "self-hosted" not in stripped or "gofaster-ci" not in stripped:
                errors.append(
                    f"{path}:{number}: runs-on must require self-hosted and gofaster-ci"
                )

        if stripped.startswith("uses:") and ".github/workflows/" in stripped:
            errors.append(
                f"{path}:{number}: reusable workflow calls are not allowed by the "
                "self-hosted-only policy"
            )

    if runs_on_count == 0:
        errors.append(f"{path}: workflow contains no explicit runs-on declaration")

if errors:
    print("SELF_HOSTED_POLICY_FAILED", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    sys.exit(1)

print(
    f"SELF_HOSTED_POLICY_PASS workflows={len(workflow_files)} "
    "required_labels=self-hosted,gofaster-ci"
)
