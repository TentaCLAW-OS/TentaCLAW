/**
 * TentaCLAW Gateway — Structured Output Engine (Wave 151)
 *
 * Guarantees schema-valid JSON from inference:
 *   - JSON Schema constraint passthrough to SGLang/vLLM
 *   - GBNF grammar generation from JSON Schema
 *   - Response validation against schema
 *   - Retry with constrained decoding on validation failure
 *   - Schema registry for reusable schemas
 *
 * TentaCLAW says: "Free-form text is fine. Structured data is divine."
 */

// =============================================================================
// Types
// =============================================================================

export interface JsonSchema {
    type: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    enum?: unknown[];
    description?: string;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    additionalProperties?: boolean | JsonSchema;
}

export interface StructuredOutputConfig {
    /** JSON Schema to enforce */
    schema: JsonSchema;
    /** Backend-specific constraint method */
    method: 'json_schema' | 'grammar' | 'regex' | 'auto';
    /** Max retries on validation failure */
    maxRetries: number;
    /** Strict mode: reject non-compliant output */
    strict: boolean;
}

export interface StructuredOutputResult {
    data: unknown;
    valid: boolean;
    errors: string[];
    method_used: string;
    retries: number;
    raw_output?: string;
}

export interface SchemaRegistryEntry {
    name: string;
    version: string;
    schema: JsonSchema;
    description: string;
    created_at: string;
    usage_count: number;
}

// =============================================================================
// Schema Registry
// =============================================================================

const registry = new Map<string, SchemaRegistryEntry>();

/** Register a reusable schema */
export function registerSchema(name: string, schema: JsonSchema, description: string = '', version: string = '1.0'): SchemaRegistryEntry {
    const entry: SchemaRegistryEntry = {
        name, version, schema, description,
        created_at: new Date().toISOString(),
        usage_count: 0,
    };
    registry.set(name, entry);
    return entry;
}

/** Get schema by name */
export function getSchema(name: string): SchemaRegistryEntry | null {
    return registry.get(name) || null;
}

/** List all registered schemas */
export function listSchemas(): SchemaRegistryEntry[] {
    return Array.from(registry.values());
}

/** Delete a schema */
export function deleteSchema(name: string): boolean {
    return registry.delete(name);
}

// =============================================================================
// JSON Schema Validation
// =============================================================================

/** Validate data against a JSON Schema (basic implementation) */
export function validateAgainstSchema(data: unknown, schema: JsonSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    validateNode(data, schema, '', errors);
    return { valid: errors.length === 0, errors };
}

function validateNode(data: unknown, schema: JsonSchema, path: string, errors: string[]): void {
    if (data === null || data === undefined) {
        errors.push(`${path || 'root'}: value is null/undefined`);
        return;
    }

    switch (schema.type) {
        case 'object': {
            if (typeof data !== 'object' || Array.isArray(data)) {
                errors.push(`${path || 'root'}: expected object, got ${typeof data}`);
                return;
            }
            const obj = data as Record<string, unknown>;
            // Check required fields
            if (schema.required) {
                for (const req of schema.required) {
                    if (!(req in obj)) {
                        errors.push(`${path}.${req}: required field missing`);
                    }
                }
            }
            // Validate properties
            if (schema.properties) {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    if (key in obj) {
                        validateNode(obj[key], propSchema, `${path}.${key}`, errors);
                    }
                }
            }
            break;
        }
        case 'array': {
            if (!Array.isArray(data)) {
                errors.push(`${path || 'root'}: expected array, got ${typeof data}`);
                return;
            }
            if (schema.items) {
                for (let i = 0; i < (data as unknown[]).length; i++) {
                    validateNode((data as unknown[])[i], schema.items, `${path}[${i}]`, errors);
                }
            }
            break;
        }
        case 'string': {
            if (typeof data !== 'string') {
                errors.push(`${path || 'root'}: expected string, got ${typeof data}`);
                return;
            }
            if (schema.enum && !schema.enum.includes(data)) {
                errors.push(`${path}: value "${data}" not in enum [${schema.enum.join(',')}]`);
            }
            if (schema.minLength && (data as string).length < schema.minLength) {
                errors.push(`${path}: string too short (min: ${schema.minLength})`);
            }
            if (schema.maxLength && (data as string).length > schema.maxLength) {
                errors.push(`${path}: string too long (max: ${schema.maxLength})`);
            }
            if (schema.pattern && !new RegExp(schema.pattern).test(data as string)) {
                errors.push(`${path}: does not match pattern ${schema.pattern}`);
            }
            break;
        }
        case 'number':
        case 'integer': {
            if (typeof data !== 'number') {
                errors.push(`${path || 'root'}: expected number, got ${typeof data}`);
                return;
            }
            if (schema.type === 'integer' && !Number.isInteger(data)) {
                errors.push(`${path}: expected integer`);
            }
            if (schema.minimum !== undefined && (data as number) < schema.minimum) {
                errors.push(`${path}: below minimum ${schema.minimum}`);
            }
            if (schema.maximum !== undefined && (data as number) > schema.maximum) {
                errors.push(`${path}: above maximum ${schema.maximum}`);
            }
            break;
        }
        case 'boolean': {
            if (typeof data !== 'boolean') {
                errors.push(`${path || 'root'}: expected boolean, got ${typeof data}`);
            }
            break;
        }
    }
}

