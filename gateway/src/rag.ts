// F:\tentaclaw-os\gateway\src\rag.ts
// RAG Engine for TentaCLAW — cluster-local knowledge retrieval
// CLAWtopus says: "I remember everything. Eight arms, infinite memory."

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Document {
    id: string;
    content: string;
    metadata: Record<string, string>;
    embedding?: number[];
    created_at: string;
}

export interface SearchResult {
    document: Document;
    score: number; // cosine similarity 0–1
}

// ---------------------------------------------------------------------------
// In-memory document store
// ---------------------------------------------------------------------------

const documents = new Map<string, Document>();

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/** Add a document to the store. */
export function addDocument(
    content: string,
    metadata: Record<string, string> = {},
): Document {
    const doc: Document = {
        id: randomUUID(),
        content,
        metadata,
        embedding: simpleEmbed(content),
        created_at: new Date().toISOString(),
    };
    documents.set(doc.id, doc);
    return doc;
}

/** Remove a document by ID. Returns true if something was deleted. */
export function removeDocument(id: string): boolean {
    return documents.delete(id);
}

/** Get a single document by ID, or null if not found. */
export function getDocument(id: string): Document | null {
    return documents.get(id) ?? null;
}

/** List documents in insertion order, optionally capped by `limit`. */
export function listDocuments(limit?: number): Document[] {
    const all = Array.from(documents.values());
    if (limit !== undefined && limit < all.length) {
        return all.slice(0, limit);
    }
    return all;
}

/** Return the number of documents currently stored. */
export function getDocumentCount(): number {
    return documents.size;
}

// ---------------------------------------------------------------------------
// Tokenisation helpers (shared by TF-IDF and embedding)
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, split on whitespace. */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// TF-IDF text search
// ---------------------------------------------------------------------------

/**
 * Simple TF-IDF text search — no embeddings needed.
 *
 * Term Frequency  = occurrences of term in doc / total terms in doc
 * Inverse Doc Freq = log(total docs / docs containing term)
 * Score per doc    = sum of TF * IDF for each query term, normalised to 0–1.
 */
export function textSearch(query: string, limit = 10): SearchResult[] {
    if (documents.size === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const totalDocs = documents.size;

    // Pre-compute document-frequency for each query token
    const df = new Map<string, number>();
    for (const token of queryTokens) {
        if (df.has(token)) continue;
        let count = 0;
        for (const doc of documents.values()) {
            if (tokenize(doc.content).includes(token)) count++;
        }
        df.set(token, count);
    }

    const scored: SearchResult[] = [];

    for (const doc of documents.values()) {
        const docTokens = tokenize(doc.content);
        if (docTokens.length === 0) continue;

        let score = 0;
        for (const token of queryTokens) {
            const tf = docTokens.filter((t) => t === token).length / docTokens.length;
            const docFreq = df.get(token) ?? 0;
            const idf = docFreq > 0 ? Math.log(totalDocs / docFreq) : 0;
            score += tf * idf;
        }

        if (score > 0) {
            scored.push({ document: doc, score });
        }
    }

    // Normalise scores to 0–1 range
    const maxScore = scored.reduce((m, r) => Math.max(m, r.score), 0);
    if (maxScore > 0) {
        for (const r of scored) {
            r.score = r.score / maxScore;
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

/** Cosine similarity between two equal-length vectors. Returns 0–1. */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    // Clamp to [0,1] — negative similarity treated as 0 for ranking purposes
    return Math.max(0, dot / denom);
}

// ---------------------------------------------------------------------------
// Simple bag-of-words embedding (no external model needed)
// ---------------------------------------------------------------------------

const EMBED_DIM = 128;

/**
 * Hash a word to a fixed-dimension vector bucket and accumulate counts.
 * This gives a deterministic, dependency-free "embedding" that captures
 * word co-occurrence at a coarse level.
 */
export function simpleEmbed(text: string): number[] {
    const vec = new Array<number>(EMBED_DIM).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
        // Simple FNV-1a–inspired hash to distribute tokens across buckets
        let hash = 2166136261;
        for (let i = 0; i < token.length; i++) {
            hash ^= token.charCodeAt(i);
            hash = (hash * 16777619) >>> 0; // keep 32-bit unsigned
        }
        const idx = hash % EMBED_DIM;
        vec[idx] += 1;
    }

    // L2-normalise so cosine similarity works correctly
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
        for (let i = 0; i < vec.length; i++) {
            vec[i] /= norm;
        }
    }

    return vec;
}

// ---------------------------------------------------------------------------
// Vector similarity search
// ---------------------------------------------------------------------------

/** Search documents by vector similarity using simple bag-of-words embeddings. */
export function vectorSearch(query: string, limit = 10): SearchResult[] {
    if (documents.size === 0) return [];

    const queryEmb = simpleEmbed(query);
    const scored: SearchResult[] = [];

    for (const doc of documents.values()) {
        const docEmb = doc.embedding ?? simpleEmbed(doc.content);
        const score = cosineSimilarity(queryEmb, docEmb);
        if (score > 0) {
            scored.push({ document: doc, score });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Hybrid search — combines text + vector scores
// ---------------------------------------------------------------------------

/**
 * Hybrid search merges text-search (TF-IDF) and vector-search scores.
 * Final score = 0.5 * textScore + 0.5 * vectorScore (when both present).
 */
export function hybridSearch(query: string, limit = 10): SearchResult[] {
    const textResults = textSearch(query, documents.size);
    const vectorResults = vectorSearch(query, documents.size);

    // Merge by document ID
    const merged = new Map<string, { document: Document; textScore: number; vectorScore: number }>();

    for (const r of textResults) {
        merged.set(r.document.id, {
            document: r.document,
            textScore: r.score,
            vectorScore: 0,
        });
    }

    for (const r of vectorResults) {
        const existing = merged.get(r.document.id);
        if (existing) {
            existing.vectorScore = r.score;
        } else {
            merged.set(r.document.id, {
                document: r.document,
                textScore: 0,
                vectorScore: r.score,
            });
        }
    }

    const results: SearchResult[] = Array.from(merged.values()).map((m) => ({
        document: m.document,
        score: 0.5 * m.textScore + 0.5 * m.vectorScore,
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Text ingestion — chunk + store
// ---------------------------------------------------------------------------

/**
 * Ingest a body of text by splitting it into overlapping chunks and storing
 * each chunk as a separate document.
 *
 * @param text      - The raw text to ingest.
 * @param chunkSize - Target chunk size in characters (default 500).
 * @param metadata  - Optional metadata applied to every chunk.
 * @returns The array of created Document objects.
 */
export function ingestText(
    text: string,
    chunkSize = 500,
    metadata: Record<string, string> = {},
): Document[] {
    const overlap = Math.floor(chunkSize * 0.2); // 20% overlap
    const chunks: string[] = [];

    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end));
        start += chunkSize - overlap;
    }

    return chunks.map((chunk, idx) =>
        addDocument(chunk, {
            ...metadata,
            chunk_index: String(idx),
            total_chunks: String(chunks.length),
        }),
    );
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/** Clear all documents from the store. */
export function clearDocuments(): void {
    documents.clear();
}

/** Get aggregate statistics about the document store. */
export function getStoreStats(): {
    total_documents: number;
    total_chars: number;
    avg_doc_length: number;
} {
    const docs = Array.from(documents.values());
    const totalChars = docs.reduce((sum, d) => sum + d.content.length, 0);
    return {
        total_documents: docs.length,
        total_chars: totalChars,
        avg_doc_length: docs.length > 0 ? Math.round(totalChars / docs.length) : 0,
    };
}
