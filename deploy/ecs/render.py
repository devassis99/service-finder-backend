#!/usr/bin/env python3
"""Fill the <PLACEHOLDER> tokens in deploy/ecs/*.json from the environment.

These files are templates because one repository deploys several
environments and, in time, several regions. Nothing else fills them in:
amazon-ecs-render-task-definition substitutes only the `image` field of
one named container, so an unfilled token reaches
register-task-definition, which rejects
"arn:aws:iam::<ACCOUNT_ID>:role/..." only after the image has been built
and pushed.

Substitution happens on the parsed document, inside string values, never
on the file text. Two reasons, and the second is the one that matters: a
URL can contain characters sed's replacement treats as syntax (& most
obviously), and — worse — a value containing a quote can close its own
JSON string and add fields. A text substitution of

    "value": "<CORS_ORIGINS>"   with   CORS_ORIGINS='http://a","evil":"x'

produces a file that is still valid JSON, so no amount of parsing
afterwards catches it. Substituting into the value and re-encoding means
the encoder escapes it and the worst case is a wrong URL.

Every token found in the files must be present and non-empty in the
environment. A missing GitHub Environment variable expands to the empty
string rather than leaving the token behind, so "did it get substituted"
is not the same question as "is it set" — this checks the second.
"""

import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
FILES = sorted(HERE.glob("task-definition.*.json"))
TOKEN = re.compile(r"<([A-Z][A-Z0-9_]*)>")


def main() -> int:
    if not FILES:
        print(f"::error::no task definitions found in {HERE}", file=sys.stderr)
        return 1

    docs = {f: json.loads(f.read_text()) for f in FILES}

    def walk(node, fn):
        if isinstance(node, str):
            return fn(node)
        if isinstance(node, list):
            return [walk(v, fn) for v in node]
        if isinstance(node, dict):
            return {k: walk(v, fn) for k, v in node.items()}
        return node

    wanted: set[str] = set()

    def collect(text: str) -> str:
        wanted.update(TOKEN.findall(text))
        return text

    for doc in docs.values():
        walk(doc, collect)

    missing = sorted(n for n in wanted if not os.environ.get(n))
    if missing:
        for name in missing:
            print(
                f"::error::{name} is unset or empty. It is a placeholder in "
                f"deploy/ecs/*.json and must be set on the workflow's "
                f"environment.",
                file=sys.stderr,
            )
        return 1

    def fill(text: str) -> str:
        return TOKEN.sub(lambda m: os.environ[m.group(1)], text)

    for path, doc in docs.items():
        path.write_text(json.dumps(walk(doc, fill), indent=2) + "\n")

    # Names, and the two values that are neither secret nor interesting.
    print(f"filled {', '.join(sorted(wanted))} in {len(FILES)} task definitions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
