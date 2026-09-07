# Security model

中文：[安全模型](security.md)

## Protection goals

ReproCore's primary goal is to prevent credentials from leaking during capture,
minimization, or publication and to stop untrusted input from escaping the case
workspace. Its second goal is to ensure that “the failure is still present” comes
from an auditable Oracle rather than a runner crash, network instability, or cache
contamination.

## Trust boundaries

- MCP servers, captured content, imported `.mincase` files, Oracle text, and report fields are untrusted.
- The generated local runner is trusted but may interpret only a ReproCore-generated fixture plan.
- The Docker daemon is an optional external trust root. Real servers must never fall back to local execution when Docker is unavailable.
- Raw capture directories and candidate SQLite databases are sensitive local data and are never part of the public case format.

## Capture and redaction

Capture omits message content by default and stores only structure, types, lengths,
and hashes. After explicit `--include-content`, ReproCore scans every frame before
writing it for API keys, Authorization/Bearer values, cookies, OAuth codes, private
keys, and common token forms. During export, the fixture, Oracle, and proof share
one deterministic substitution map; email addresses, absolute paths, and sensitive
URL query values are replaced as well. The second scan must have no blocking
finding, and the redacted version must reproduce five consecutive times.

Findings contain only a category, source location, and irreversible SHA-256
fingerprint. They never contain the matched plaintext. Unknown extensions, binary
attachments, and symbolic links cannot be scanned reliably and therefore block a
public export. Scanning is defense in depth and does not replace the exporter's
manual review.

## Replay isolation

The local backend:

- runs only the generated fixture runner, never a real server or custom script;
- creates a fresh system temporary directory for every run and passes only an explicit environment-variable allowlist;
- rejects absolute paths, parent traversal, and symbolic-link escapes; and
- kills the process tree on timeout and verifies that cleanup still targets the expected temporary root.

The Docker backend is for higher-risk input. Its arguments always disable networking,
select a non-root user, make the root filesystem read-only, and limit CPU, memory,
PIDs, and temporary storage. It rejects images that are not pinned by SHA-256 digest;
the user must still audit the image supply chain. A normally completed isolated
process supplies the custom-script Oracle observation. A timeout or captured-output
limit breach remains `UNRESOLVED`. Candidate fixtures are sent only over stdin
without mounting a host directory. An interrupted container is forcibly removed by
its random container name, and cleanup failure is an error. Only SHA-256 summaries
of the invocation, stdout, and stderr are kept; raw output is not added to a case.

## Reports and imported cases

Reports escape every untrusted field, contain no JavaScript, and set a
`default-src 'none'` Content Security Policy. Visual markers use inline SVG. The
`.mincase` verifier rejects unlisted files at any directory level, symbolic links,
databases, raw frames, unknown format major versions, and mismatched hashes for all
standard artifacts.
Before reading case content, `verify` and `report` also scan the entire directory.
Credentials, sensitive query parameters, binary content, and other blocking
findings are rejected even if manifest hashes were changed at the same time.

Do not double-click or directly run miscellaneous files from an unknown archive.
Extract it in isolation, inspect the manifest and redaction proof, and run
`reprocore verify`. Analyze an unknown or custom-script explanatory case manually
inside a disposable container.

## Known limitations

- Regular expressions and sensitive key names cannot prove the absence of all business-private information.
- SHA-256 fingerprints can permit dictionary guesses for low-entropy values, so short personal identifiers must not be treated as safely fingerprinted.
- v0.1.0 fixed-response replay simulates MCP observations and does not replace a full real-server behavior test.
- Docker network isolation depends on the local Docker daemon enforcing the requested arguments.

Report vulnerabilities privately using the repository-level [security policy](../SECURITY.md).