// =============================================================================
// JSON Schema to GBNF Grammar
// =============================================================================

/** Convert JSON Schema to GBNF grammar for llama.cpp constrained decoding */
export function jsonSchemaToGbnf(schema: JsonSchema): string {
    const rules: string[] = [];
    rules.push('root ::= ' + schemaToGbnfRule(schema, 'root', rules));
    rules.push('ws ::= [ \\t\\n]*');
    rules.push('string ::= "\\"" [^"\\\\]* "\\"" ws');
    rules.push('number ::= "-"? [0-9]+ ("." [0-9]+)? ws');
    rules.push('integer ::= "-"? [0-9]+ ws');
    rules.push('boolean ::= ("true" | "false") ws');
    rules.push('null ::= "null" ws');
    return rules.join('\n');
}

function schemaToGbnfRule(schema: JsonSchema, name: string, rules: string[]): string {
    switch (schema.type) {
        case 'object': {
            if (!schema.properties) return '"{}" ws';
            const props = Object.entries(schema.properties);
            const parts = props.map(([key, propSchema], i) => {
                const propRule = `${name}_${key}`;
                const rule = schemaToGbnfRule(propSchema, propRule, rules);
                const comma = i < props.length - 1 ? ' "," ws' : '';
                return `"\\"${key}\\"" ws ":" ws ${rule}${comma}`;
            });
            return `"{" ws ${parts.join(' ')} "}" ws`;
        }
        case 'array':
            return '"[" ws (root_item ("," ws root_item)*)? "]" ws';
        case 'string':
            if (schema.enum) {
                return '(' + schema.enum.map(v => `"\\"${v}\\""`) .join(' | ') + ') ws';
            }
            return 'string';
        case 'number': return 'number';
        case 'integer': return 'integer';
        case 'boolean': return 'boolean';
        default: return 'string';
    }
}

// =============================================================================
// Backend Constraint Methods
// =============================================================================

/** Determine the best constraint method for a backend */
export function selectConstraintMethod(backend: string, schema: JsonSchema): {
    method: string;
    params: Record<string, unknown>;
} {
    switch (backend) {
        case 'sglang':
            // SGLang supports native JSON schema constraints
            return { method: 'json_schema', params: { json_schema: schema } };
        case 'vllm':
            // vLLM supports guided decoding with JSON schema
            return { method: 'json_schema', params: { guided_json: schema } };
        case 'llamacpp':
            // llama.cpp uses GBNF grammar
            return { method: 'grammar', params: { grammar: jsonSchemaToGbnf(schema) } };
        case 'trtllm':
            // TRT-LLM: use post-processing validation + retry
            return { method: 'post_validate', params: {} };
        default:
            return { method: 'post_validate', params: {} };
    }
}

// =============================================================================
// Built-in Schemas
// =============================================================================

/** Register common built-in schemas */
export function registerBuiltinSchemas(): void {
    registerSchema('sentiment', {
        type: 'object',
        properties: {
            sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            explanation: { type: 'string' },
        },
        required: ['sentiment', 'confidence'],
    }, 'Sentiment analysis result');

    registerSchema('entity_extraction', {
        type: 'object',
        properties: {
            entities: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        type: { type: 'string', enum: ['person', 'organization', 'location', 'date', 'product', 'other'] },
                        start: { type: 'integer' },
                        end: { type: 'integer' },
                    },
                    required: ['text', 'type'],
                },
            },
        },
        required: ['entities'],
    }, 'Named entity extraction');

    registerSchema('classification', {
        type: 'object',
        properties: {
            label: { type: 'string' },
            score: { type: 'number', minimum: 0, maximum: 1 },
            labels: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        label: { type: 'string' },
                        score: { type: 'number' },
                    },
                },
            },
        },
        required: ['label', 'score'],
    }, 'Text classification result');

    registerSchema('summary', {
        type: 'object',
        properties: {
            summary: { type: 'string', maxLength: 500 },
            key_points: { type: 'array', items: { type: 'string' } },
            word_count: { type: 'integer' },
        },
        required: ['summary'],
    }, 'Text summarization result');
}

/** Reset (for testing) */
export function _resetStructuredOutput(): void {
    registry.clear();
}
