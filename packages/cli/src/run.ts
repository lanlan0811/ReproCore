import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  captureProcess,
  SensitiveContentError,
} from "@reprocore/capture-stdio";
import { readMinCaseManifest, sha256, type JsonValue } from "@reprocore/format";
import {
  CandidateCache,
  minimizeTransactions,
  type DependencyGraph,
  type TransactionUnit,
} from "@reprocore/minimizer";
import {
  createOracleTemplate,
  evaluateOracle,
  OracleDocumentSchema,
  readOracleDocument,
  writeOracleDocument,
} from "@reprocore/oracles";
import {
  hasBlockingFindings,
  redactDocuments,
  RedactionProofSchema,
  scanPath,
  scanText,
} from "@reprocore/redaction";
import { generateStaticReport } from "@reprocore/report";
import {
  readReplayFixture,
  ReplayFixtureSchema,
  runDoctor,
  runFixtureReplay,
  type ReplayFixture,
  verifyBaseline,
} from "@reprocore/replay";
import { EXIT_CODES, SafetyBlockedError, VERSION } from "./index.js";
import { createMinCase, verifyMinCase } from "./case.js";
import { minimizeFixtureJson } from "./minimize-fixture.js";
import { parse } from "yaml";

const HELP = `ReproCore ${VERSION}

Usage:
  reprocore doctor [--json]
  reprocore capture --out <directory> [--include-content] [--json] -- <server> [args...]
  reprocore oracle init --out <oracle.yaml> [--name <name>] [--json]
  reprocore replay --fixture <fixture.json> --oracle <oracle.yaml> [--repeat <count>] [--json]
  reprocore minimize --fixture <fixture.json> --oracle <oracle.yaml> --out <fixture.json> [--json]
  reprocore report --case <name.mincase> [--out <report.html>] [--json]
  reprocore pack --fixture <fixture.json> --oracle <oracle.yaml> --proof <proof.json> --out <name.mincase.zip> --confirm-export [--json]
  reprocore redact --check <path> [--json]
  reprocore verify --case <name.mincase> [--repeat <count>] [--json]
  reprocore --version

Commands:
  doctor   Check runtime and isolation backend availability
  capture  Transparently proxy and record an MCP stdio server
  oracle   Create a versioned failure-oracle document
  replay   Run deterministic fixed-response replay and baseline checks
  minimize Reduce replay transactions while preserving the failure Oracle
  report   Generate a safe, offline HTML report from a .mincase directory
  pack     Build a deterministic portable .mincase directory and ZIP
  redact   Scan a file or directory without exposing matched values
  verify   Validate hashes and reproduce a .mincase failure

Options:
  -h, --help         Show this help
  -v, --version      Show the version
  --json             Emit the command summary as JSON on stderr
  --confirm-export   Confirm creation of a portable, redacted export
`;

export interface CliIo {
  stdout: Writable;
  stderr: Writable;
}

const defaultIo: CliIo = { stdout: process.stdout, stderr: process.stderr };

interface CaptureArguments {
  command: string;
  commandArguments: string[];
  includeContent: boolean;
  json: boolean;
  outputDirectory: string;
}

interface FixtureTransaction extends TransactionUnit {
  exchange: ReplayFixture["exchanges"][number];
}

