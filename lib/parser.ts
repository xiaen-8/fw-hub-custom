export interface WidgetMeta {
  id: string;
  title: string;
  description?: string;
  version?: string;
  author?: string;
  icon?: string;
  site?: string;
  requiredVersion?: string;
}

export function parseWidgetMetadata(content: string): WidgetMeta | null {
  if (content.startsWith("FWENC1")) return null;

  const startMatch = content.match(/(?:var|let|const)?\s*WidgetMetadata\s*=\s*\{/);
  if (!startMatch || startMatch.index === undefined) return null;

  const startIdx = content.indexOf("{", startMatch.index);
  let depth = 0;
  let endIdx = -1;

  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return null;

  const metaBlock = content.slice(startIdx, endIdx + 1);
  let objStr = metaBlock;
  objStr = objStr.replace(/\/\/.*$/gm, "");
  objStr = objStr.replace(/\/\*[\s\S]*?\*\//g, "");
  objStr = objStr.replace(/,\s*([}\]])/g, "$1");
  objStr = objStr.replace(/(?<=[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '"$1":');
  objStr = objStr.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // Replace bare identifiers (variable refs like `wv`) with null so JSON.parse succeeds
  objStr = objStr.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*([,}\]])/g, ': null$2');

  try {
    const parsed = JSON.parse(objStr);
    return {
      id: parsed.id || "",
      title: parsed.title || "",
      description: parsed.description,
      version: parsed.version,
      author: parsed.author,
      icon: parsed.icon,
      site: parsed.site,
      requiredVersion: parsed.requiredVersion,
    };
  } catch {
    return extractFieldsFallback(metaBlock);
  }
}

function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractFieldsFallback(content: string): WidgetMeta | null {
  const extract = (field: string): string | undefined => {
    const match = content.match(new RegExp(`${field}\\s*:\\s*["']([^"']+)["']`));
    return match?.[1] ? decodeUnicodeEscapes(match[1]) : undefined;
  };
  const id = extract("id");
  const title = extract("title");
  if (!id || !title) return null;
  return {
    id, title,
    description: extract("description"),
    version: extract("version"),
    author: extract("author"),
    icon: extract("icon"),
    site: extract("site"),
    requiredVersion: extract("requiredVersion"),
  };
}

export function isEncrypted(content: Buffer): boolean {
  return content.toString("utf8", 0, 6) === "FWENC1";
}
