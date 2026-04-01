/**
 * TentaCLAW Gateway — RAG Engine Tests
 *
 * Tests the in-memory vector store, text search, vector search,
 * hybrid search, ingestion, and store management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    addDocument,
    removeDocument,
    getDocument,
    listDocuments,
    getDocumentCount,
    textSearch,
    cosineSimilarity,
    simpleEmbed,
    vectorSearch,
    hybridSearch,
    ingestText,
    clearDocuments,
    getStoreStats,
} from '../src/experimental/rag';

// ---------------------------------------------------------------------------
// Reset store between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    clearDocuments();
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('Document CRUD', () => {
    it('addDocument creates a document with an id and timestamp', () => {
        const doc = addDocument('Hello world');
        expect(doc.id).toBeTruthy();
        expect(doc.content).toBe('Hello world');
        expect(doc.created_at).toBeTruthy();
        expect(doc.embedding).toBeDefined();
        expect(doc.embedding!.length).toBeGreaterThan(0);
    });

    it('addDocument stores metadata', () => {
        const doc = addDocument('test', { source: 'unit-test', version: '1' });
        expect(doc.metadata.source).toBe('unit-test');
        expect(doc.metadata.version).toBe('1');
    });

    it('getDocument retrieves a stored document', () => {
        const doc = addDocument('retrieve me');
        const fetched = getDocument(doc.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.content).toBe('retrieve me');
    });

    it('getDocument returns null for unknown id', () => {
        expect(getDocument('nonexistent')).toBeNull();
    });

    it('removeDocument deletes a document', () => {
        const doc = addDocument('to be removed');
        expect(removeDocument(doc.id)).toBe(true);
        expect(getDocument(doc.id)).toBeNull();
    });

    it('removeDocument returns false for unknown id', () => {
        expect(removeDocument('nonexistent')).toBe(false);
    });

    it('listDocuments returns all documents', () => {
        addDocument('one');
        addDocument('two');
        addDocument('three');
        expect(listDocuments()).toHaveLength(3);
    });

    it('listDocuments respects limit', () => {
        addDocument('one');
        addDocument('two');
        addDocument('three');
        expect(listDocuments(2)).toHaveLength(2);
    });

    it('getDocumentCount returns correct count', () => {
        expect(getDocumentCount()).toBe(0);
        addDocument('first');
        expect(getDocumentCount()).toBe(1);
        addDocument('second');
        expect(getDocumentCount()).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
        const v = [1, 2, 3];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it('returns 0 for zero-length vectors', () => {
        expect(cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for mismatched lengths', () => {
        expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('returns 0 for a zero vector', () => {
        expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it('handles negative components by clamping to 0', () => {
        // Opposite-direction vectors have negative cosine; we clamp to 0
        const score = cosineSimilarity([1, 0], [-1, 0]);
        expect(score).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Simple embedding
// ---------------------------------------------------------------------------

describe('simpleEmbed', () => {
    it('produces a fixed-length vector', () => {
        const emb = simpleEmbed('hello world');
        expect(emb.length).toBe(128);
    });

    it('produces an L2-normalised vector (norm ≈ 1)', () => {
        const emb = simpleEmbed('hello world');
        const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
        expect(norm).toBeCloseTo(1, 5);
    });

    it('produces similar embeddings for similar text', () => {
        const a = simpleEmbed('the quick brown fox');
        const b = simpleEmbed('the quick brown dog');
        const c = simpleEmbed('completely unrelated quantum physics');
        const simAB = cosineSimilarity(a, b);
        const simAC = cosineSimilarity(a, c);
        expect(simAB).toBeGreaterThan(simAC);
    });

    it('returns a zero vector for empty text', () => {
        const emb = simpleEmbed('');
        expect(emb.every((v) => v === 0)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Text search (TF-IDF)
// ---------------------------------------------------------------------------

describe('textSearch', () => {
    it('returns empty for empty store', () => {
        expect(textSearch('anything')).toEqual([]);
    });

    it('finds documents matching query terms', () => {
        addDocument('GPU inference is fast on NVIDIA hardware');
        addDocument('CPU workloads are slower for deep learning');
        addDocument('The weather is nice today');

        const results = textSearch('GPU inference');
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].document.content).toContain('GPU');
    });

    it('returns scores between 0 and 1', () => {
        addDocument('alpha beta gamma');
        addDocument('alpha delta epsilon');
        addDocument('zeta eta theta');

        const results = textSearch('alpha');
        for (const r of results) {
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(1);
        }
    });

    it('ranks more-relevant documents higher', () => {
        addDocument('machine learning and deep learning are subsets of AI');
        addDocument('learning to cook is fun');
        addDocument('machine learning models need GPUs');

        const results = textSearch('machine learning');
        // The first two results should both mention "machine" or "learning"
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    it('respects limit parameter', () => {
        for (let i = 0; i < 20; i++) {
            addDocument(`document number ${i} about testing`);
        }
        const results = textSearch('testing', 5);
        expect(results.length).toBeLessThanOrEqual(5);
    });

    it('returns empty for query with no matching terms', () => {
        addDocument('hello world');
        const results = textSearch('xyzzy');
        expect(results).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

describe('vectorSearch', () => {
    it('returns empty for empty store', () => {
        expect(vectorSearch('anything')).toEqual([]);
    });

    it('finds semantically similar documents', () => {
        addDocument('GPU computing accelerates neural network training');
        addDocument('The cat sat on the mat');
        addDocument('CUDA cores process parallel matrix operations');

        const results = vectorSearch('GPU parallel computing');
        expect(results.length).toBeGreaterThanOrEqual(1);
        // The GPU/CUDA docs should rank higher than the cat doc
        const topContent = results[0].document.content;
        expect(
            topContent.includes('GPU') || topContent.includes('CUDA'),
        ).toBe(true);
    });

    it('returns scores between 0 and 1', () => {
        addDocument('alpha beta gamma');
        addDocument('delta epsilon zeta');

        const results = vectorSearch('alpha');
        for (const r of results) {
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(1);
        }
    });

    it('respects limit parameter', () => {
        for (let i = 0; i < 20; i++) {
            addDocument(`document ${i}`);
        }
        const results = vectorSearch('document', 3);
        expect(results.length).toBeLessThanOrEqual(3);
    });
});

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

describe('hybridSearch', () => {
    it('returns empty for empty store', () => {
        expect(hybridSearch('anything')).toEqual([]);
    });

    it('combines text and vector results', () => {
        addDocument('TentaCLAW manages GPU clusters efficiently');
        addDocument('Kubernetes orchestrates container workloads');
        addDocument('The best pizza in town is at Joes');

        const results = hybridSearch('GPU cluster management');
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].document.content).toContain('TentaCLAW');
    });

    it('returns scores between 0 and 1', () => {
        addDocument('one');
        addDocument('two');

        const results = hybridSearch('one');
        for (const r of results) {
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(1);
        }
    });

    it('respects limit parameter', () => {
        for (let i = 0; i < 20; i++) {
            addDocument(`entry ${i} about searching`);
        }
        const results = hybridSearch('searching', 5);
        expect(results.length).toBeLessThanOrEqual(5);
    });
});

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

describe('ingestText', () => {
    it('splits text into chunks and stores them', () => {
        const text = 'A'.repeat(1200);
        const docs = ingestText(text, 500);
        expect(docs.length).toBeGreaterThan(1);
        expect(getDocumentCount()).toBe(docs.length);
    });

    it('each chunk has chunk_index and total_chunks metadata', () => {
        const text = 'word '.repeat(200); // ~1000 chars
        const docs = ingestText(text, 500);
        for (const doc of docs) {
            expect(doc.metadata.chunk_index).toBeDefined();
            expect(doc.metadata.total_chunks).toBeDefined();
        }
    });

    it('preserves custom metadata on each chunk', () => {
        const text = 'Hello world. '.repeat(100);
        const docs = ingestText(text, 500, { source: 'test-file' });
        for (const doc of docs) {
            expect(doc.metadata.source).toBe('test-file');
        }
    });

    it('handles short text as a single chunk', () => {
        const docs = ingestText('short text', 500);
        expect(docs).toHaveLength(1);
        expect(docs[0].content).toBe('short text');
    });

    it('chunks have overlap (no content gaps)', () => {
        const text = 'ABCDEFGHIJ'.repeat(100); // 1000 chars
        const docs = ingestText(text, 500);
        // With 20% overlap (100 chars), a 1000-char text at chunk_size 500
        // should produce: [0..500], [400..900], [800..1000] = 3 chunks
        expect(docs.length).toBeGreaterThanOrEqual(2);

        // Verify the full text is reconstructable (no gaps)
        // The end of chunk N should overlap with start of chunk N+1
        for (let i = 0; i < docs.length - 1; i++) {
            const overlapLen = Math.floor(500 * 0.2); // 100
            const endOfCurrent = docs[i].content.slice(-overlapLen);
            const startOfNext = docs[i + 1].content.slice(0, overlapLen);
            expect(endOfCurrent).toBe(startOfNext);
        }
    });
});

// ---------------------------------------------------------------------------
// Store management
// ---------------------------------------------------------------------------

describe('clearDocuments', () => {
    it('removes all documents', () => {
        addDocument('one');
        addDocument('two');
        expect(getDocumentCount()).toBe(2);
        clearDocuments();
        expect(getDocumentCount()).toBe(0);
        expect(listDocuments()).toHaveLength(0);
    });
});

describe('getStoreStats', () => {
    it('returns zeros for empty store', () => {
        const stats = getStoreStats();
        expect(stats.total_documents).toBe(0);
        expect(stats.total_chars).toBe(0);
        expect(stats.avg_doc_length).toBe(0);
    });

    it('computes correct stats', () => {
        addDocument('hello'); // 5 chars
        addDocument('world!'); // 6 chars
        const stats = getStoreStats();
        expect(stats.total_documents).toBe(2);
        expect(stats.total_chars).toBe(11);
        expect(stats.avg_doc_length).toBe(6); // Math.round(11/2) = 6
    });
});
