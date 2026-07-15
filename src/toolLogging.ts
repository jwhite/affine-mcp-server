/**
 * Per-tool-call logging.
 *
 * Without this the server logs only HTTP transport lines ("Received POST request
 * to /mcp"), so a bad write is unattributable after the fact: you cannot tell which
 * tool ran, with what arguments, or what it warned about. That gap is what made a
 * mangled-markdown report (a whole document dumped verbatim into one block) take a
 * code read to diagnose rather than a log grep.
 *
 * Output is one line per call on stderr, alongside the existing `[affine-mcp]` logs.
 */

/** Keys whose values must never be logged, matched case-insensitively as substrings. */
const SENSITIVE_KEY_RE = /pass|token|secret|auth|cookie|credential|apikey|api_key/i;

/** Args long enough that only their size is interesting at basic level. */
const INLINE_VALUE_MAX = 40;
/** How much of a long string to show at verbose level. */
const VERBOSE_VALUE_MAX = 80;

export type ToolLogMode = "off" | "basic" | "verbose";

export function resolveToolLogMode(raw: string | undefined): ToolLogMode {
  const value = (raw ?? "basic").trim().toLowerCase();
  if (value === "off" || value === "false" || value === "0") return "off";
  if (value === "verbose") return "verbose";
  return "basic";
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function summarizeValue(key: string, value: unknown, mode: ToolLogMode): string | null {
  if (value === undefined || value === null) return null;
  if (SENSITIVE_KEY_RE.test(key)) return `${key}=<redacted>`;

  if (typeof value === "string") {
    // Length is the diagnostic signal for content params: a 10k-char `text` is the
    // tell that a whole document was passed to a single-block param.
    if (value.length <= INLINE_VALUE_MAX) return `${key}=${JSON.stringify(value)}`;
    if (mode === "verbose") {
      return `${key}(len=${value.length})=${JSON.stringify(oneLine(value.slice(0, VERBOSE_VALUE_MAX)) + "…")}`;
    }
    return `${key}(len=${value.length})`;
  }
  if (typeof value === "number" || typeof value === "boolean") return `${key}=${value}`;
  if (Array.isArray(value)) return `${key}[${value.length}]`;
  if (typeof value === "object") return `${key}{${Object.keys(value as object).length}}`;
  return null;
}

function summarizeArgs(args: unknown, mode: ToolLogMode): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const part = summarizeValue(key, value, mode);
    if (part) parts.push(part);
  }
  return parts.join(" ");
}

/**
 * Pull warnings out of a tool result. Handlers return MCP content whose text is the
 * JSON receipt; warnings there are the tool telling us it did something lossy or
 * surprising, which is exactly what is worth surfacing in a log.
 */
function extractWarnings(result: unknown): string[] {
  try {
    const text = (result as any)?.content?.[0]?.text;
    if (typeof text !== "string") return [];
    const parsed = JSON.parse(text);
    const warnings = parsed?.warnings ?? parsed?.data?.warnings;
    return Array.isArray(warnings) ? warnings.filter((w: unknown) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

/** Wrap a tool handler so each invocation logs name, args summary, outcome and warnings. */
export function withToolLogging<T extends (...args: any[]) => any>(
  name: string,
  handler: T,
  mode: ToolLogMode,
): T {
  if (mode === "off") return handler;

  return (async (...callArgs: any[]) => {
    const started = Date.now();
    const argSummary = summarizeArgs(callArgs[0], mode);
    try {
      const result = await handler(...callArgs);
      const warnings = extractWarnings(result);
      const parts = [`[affine-mcp] tool=${name}`, "ok", `${Date.now() - started}ms`];
      if (argSummary) parts.push(argSummary);
      if (warnings.length > 0) parts.push(`warn=${warnings.length} :: ${oneLine(warnings[0])}`);
      console.error(parts.join(" "));
      return result;
    } catch (err: any) {
      const parts = [`[affine-mcp] tool=${name}`, "ERROR", `${Date.now() - started}ms`];
      if (argSummary) parts.push(argSummary);
      parts.push(`:: ${oneLine(String(err?.message ?? err))}`);
      console.error(parts.join(" "));
      throw err;
    }
  }) as unknown as T;
}
