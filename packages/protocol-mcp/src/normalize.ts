import {
  canonicalJson,
  type Direction,
  type JsonValue,
  type MinCaseEvent,
  parseJsonObject,
  sha256,
  summarizeValue,
} from "@reprocore/format";

export interface NormalizationState {
  protocolVersion?: string;
  readonly requests: Map<string, string>;
}

export interface NormalizeOptions {
  includeContent?: boolean;
  timestamp?: string;
}

export interface NormalizedFrame {
  event: MinCaseEvent;
  message: Record<string, unknown>;
}

export function createNormalizationState(): NormalizationState {
  return { requests: new Map<string, string>() };
}

function requestKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

function jsonRpcId(
  message: Record<string, unknown>,
): string | number | undefined {
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function findProtocolVersion(
  message: Record<string, unknown>,
): string | undefined {
  const direct = message.protocolVersion;
  if (typeof direct === "string") return direct;
  for (const containerName of ["params", "result"] as const) {
    const container = message[containerName];
    if (typeof container === "object" && container !== null) {
      const value = (container as Record<string, unknown>).protocolVersion;
      if (typeof value === "string") return value;
      const meta = (container as Record<string, unknown>)._meta;
      if (typeof meta === "object" && meta !== null) {
        const metaVersion = (meta as Record<string, unknown>).protocolVersion;
        if (typeof metaVersion === "string") return metaVersion;
      }
    }
  }
  return undefined;
}

function eventKind(
  message: Record<string, unknown>,
  id: string | number | undefined,
): string {
  if (typeof message.method === "string") {
    return id === undefined
      ? `notification:${message.method}`
      : `request:${message.method}`;
  }
  if ("error" in message) return "response:error";
  if ("result" in message) return "response:result";
  return "message:unknown";
}

function schemaHash(message: Record<string, unknown>): string | undefined {
  const serialized = JSON.stringify(message);
  if (!serialized.includes("Schema") && !serialized.includes("schema"))
    return undefined;
  return sha256(canonicalJson(message as JsonValue));
}

export function normalizeMcpFrame(
  frame: Uint8Array,
  direction: Direction,
  sequence: number,
  state: NormalizationState,
  options: NormalizeOptions = {},
): NormalizedFrame | undefined {
  const text = Buffer.from(frame).toString("utf8");
  const message = parseJsonObject(text);
  if (message === undefined || message.jsonrpc !== "2.0") return undefined;

  const version = findProtocolVersion(message);
  if (version !== undefined) state.protocolVersion = version;
  const id = jsonRpcId(message);
  const contentHash = sha256(frame);
  const eventId = `mcp-${sequence}-${contentHash.slice(7, 19)}`;
  const parentIds: string[] = [];

  if (id !== undefined) {
    const key = requestKey(id);
    if (typeof message.method === "string") state.requests.set(key, eventId);
    else {
      const requestEventId = state.requests.get(key);
      if (requestEventId !== undefined) parentIds.push(requestEventId);
    }
  }

  const event: MinCaseEvent = {
    eventId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    channel: "mcp",
    direction,
    kind: eventKind(message, id),
    parentIds,
    payloadRef: contentHash,
    sensitivity: options.includeContent === true ? "content" : "metadata",
    replayMode: "fixture",
    payload:
      options.includeContent === true ? message : summarizeValue(message),
  };
  if (id !== undefined) event.requestId = id;
  if (state.protocolVersion !== undefined)
    event.protocolVersion = state.protocolVersion;
  const detectedSchemaHash = schemaHash(message);
  if (detectedSchemaHash !== undefined) event.schemaRef = detectedSchemaHash;

  return { event, message };
}
