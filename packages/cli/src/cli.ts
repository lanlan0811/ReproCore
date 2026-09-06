#!/usr/bin/env node

import { VERSION } from "./index.js";

const HELP = `ReproCore ${VERSION}

Usage: reprocore <command> [options]

Commands will be enabled as each MVP gate is completed.

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

const argument = process.argv[2];

if (argument === "--version" || argument === "-v") {
  process.stdout.write(`${VERSION}\n`);
} else {
  process.stdout.write(HELP);
  if (argument !== undefined && argument !== "--help" && argument !== "-h") {
    process.exitCode = 2;
  }
}
