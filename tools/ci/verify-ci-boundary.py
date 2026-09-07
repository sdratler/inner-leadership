#!/usr/bin/env python3
"""Fail closed if the required proposed-code workflow loses its safety invariants."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "pr-ci.yml"


def aggregate_passes(results: dict[str, str], required: tuple[str, ...]) -> bool:
    return all(results.get(job) == "success" for job in required)


def main() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    forbidden = ("secrets.", "pull_request_target", "environment:", "persist-credentials: true")
    for value in forbidden:
        if value in text:
            raise SystemExit(f"CI_BOUNDARY_FORBIDDEN:{value}")

    required_fragments = (
        "permissions:\n  contents: read",
        "services:\n      postgres:",
        "image: postgres:17",
        "npm run lint",
        "npm run typecheck",
        "npm run build",
        "node ../../tools/ci/create-migration-database.cjs",
        "npm run db:migrate",
        "npm run db:verify",
        "npm run test:db",
        "npm run test:e2e",
        "application-ci:",
        "if: always()",
        "needs: [static-and-control, app-and-database]",
        "STATIC_RESULT: ${{ needs.static-and-control.result }}",
        "APP_RESULT: ${{ needs.app-and-database.result }}",
        'test "$STATIC_RESULT" = success && test "$APP_RESULT" = success',
    )
    for value in required_fragments:
        if value not in text:
            raise SystemExit(f"CI_BOUNDARY_REQUIRED_FRAGMENT_MISSING:{value}")

    required = ("static-and-control", "app-and-database")
    assert aggregate_passes({job: "success" for job in required}, required)
    for bad in ("failure", "cancelled", "skipped", ""):
        assert not aggregate_passes(
            {"static-and-control": "success", "app-and-database": bad}, required
        )
    assert not aggregate_passes({"static-and-control": "success"}, required)
    print("CI_BOUNDARY_OK")


if __name__ == "__main__":
    main()
