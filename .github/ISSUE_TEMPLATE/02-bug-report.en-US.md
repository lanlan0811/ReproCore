---
name: Bug report
about: Report a reproducible issue without sensitive data
title: "[Bug] "
labels: bug
---

Stop and use the private process in SECURITY.md for vulnerabilities.

## Description

Describe the expected and actual behavior.

## Minimal reproduction

Attach only a redacted fixture and minimal commands. Never attach raw captures,
credentials, or SQLite caches.

## Environment

- ReproCore version:
- Node version:
- Operating system:
- `reprocore doctor --json` summary:

## Safety check

- [ ] I ran `reprocore redact --check` on attachments
- [ ] The report contains no token, cookie, personal path, or user data
