import { z } from "zod";

// ── JSON Schema → Zod conversion ──────────────────────────────────────────────
// Converts MCP tool inputSchema (JSON Schema) to Zod schemas for LangChain tools.

export function truncateDescription(text: string | undefined, maxLength = 220): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function enumToSchema(values: unknown[]): z.ZodTypeAny | null {
  if (!values.length) return null;
  if (values.every((value) => typeof value === "string")) {
    const unique = [...new Set(values as string[])];
    if (!unique.length) return null;
    return unique.length === 1 ? z.literal(unique[0]) : z.enum(unique as [string, ...string[]]);
  }
  const literals = values
    .filter((value) => ["string", "number", "boolean"].includes(typeof value))
    .map((value) => z.literal(value as string | number | boolean));
  if (!literals.length) return null;
  if (literals.length === 1) return literals[0];
  if (literals.length === 2) return z.union([literals[0], literals[1]]);
  return z.union([literals[0], literals[1], ...literals.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function unionSchemas(parts: z.ZodTypeAny[]): z.ZodTypeAny {
  const unique = parts.filter(Boolean);
  if (!unique.length) return z.unknown();
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return z.union([unique[0], unique[1]]);
  return z.union([unique[0], unique[1], ...unique.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

export function schemaToZod(schemaLike: unknown, isRequired: boolean): z.ZodTypeAny {
  const schema = schemaLike && typeof schemaLike === "object" && !Array.isArray(schemaLike)
    ? schemaLike as Record<string, unknown>
    : {};
  const desc = truncateDescription(typeof schema.description === "string" ? schema.description : undefined, 180);

  let nullable = false;
  const variants = ["anyOf", "oneOf"]
    .flatMap((key) => Array.isArray(schema[key]) ? [schema[key] as unknown[]] : [])
    .flat();
  if (variants.length) {
    const variantSchemas = variants.flatMap((variant) => {
      const variantRecord = variant && typeof variant === "object" && !Array.isArray(variant)
        ? variant as Record<string, unknown>
        : null;
      const variantType = variantRecord?.type;
      if (variantType === "null") {
        nullable = true;
        return [];
      }
      return [schemaToZod(variant, true)];
    });
    let union = unionSchemas(variantSchemas);
    if (nullable) union = union.nullable();
    if (desc) union = union.describe(desc);
    if (!isRequired) union = union.optional();
    return union;
  }

  const enumSchema = Array.isArray(schema.enum) ? enumToSchema(schema.enum) : null;
  if (enumSchema) {
    let out = enumSchema;
    if (desc) out = out.describe(desc);
    if (!isRequired) out = out.optional();
    return out;
  }

  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType.map(String) : typeof rawType === "string" ? [rawType] : [];
  const nonNullTypes = types.filter((type) => type !== "null");
  if (types.includes("null")) nullable = true;

  let out: z.ZodTypeAny;
  if (nonNullTypes.length > 1) {
    out = unionSchemas(nonNullTypes.map((type) => schemaToZod({ ...schema, type }, true)));
  } else {
    const type = nonNullTypes[0];
    switch (type) {
      case "integer":
        out = z.number().int();
        break;
      case "number":
        out = z.number();
        break;
      case "boolean":
        out = z.boolean();
        break;
      case "array": {
        const itemSchema = schema.items ? schemaToZod(schema.items, true) : z.unknown();
        out = z.array(itemSchema);
        break;
      }
      case "object": {
        const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
          ? schema.properties as Record<string, Record<string, unknown>>
          : undefined;
        const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
        if (properties && Object.keys(properties).length) {
          const shape: Record<string, z.ZodTypeAny> = {};
          for (const [key, prop] of Object.entries(properties)) {
            shape[key] = jsonPropToZod(prop, required.includes(key));
          }
          let objectSchema = z.object(shape);
          if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
            objectSchema = objectSchema.catchall(schemaToZod(schema.additionalProperties, true));
          } else if (schema.additionalProperties !== true) {
            objectSchema = objectSchema.strict();
          }
          out = objectSchema;
        } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          out = z.record(z.string(), schemaToZod(schema.additionalProperties, true));
        } else {
          out = z.record(z.string(), z.unknown());
        }
        break;
      }
      case "string":
      default:
        out = z.string();
        break;
    }
  }

  if (nullable) out = out.nullable();
  if (desc) out = out.describe(desc);
  if (!isRequired) out = out.optional();
  return out;
}

export function jsonPropToZod(prop: Record<string, unknown>, isRequired: boolean): z.ZodTypeAny {
  return schemaToZod(prop, isRequired);
}

function rootSchemaHasExplicitProperties(inputSchema?: Record<string, unknown>): boolean {
  const properties = inputSchema?.properties;
  return Boolean(
    properties && typeof properties === "object" && !Array.isArray(properties) && Object.keys(properties).length > 0,
  );
}

export function requiresRootSchemaWrapper(inputSchema?: Record<string, unknown>): boolean {
  if (!inputSchema) return true;
  const rawType = inputSchema.type;
  const types = Array.isArray(rawType) ? rawType.map(String) : typeof rawType === "string" ? [rawType] : [];
  const nonNullTypes = types.filter((type) => type !== "null");
  if (nonNullTypes.length > 1) return true;
  const schemaType = nonNullTypes[0];
  if (!schemaType || schemaType === "object") {
    return !rootSchemaHasExplicitProperties(inputSchema);
  }
  return true;
}

function buildWrappedRootSchema(inputSchema?: Record<string, unknown>): z.ZodTypeAny {
  const desc = truncateDescription(
    typeof inputSchema?.description === "string" ? inputSchema.description : undefined,
    180,
  );
  const takesNoArgs =
    !inputSchema || (!rootSchemaHasExplicitProperties(inputSchema) && inputSchema.additionalProperties == null);
  const wrapped = takesNoArgs
    ? z.object({ __no_args: z.boolean().optional().describe("This tool takes no arguments. Leave unset.") })
    : z.object({ __raw_args_json: z.string().optional().describe("JSON object string containing the MCP tool arguments.") });
  return desc ? wrapped.describe(desc) : wrapped;
}

export function inputSchemaToZod(inputSchema?: Record<string, unknown>): z.ZodTypeAny {
  if (!inputSchema) {
    return z.object({ __no_args: z.boolean().optional().describe("This tool takes no arguments. Leave unset.") });
  }
  if (requiresRootSchemaWrapper(inputSchema)) {
    return buildWrappedRootSchema(inputSchema);
  }
  return schemaToZod(inputSchema, true);
}

export function normalizeToolArgsForCall(
  inputSchema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!requiresRootSchemaWrapper(inputSchema)) return args;
  const rawJson = typeof args.__raw_args_json === "string" ? args.__raw_args_json.trim() : "";
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return {};
}
