import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  captureProcess,
  SensitiveContentError,
} from "@reprocore/capture-stdio";
import {
  readMinCaseManifest,
  sha256,
  validateMinCaseDirectory,
  type JsonValue,
} from "@reprocore/format";
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
  type OracleDocument,
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
  evaluateFixtureWithDocker,
  readReplayFixture,
  ReplayFixtureSchema,
  runDoctor,
  runFixtureReplay,
  type ReplayFixture,
  verifyBaseline,
  verifyDockerBaseline,
  type DockerOracleOptions,
  UnsafeDockerImageError,
} from "@reprocore/replay";
import {
  CliInputError,
  EXIT_CODES,
  SafetyBlockedError,
  VerificationError,
  VERSION,
} from "./index.js";
import {
  assertSafeMinCaseContent,
  createMinCase,
  verifyMinCase,
} from "./case.js";
import { minimizeFixtureJson } from "./minimize-fixture.js";
import { parse } from "yaml";

const HELP = `ReproCore ${VERSION}

Usage:
  reprocore doctor [--json]
  reprocore capture --out <directory> [--include-content] [--json] -- <server> [args...]
  reprocore oracle init --out <oracle.yaml> [--name <name>] [--json]
  reprocore replay --fixture <fixture.json> --oracle <oracle.yaml> [--repeat <count>] [--docker-image <name@sha256:digest>] [--timeout-ms <milliseconds>] [--json]
  reprocore minimize --fixture <fixture.json> --oracle <oracle.yaml> --out <fixture.json> [--docker-image <name@sha256:digest>] [--timeout-ms <milliseconds>] [--json]
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
  --json             Emit a JSON command summary (capture uses stderr)
  --confirm-export   Confirm creation of a portable, redacted export
  --docker-image     Digest-pinned image for a custom_script Oracle
  --timeout-ms       Per-container timeout for Docker Oracle evaluation
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

interface ParsedCommandOptions {
  flags: ReadonlySet<string>;
  positionals: readonly string[];
  values: ReadonlyMap<string, string>;
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

function parseCommandOptions(
  command: string,
  args: readonly string[],
  valueOptions: readonly string[],
  flagOptions: readonly string[],
  positionalCount = 0,
): ParsedCommandOptions {
  const allowedValues = new Set(valueOptions);
  const allowedFlags = new Set(flagOptions);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (allowedValues.has(option)) {
      if (values.has(option)) {
        throw new CliInputError(`${command} option ${option} was repeated`);
      }
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new CliInputError(`${command} option ${option} requires a value`);
      }
      values.set(option, value);
      index += 1;
      continue;
    }
    if (allowedFlags.has(option)) {
      if (flags.has(option)) {
        throw new CliInputError(`${command} option ${option} was repeated`);
      }
      flags.add(option);
      continue;
    }
    if (option.startsWith("-")) {
      throw new CliInputError(`Unknown ${command} option: ${option}`);
    }
    positionals.push(option);
  }

  if (positionals.length > positionalCount) {
    throw new CliInputError(
      `${command} received an unexpected argument: ${positionals[positionalCount]}`,
    );
  }
  return { flags, positionals, values };
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function dockerOptionsForOracle(
  command: string,
  options: ParsedCommandOptions,
  oracle: OracleDocument,
): DockerOracleOptions | undefined {
  const usesCustomScript = oracle.rules.some(
    (rule) => rule.kind === "custom_script",
  );
  const image = options.values.get("--docker-image");
  const timeoutText = options.values.get("--timeout-ms");
  if (!usesCustomScript) {
    if (image !== undefined || timeoutText !== undefined) {
      throw new CliInputError(
        `${command} Docker options require a custom_script Oracle rule`,
      );
    }
    return undefined;
  }
  if (image === undefined) {
    throw new SafetyBlockedError(
      `${command} requires --docker-image <name@sha256:digest> for a custom_script Oracle`,
    );
  }
  const timeoutMs =
    timeoutText === undefined
      ? oracle.timeoutMs
      : Number.parseInt(timeoutText, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new CliInputError("--timeout-ms must be a positive integer");
  }
  return { image, timeoutMs };
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
    throw new CliInputError("capture requires `-- <server> [args...]`");
  }
  const options = parseCommandOptions(
    "capture",
    args.slice(0, separator),
    ["--out"],
    ["--include-content", "--json"],
  );
  const server = args.slice(separator + 1);
  const outputDirectory = options.values.get("--out");
  if (outputDirectory === undefined)
    throw new CliInputError("capture requires --out <directory>");
  const command = server[0];
  if (command === undefined)
    throw new CliInputError("capture server command is missing");
  return {
    command,
    commandArguments: server.slice(1),
    includeContent: options.flags.has("--include-content"),
    json: options.flags.has("--json"),
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
      const commandOptions = parseCommandOptions(
        "doctor",
        args.slice(1),
        [],
        ["--json"],
      );
      const report = await runDoctor();
      writeResult(
        io,
        commandOptions.flags.has("--json"),
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
      const exitCode =
        result.exitCode === 0
          ? EXIT_CODES.success
          : EXIT_CODES.executionFailure;
      if (parsed.json) {
        io.stderr.write(
          `${JSON.stringify({
            command: "capture",
            output: parsed.outputDirectory,
            serverExitCode: result.exitCode,
            signal: result.signal,
            exitCode,
          })}\n`,
        );
      }
      return exitCode;
    }

    if (command === "oracle" && args[1] === "init") {
      const commandArgs = parseCommandOptions(
        "oracle init",
        args.slice(2),
        ["--out", "--name"],
        ["--json"],
      );
      const outputPath = commandArgs.values.get("--out");
      if (outputPath === undefined)
        throw new CliInputError("oracle init requires --out <oracle.yaml>");
      const name = commandArgs.values.get("--name") ?? "reprocore-failure";
      const resolvedPath = resolve(outputPath);
      writeOracleDocument(resolvedPath, createOracleTemplate(name));
      writeResult(
        io,
        commandArgs.flags.has("--json"),
        { command: "oracle init", output: resolvedPath },
        `Created ${resolvedPath}`,
      );
      return EXIT_CODES.success;
    }

    if (command === "replay") {
      const commandArgs = parseCommandOptions(
        "replay",
        args.slice(1),
        ["--fixture", "--oracle", "--repeat", "--docker-image", "--timeout-ms"],
        ["--json"],
      );
      const fixturePath = commandArgs.values.get("--fixture");
      const oraclePath = commandArgs.values.get("--oracle");
      if (fixturePath === undefined || oraclePath === undefined) {
        throw new CliInputError(
          "replay requires --fixture <fixture.json> and --oracle <oracle.yaml>",
        );
      }
      const repeatText = commandArgs.values.get("--repeat");
      const oracle = readOracleDocument(resolve(oraclePath));
      const fixture = readReplayFixture(resolve(fixturePath));
      const dockerOptions = dockerOptionsForOracle(
        "replay",
        commandArgs,
        oracle,
      );
      const repeat =
        repeatText === undefined
          ? oracle.repeat
          : Number.parseInt(repeatText, 10);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new CliInputError(
          "--repeat must be an integer between 1 and 100",
        );
      }
      const baseline =
        dockerOptions === undefined
          ? verifyBaseline(fixture, oracle, repeat)
          : await verifyDockerBaseline(fixture, oracle, dockerOptions, repeat);
      writeResult(
        io,
        commandArgs.flags.has("--json"),
        baseline,
        `${baseline.status}: ${baseline.evaluations.length}/${repeat} checks completed`,
      );
      return baseline.status === "STABLE"
        ? EXIT_CODES.success
        : EXIT_CODES.flakyUnsupported;
    }

    if (command === "minimize") {
      const commandArgs = parseCommandOptions(
        "minimize",
        args.slice(1),
        [
          "--fixture",
          "--oracle",
          "--out",
          "--proof",
          "--cache",
          "--budget-tests",
          "--budget-ms",
          "--docker-image",
          "--timeout-ms",
        ],
        ["--json"],
      );
      const fixturePath = commandArgs.values.get("--fixture");
      const oraclePath = commandArgs.values.get("--oracle");
      const outputPath = commandArgs.values.get("--out");
      if (
        fixturePath === undefined ||
        oraclePath === undefined ||
        outputPath === undefined
      ) {
        throw new CliInputError(
          "minimize requires --fixture <fixture.json>, --oracle <oracle.yaml>, and --out <fixture.json>",
        );
      }
      const maxTestsText = commandArgs.values.get("--budget-tests");
      const maxDurationText = commandArgs.values.get("--budget-ms");
      const maxTests =
        maxTestsText === undefined ? 10_000 : Number.parseInt(maxTestsText, 10);
      const maxDurationMs =
        maxDurationText === undefined
          ? 10 * 60 * 1_000
          : Number.parseInt(maxDurationText, 10);
      if (!Number.isInteger(maxTests) || maxTests < 1) {
        throw new CliInputError("--budget-tests must be a positive integer");
      }
      if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1) {
        throw new CliInputError("--budget-ms must be a positive integer");
      }
      const fixture = readReplayFixture(resolve(fixturePath));
      const oracle = readOracleDocument(resolve(oraclePath));
      const dockerOptions = dockerOptionsForOracle(
        "minimize",
        commandArgs,
        oracle,
      );
      const evaluateCandidate =
        dockerOptions === undefined
          ? async (candidate: ReplayFixture) =>
              evaluateOracle(oracle, runFixtureReplay(candidate).observation)
                .result
          : async (candidate: ReplayFixture) =>
              (
                await evaluateFixtureWithDocker(
                  candidate,
                  oracle,
                  dockerOptions,
                )
              ).evaluation.result;
      const evaluationIdentity =
        dockerOptions === undefined
          ? "fixed-response-v1"
          : JSON.stringify({
              backend: "docker-v1",
              image: dockerOptions.image,
              timeoutMs: dockerOptions.timeoutMs,
            });
      const baseline =
        dockerOptions === undefined
          ? verifyBaseline(fixture, oracle, 3)
          : await verifyDockerBaseline(fixture, oracle, dockerOptions, 3);
      if (baseline.status !== "STABLE") return EXIT_CODES.flakyUnsupported;

      const transactions: FixtureTransaction[] = fixture.exchanges.map(
        (exchange, index) => ({
          transactionId: `exchange-${index}`,
          exchange,
        }),
      );
      using cache = new CandidateCache(
        resolve(
          commandArgs.values.get("--cache") ?? ".reprocore/candidates.sqlite",
        ),
      );
      const minimizationStarted = Date.now();
      const result = await minimizeTransactions(transactions, {
        dependencyGraph: fixtureDependencyGraph(fixture, transactions),
        maxTests,
        maxDurationMs,
        cache,
        cacheNamespace: sha256(
          JSON.stringify({
            fixture,
            oracle,
            stage: "transactions-v1",
            evaluationIdentity,
          }),
        ),
        validate: (candidate) => candidate.length > 0,
        test: async (candidate) => {
          const candidateFixture: ReplayFixture = {
            ...fixture,
            exchanges: candidate.map((transaction) => transaction.exchange),
          };
          return evaluateCandidate(candidateFixture);
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
        evaluate: evaluateCandidate,
        evaluationIdentity,
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
        commandArgs.values.get("--proof") ?? `${outputPath}.proof.json`,
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
        commandArgs.flags.has("--json"),
        summary,
        `${minimality}: ${result.originalCount} -> ${result.finalCount} transactions`,
      );
      return minimality === "oneMinimal"
        ? EXIT_CODES.success
        : EXIT_CODES.unresolved;
    }

    if (command === "pack") {
      const commandArgs = parseCommandOptions(
        "pack",
        args.slice(1),
        ["--fixture", "--oracle", "--proof", "--out", "--name", "--case-dir"],
        ["--confirm-export", "--json"],
      );
      const fixturePath = commandArgs.values.get("--fixture");
      const oraclePath = commandArgs.values.get("--oracle");
      const proofPath = commandArgs.values.get("--proof");
      const outputPath = commandArgs.values.get("--out");
      if (
        fixturePath === undefined ||
        oraclePath === undefined ||
        proofPath === undefined ||
        outputPath === undefined
      ) {
        throw new CliInputError(
          "pack requires --fixture, --oracle, --proof, and --out <name.mincase.zip>",
        );
      }
      if (!outputPath.endsWith(".mincase.zip")) {
        throw new CliInputError("pack output must end with .mincase.zip");
      }
      if (!commandArgs.flags.has("--confirm-export")) {
        throw new SafetyBlockedError(
          "pack requires --confirm-export after reviewing the redaction boundary",
        );
      }
      const inferredName = basename(outputPath, ".mincase.zip");
      const name = commandArgs.values.get("--name") ?? inferredName;
      const resolvedOutput = resolve(outputPath);
      const caseDirectory = resolve(
        commandArgs.values.get("--case-dir") ??
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
        commandArgs.flags.has("--json"),
        created,
        `Created ${created.outputZip}`,
      );
      return created.manifest.caseType === "executable"
        ? EXIT_CODES.success
        : EXIT_CODES.unresolved;
    }

    if (command === "report") {
      const commandArgs = parseCommandOptions(
        "report",
        args.slice(1),
        ["--case", "--out"],
        ["--json"],
      );
      const casePath = commandArgs.values.get("--case");
      if (casePath === undefined)
        throw new CliInputError("report requires --case <name.mincase>");
      const caseDirectory = resolve(casePath);
      validateMinCaseDirectory(caseDirectory);
      assertSafeMinCaseContent(caseDirectory);
      const outputPath = resolve(
        commandArgs.values.get("--out") ?? join(caseDirectory, "report.html"),
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
        commandArgs.flags.has("--json"),
        { command: "report", output: outputPath },
        `Created ${outputPath}`,
      );
      return EXIT_CODES.success;
    }

    if (command === "redact" && args[1] === "--check") {
      const commandArgs = parseCommandOptions(
        "redact --check",
        args.slice(2),
        [],
        ["--json"],
        1,
      );
      const target = commandArgs.positionals[0];
      if (target === undefined)
        throw new CliInputError("redact --check requires <path>");
      const findings = scanPath(resolve(target));
      const summary = {
        checked: resolve(target),
        findingCount: findings.length,
        blockingCount: findings.filter((finding) => finding.blocking).length,
        findings,
      };
      writeResult(
        io,
        commandArgs.flags.has("--json"),
        summary,
        `${summary.blockingCount === 0 ? "PASSED" : "BLOCKED"}: ${summary.findingCount} finding(s)`,
      );
      return summary.blockingCount === 0
        ? EXIT_CODES.success
        : EXIT_CODES.safetyBlocked;
    }

    if (command === "verify") {
      const commandArgs = parseCommandOptions(
        "verify",
        args.slice(1),
        ["--case", "--repeat"],
        ["--json"],
      );
      const caseDirectory = commandArgs.values.get("--case");
      if (caseDirectory === undefined)
        throw new CliInputError("verify requires --case <name.mincase>");
      const repeatText = commandArgs.values.get("--repeat");
      const repeat =
        repeatText === undefined ? 5 : Number.parseInt(repeatText, 10);
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new CliInputError(
          "--repeat must be an integer between 1 and 100",
        );
      }
      const verification = verifyMinCase(resolve(caseDirectory), repeat);
      writeResult(
        io,
        commandArgs.flags.has("--json"),
        verification,
        `${verification.valid ? "VERIFIED" : "FAILED"}: ${verification.passed}/${repeat}`,
      );
      return verification.valid ? EXIT_CODES.success : EXIT_CODES.unresolved;
    }

    io.stderr.write(
      args.includes("--json")
        ? `${JSON.stringify({ error: `Unknown command: ${command}`, exitCode: EXIT_CODES.usage })}\n`
        : `Unknown command: ${command}\n`,
    );
    return EXIT_CODES.usage;
  } catch (error) {
    const safetyBlocked =
      error instanceof SensitiveContentError ||
      error instanceof SafetyBlockedError ||
      error instanceof UnsafeDockerImageError;
    const inputError =
      error instanceof CliInputError ||
      error instanceof SyntaxError ||
      (error instanceof Error &&
        (error.name === "ZodError" ||
          error.name === "YAMLParseError" ||
          error.name === "InvalidMinCaseDirectoryError"));
    const exitCode = safetyBlocked
      ? EXIT_CODES.safetyBlocked
      : error instanceof VerificationError
        ? EXIT_CODES.unresolved
        : inputError
          ? EXIT_CODES.usage
          : EXIT_CODES.executionFailure;
    io.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        safetyBlocked,
        exitCode,
      })}\n`,
    );
    return exitCode;
  }
}