function fixtureDependencyGraph(
  fixture: ReplayFixture,
  transactions: readonly FixtureTransaction[],
): DependencyGraph {
  const graph = new Map(
    transactions.map(
      (transaction) => [transaction.transactionId, new Set<string>()] as const,
    ),
  );
  let initialize: string | undefined;
  let discovery: string | undefined;
  for (const transaction of transactions) {
    const method = transaction.exchange.request.method;
    if (method === "initialize") initialize = transaction.transactionId;
    if (method === "tools/list" || method === "server/discover") {
      discovery = transaction.transactionId;
    }
    if (
      fixture.protocolVersion === "2025-11-25" &&
      method !== "initialize" &&
      initialize !== undefined
    ) {
      graph.get(transaction.transactionId)!.add(initialize);
    }
    if (method === "tools/call" && discovery !== undefined) {
      graph.get(transaction.transactionId)!.add(discovery);
    }
  }
  return graph;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function writeResult(
  io: CliIo,
  json: boolean,
  value: unknown,
  message: string,
): void {
  io.stdout.write(json ? `${JSON.stringify(value)}\n` : `${message}\n`);
}

function parseCaptureArguments(args: string[]): CaptureArguments {
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1) {
    throw new Error("capture requires `-- <server> [args...]`");
  }
  const options = args.slice(0, separator);
  const server = args.slice(separator + 1);
  let outputDirectory: string | undefined;
  let includeContent = false;
  let json = false;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--include-content") includeContent = true;
    else if (option === "--json") json = true;
    else if (option === "--out") {
      outputDirectory = options[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown capture option: ${option ?? ""}`);
    }
  }
  if (outputDirectory === undefined)
    throw new Error("capture requires --out <directory>");
  const command = server[0];
  if (command === undefined)
    throw new Error("capture server command is missing");
  return {
    command,
    commandArguments: server.slice(1),
    includeContent,
    json,
    outputDirectory: resolve(outputDirectory),
  };
}

export async function runCli(
  args: string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout.write(HELP);
    return EXIT_CODES.success;
  }
  if (command === "--version" || command === "-v") {
    io.stdout.write(`${VERSION}\n`);
    return EXIT_CODES.success;
  }

  try {
    if (command === "doctor") {
      const json = args.slice(1).includes("--json");
      const report = await runDoctor();
      writeResult(
        io,
        json,
        report,
        report.checks
          .map(
            (check) =>
              `${check.status.toUpperCase()} ${check.name}: ${check.detail}`,
          )
          .join("\n"),
      );
      return report.ready ? EXIT_CODES.success : EXIT_CODES.executionFailure;
    }

    if (command === "capture") {
      const parsed = parseCaptureArguments(args.slice(1));
      const result = await captureProcess({
        command: parsed.command,
        args: parsed.commandArguments,
        outputDirectory: parsed.outputDirectory,
        includeContent: parsed.includeContent,
        output: io.stdout,
        errorOutput: io.stderr,
      });
      if (parsed.json) {
        io.stderr.write(
          `${JSON.stringify({ command: "capture", output: parsed.outputDirectory, ...result })}\n`,
        );
      }
      return result.exitCode;
    }

    if (command === "oracle" && args[1] === "init") {
      const commandArgs = args.slice(2);
      const outputPath = optionValue(commandArgs, "--out");
      if (outputPath === undefined)
        throw new Error("oracle init requires --out <oracle.yaml>");
      const name = optionValue(commandArgs, "--name") ?? "reprocore-failure";
      const resolvedPath = resolve(outputPath);
      writeOracleDocument(resolvedPath, createOracleTemplate(name));
      writeResult(
        io,
        commandArgs.includes("--json"),
        { command: "oracle init", output: resolvedPath },
        `Created ${resolvedPath}`,
      );
      return EXIT_CODES.success;
    }

    if (command === "replay") {
      const commandArgs = args.slice(1);
      const fixturePath = optionValue(commandArgs, "--fixture");
      const oraclePath = optionValue(commandArgs, "--oracle");
      if (fixturePath === undefined || oraclePath === undefined) {
        throw new Error(
          "replay requires --fixture <fixture.json> and --oracle <oracle.yaml>",
        );
      }
      const repeatText = optionValue(commandArgs, "--repeat");
      const oracle = readOracleDocument(resolve(oraclePath));
      const repeat =
        repeatText === undefined
          ? oracle.repeat
          : Number.parseInt(repeatText, 10);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new Error("--repeat must be an integer between 1 and 100");
      }
      const baseline = verifyBaseline(
        readReplayFixture(resolve(fixturePath)),
        oracle,
        repeat,
      );
      writeResult(
        io,
        commandArgs.includes("--json"),
        baseline,
        `${baseline.status}: ${baseline.evaluations.length}/${repeat} checks completed`,
      );
      return baseline.status === "STABLE"
        ? EXIT_CODES.success
        : EXIT_CODES.flakyUnsupported;
    }

    if (command === "minimize") {
      const commandArgs = args.slice(1);
      const fixturePath = optionValue(commandArgs, "--fixture");
      const oraclePath = optionValue(commandArgs, "--oracle");
      const outputPath = optionValue(commandArgs, "--out");
      if (
        fixturePath === undefined ||
        oraclePath === undefined ||
        outputPath === undefined
      ) {
        throw new Error(
          "minimize requires --fixture <fixture.json>, --oracle <oracle.yaml>, and --out <fixture.json>",
        );
      }
      const fixture = readReplayFixture(resolve(fixturePath));
      const oracle = readOracleDocument(resolve(oraclePath));
      const baseline = verifyBaseline(fixture, oracle, 3);
      if (baseline.status !== "STABLE") return EXIT_CODES.flakyUnsupported;

      const transactions: FixtureTransaction[] = fixture.exchanges.map(
        (exchange, index) => ({
          transactionId: `exchange-${index}`,
          exchange,
        }),
      );
      const maxTestsText = optionValue(commandArgs, "--budget-tests");
      const maxDurationText = optionValue(commandArgs, "--budget-ms");
      const maxTests =
        maxTestsText === undefined ? 10_000 : Number.parseInt(maxTestsText, 10);
      const maxDurationMs =
        maxDurationText === undefined
          ? 10 * 60 * 1_000
          : Number.parseInt(maxDurationText, 10);
      if (!Number.isInteger(maxTests) || maxTests < 1) {
        throw new Error("--budget-tests must be a positive integer");
      }
      if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1) {
        throw new Error("--budget-ms must be a positive integer");
      }

      using cache = new CandidateCache(
        resolve(
          optionValue(commandArgs, "--cache") ?? ".reprocore/candidates.sqlite",
        ),
      );
      const minimizationStarted = Date.now();
      const result = await minimizeTransactions(transactions, {
        dependencyGraph: fixtureDependencyGraph(fixture, transactions),
        maxTests,
        maxDurationMs,
        cache,
        cacheNamespace: sha256(
          JSON.stringify({ fixture, oracle, stage: "transactions-v1" }),
        ),
        validate: (candidate) => candidate.length > 0,
        test: async (candidate) => {
          const candidateFixture: ReplayFixture = {
            ...fixture,
            exchanges: candidate.map((transaction) => transaction.exchange),
          };
          return evaluateOracle(
            oracle,
            runFixtureReplay(candidateFixture).observation,
          ).result;
        },
      });
      const minimizedFixture: ReplayFixture = {
        ...fixture,
        exchanges: result.transactions.map(
          (transaction) => transaction.exchange,
        ),
      };
      const structure = await minimizeFixtureJson(minimizedFixture, oracle, {
        cache,
        maxTests: Math.max(0, maxTests - result.testCount),
        maxDurationMs: Math.max(
          0,
          maxDurationMs - (Date.now() - minimizationStarted),
        ),
      });
      const minimality =
        result.minimality === "oneMinimal" &&
        structure.minimality === "oneMinimal"
          ? "oneMinimal"
          : "budgetExhausted";
      const resolvedOutput = resolve(outputPath);
      writeFileSync(
        resolvedOutput,
        `${JSON.stringify(structure.fixture, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      const proofPath = resolve(
        optionValue(commandArgs, "--proof") ?? `${outputPath}.proof.json`,
      );
      writeFileSync(
        proofPath,
        `${JSON.stringify(
          {
            version: 1,
            transaction: result,
            structure: {
              ledgers: structure.ledgers,
              originalFieldCount: structure.originalFieldCount,
              finalFieldCount: structure.finalFieldCount,
              fieldReductionRate: structure.fieldReductionRate,
              minimality: structure.minimality,
              testCount: structure.testCount,
            },
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const summary = {
        originalCount: result.originalCount,
        finalCount: result.finalCount,
        reductionRate: result.reductionRate,
        fieldReductionRate: structure.fieldReductionRate,
        minimality,
        output: resolvedOutput,
        proof: proofPath,
      };
      writeResult(
        io,
        commandArgs.includes("--json"),
        summary,
        `${minimality}: ${result.originalCount} -> ${result.finalCount} transactions`,
      );
      return minimality === "oneMinimal"
        ? EXIT_CODES.success
        : EXIT_CODES.unresolved;
    }

    if (command === "pack") {
      const commandArgs = args.slice(1);
      const fixturePath = optionValue(commandArgs, "--fixture");
      const oraclePath = optionValue(commandArgs, "--oracle");
      const proofPath = optionValue(commandArgs, "--proof");
      const outputPath = optionValue(commandArgs, "--out");
      if (
        fixturePath === undefined ||
        oraclePath === undefined ||
        proofPath === undefined ||
        outputPath === undefined
      ) {
        throw new Error(
          "pack requires --fixture, --oracle, --proof, and --out <name.mincase.zip>",
        );
      }
      if (!outputPath.endsWith(".mincase.zip")) {
        throw new Error("pack output must end with .mincase.zip");
      }
      if (!commandArgs.includes("--confirm-export")) {
        throw new SafetyBlockedError(
          "pack requires --confirm-export after reviewing the redaction boundary",
        );
      }
      const inferredName = basename(outputPath, ".mincase.zip");
      const name = optionValue(commandArgs, "--name") ?? inferredName;
      const resolvedOutput = resolve(outputPath);
      const caseDirectory = resolve(
        optionValue(commandArgs, "--case-dir") ??
          join(dirname(resolvedOutput), `${name}.mincase`),
      );
      const fixture = readReplayFixture(resolve(fixturePath));
      const oracle = readOracleDocument(resolve(oraclePath));
      const proof = JSON.parse(
        readFileSync(resolve(proofPath), "utf8"),
      ) as unknown;
      const redacted = redactDocuments([
        asJsonValue(fixture),
        asJsonValue(oracle),
        asJsonValue(proof),
      ]);
      if (!redacted.proof.verified) {
        throw new SafetyBlockedError(
          "Export blocked because sensitive content remains after redaction",
        );
      }
      const redactedFixture = ReplayFixtureSchema.parse(redacted.values[0]);
      const redactedOracle = OracleDocumentSchema.parse(redacted.values[1]);
      const redactedProof = redacted.values[2];
      const created = createMinCase({
        name,
        caseDirectory,
        outputZip: resolvedOutput,
        fixture: redactedFixture,
        oracle: redactedOracle,
        proof: redactedProof,
        redaction: redacted.proof,
        exportConfirmed: true,
      });
      writeResult(
        io,
        commandArgs.includes("--json"),
        created,
        `Created ${created.outputZip}`,
      );
      return created.manifest.caseType === "executable"
        ? EXIT_CODES.success
        : EXIT_CODES.unresolved;
    }

    if (command === "report") {
      const commandArgs = args.slice(1);
      const casePath = optionValue(commandArgs, "--case");
      if (casePath === undefined)
        throw new Error("report requires --case <name.mincase>");
      const caseDirectory = resolve(casePath);
      const outputPath = resolve(
        optionValue(commandArgs, "--out") ?? join(caseDirectory, "report.html"),
      );
      const manifest = readMinCaseManifest(caseDirectory);
      const proof = JSON.parse(
        readFileSync(join(caseDirectory, "artifacts", "proof.json"), "utf8"),
      ) as unknown;
      const redaction = RedactionProofSchema.parse(
        parse(readFileSync(join(caseDirectory, "redaction.yaml"), "utf8")),
      );
      const report = generateStaticReport({ manifest, proof, redaction });
      if (hasBlockingFindings(scanText(report, "report.html"))) {
        throw new SafetyBlockedError(
          "Report generation blocked because sensitive content was detected",
        );
      }
      writeFileSync(outputPath, report, "utf8");
      writeResult(
        io,
        commandArgs.includes("--json"),
        { command: "report", output: outputPath },
        `Created ${outputPath}`,
      );
      return EXIT_CODES.success;
    }

    if (command === "redact" && args[1] === "--check") {
      const commandArgs = args.slice(2);
      const target = commandArgs.find((argument) => !argument.startsWith("-"));
      if (target === undefined)
        throw new Error("redact --check requires <path>");
      const findings = scanPath(resolve(target));
      const summary = {
        checked: resolve(target),
        findingCount: findings.length,
        blockingCount: findings.filter((finding) => finding.blocking).length,
        findings,
      };
      writeResult(
        io,
        commandArgs.includes("--json"),
        summary,
        `${summary.blockingCount === 0 ? "PASSED" : "BLOCKED"}: ${summary.findingCount} finding(s)`,
      );
      return summary.blockingCount === 0
        ? EXIT_CODES.success
        : EXIT_CODES.safetyBlocked;
    }

    if (command === "verify") {
      const commandArgs = args.slice(1);
      const caseDirectory = optionValue(commandArgs, "--case");
      if (caseDirectory === undefined)
        throw new Error("verify requires --case <name.mincase>");
      const repeatText = optionValue(commandArgs, "--repeat");
      const repeat =
        repeatText === undefined ? 5 : Number.parseInt(repeatText, 10);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new Error("--repeat must be an integer between 1 and 100");
      }
      const verification = verifyMinCase(resolve(caseDirectory), repeat);
      writeResult(
        io,
        commandArgs.includes("--json"),
        verification,
        `${verification.valid ? "VERIFIED" : "FAILED"}: ${verification.passed}/${repeat}`,
      );
      return verification.valid ? EXIT_CODES.success : EXIT_CODES.unresolved;
    }

    io.stderr.write(`Unknown command: ${command}\n`);
    return EXIT_CODES.usage;
  } catch (error) {
    const safetyBlocked =
      error instanceof SensitiveContentError ||
      error instanceof SafetyBlockedError;
    io.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        safetyBlocked,
      })}\n`,
    );
    return safetyBlocked ? EXIT_CODES.safetyBlocked : EXIT_CODES.usage;
  }
}
