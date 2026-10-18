/**
 * DevPilot Embedding Service
 * Converts code chunks and user queries into high-dimensional vector embeddings.
 * Matches Pinecone index dimensions (3072 dimensions).
 */

export const EMBEDDING_DIMENSIONS = 3072;

/**
 * Computes cosine similarity between two equal-length vectors.
 * Returns a score between -1.0 and 1.0 (1.0 = identical direction).
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
export const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
        throw new Error(`Vectors must be non-empty and of identical length (${vecA?.length} vs ${vecB?.length})`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Deterministic offline embedding generator.
 * Produces unit-normalized vectors matching EMBEDDING_DIMENSIONS (3072).
 * Enables seamless local development, testing, and CI without third-party API dependencies.
 * @param {string} text
 * @param {number} [dimensions=3072]
 * @returns {number[]}
 */
export const generateOfflineEmbedding = (text, dimensions = EMBEDDING_DIMENSIONS) => {
    const vector = new Array(dimensions).fill(0);
    if (!text || typeof text !== "string") return vector;

    // Tokenize into lowercase words and code identifiers
    const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
    if (tokens.length === 0) return vector;

    for (const token of tokens) {
        // Deterministic polynomial rolling hash across dimensions
        let hash = 0;
        for (let i = 0; i < token.length; i++) {
            hash = (hash << 5) - hash + token.charCodeAt(i);
            hash |= 0;
        }
        const index = Math.abs(hash) % dimensions;
        vector[index] += 1;
    }

    // Normalize to unit vector (L2 norm)
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
        for (let i = 0; i < dimensions; i++) {
            vector[i] = vector[i] / norm;
        }
    }

    return vector;
};

/**
 * Generates vector embedding for a single string.
 * Uses OpenAI text-embedding-3-large (3072-dim) if OPENAI_API_KEY is present,
 * or falls back gracefully to offline deterministic embeddings.
 * @param {string} text
 * @returns {Promise<number[]>} 3072-dimensional float vector
 */
export const generateEmbedding = async (text) => {
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey && apiKey.trim().startsWith("sk-")) {
        try {
            const response = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey.trim()}`,
                },
                body: JSON.stringify({
                    model: "text-embedding-3-large",
                    dimensions: EMBEDDING_DIMENSIONS,
                    input: text,
                }),
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`OpenAI API error (${response.status}): ${errBody}`);
            }

            const data = await response.json();
            return data.data[0].embedding;
        } catch (err) {
            console.warn(`[Embedding] OpenAI API request failed, using offline fallback: ${err.message}`);
            return generateOfflineEmbedding(text);
        }
    }

    return generateOfflineEmbedding(text);
};

/**
 * Embeds an array of code chunks in batches to prevent rate-limiting and timeouts.
 * Attaches the computed vector to chunk.embedding.
 * @param {Array<object>} chunks - Array of chunk objects from chunker.service.js
 * @param {number} [batchSize=50] - Chunks per batch
 * @returns {Promise<Array<object>>} The same chunks with .embedding vectors attached
 */
export const embedChunksBatch = async (chunks, batchSize = 50) => {
    if (!chunks || chunks.length === 0) {
        return [];
    }

    const embeddedChunks = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);

        // Process batch items in parallel
        const batchResults = await Promise.all(
            batch.map(async (chunk) => {
                const vector = await generateEmbedding(chunk.content);
                return {
                    ...chunk,
                    embedding: vector,
                };
            })
        );

        embeddedChunks.push(...batchResults);
    }

    return embeddedChunks;
};

export default {
    EMBEDDING_DIMENSIONS,
    cosineSimilarity,
    generateOfflineEmbedding,
    generateEmbedding,
    embedChunksBatch,
};
