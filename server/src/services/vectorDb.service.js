import { Pinecone } from "@pinecone-database/pinecone";

let pineconeClient = null;

export const DEFAULT_INDEX_NAME = process.env.PINECONE_INDEX_NAME || "devpilot";
export const VECTOR_DIMENSIONS = 3072;
export const VECTOR_METRIC = "cosine";

/**
 * Singleton Pinecone Client connection
 * @returns {Pinecone}
 */
export const getPineconeClient = () => {
    if (!pineconeClient) {
        const apiKey = process.env.PINECONE_API_KEY;
        if (!apiKey) {
            throw new Error("PINECONE_API_KEY is not defined in environment variables");
        }
        pineconeClient = new Pinecone({ apiKey });
    }
    return pineconeClient;
};

/**
 * Returns Pinecone index handle, creating it if it doesn't already exist.
 * @param {string} [indexName=DEFAULT_INDEX_NAME]
 * @returns {Promise<import("@pinecone-database/pinecone").Index>}
 */
export const getPineconeIndex = async (indexName = DEFAULT_INDEX_NAME) => {
    const pc = getPineconeClient();

    try {
        const { indexes } = await pc.listIndexes();
        const exists = indexes?.some((idx) => idx.name === indexName);

        if (!exists) {
            console.log(`[Pinecone] Index '${indexName}' not found. Creating with ${VECTOR_DIMENSIONS} dims, ${VECTOR_METRIC}...`);
            await pc.createIndex({
                name: indexName,
                dimension: VECTOR_DIMENSIONS,
                metric: VECTOR_METRIC,
                spec: {
                    serverless: {
                        cloud: "aws",
                        region: "us-east-1",
                    },
                },
            });
            console.log(`[Pinecone] Index '${indexName}' created successfully.`);
        }
    } catch (err) {
        // If listIndexes fails or already exists, continue with index reference
        console.warn(`[Pinecone] Index check warning: ${err.message}`);
    }

    return pc.index(indexName);
};

/**
 * Generates standardized project namespace identifier.
 * Isolates vectors for each project so multi-tenant code bases never collide.
 * @param {string} projectId
 * @returns {string} Namespace string, e.g. "project-6ad0c1694e6528127f29ebf6"
 */
export const getProjectNamespace = (projectId) => {
    if (!projectId) {
        throw new Error("projectId is required for vector namespace isolation");
    }
    return `project-${projectId.toString()}`;
};

/**
 * Returns isolated namespace handle on the Pinecone index for a project.
 * @param {string} projectId
 * @param {string} [indexName=DEFAULT_INDEX_NAME]
 * @returns {Promise<any>}
 */
export const getProjectIndex = async (projectId, indexName = DEFAULT_INDEX_NAME) => {
    const index = await getPineconeIndex(indexName);
    const namespace = getProjectNamespace(projectId);
    return index.namespace(namespace);
};

/**
 * Upserts embedded code chunks into the project's isolated Pinecone namespace.
 * Automatically processes chunks in batches of 50.
 *
 * @param {string} projectId - Project identifier
 * @param {Array<object>} chunks - Array of chunk objects with .embedding
 * @param {number} [batchSize=50] - Vector batch size
 * @returns {Promise<{ success: boolean, count: number, namespace: string }>}
 */
export const upsertCodeChunks = async (projectId, chunks, batchSize = 50) => {
    if (!chunks || chunks.length === 0) {
        return { success: true, count: 0, namespace: getProjectNamespace(projectId) };
    }

    const projectIndex = await getProjectIndex(projectId);
    const validChunks = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);

    if (validChunks.length === 0) {
        throw new Error("No chunks with valid embedding vectors provided for upsert");
    }

    // Map chunks to Pinecone vector records
    const records = validChunks.map((chunk) => ({
        id: chunk.chunkId,
        values: chunk.embedding,
        metadata: {
            projectId: projectId.toString(),
            chunkId: chunk.chunkId,
            filePath: chunk.filePath,
            symbolName: chunk.symbolName || "",
            chunkType: chunk.chunkType,
            startLine: Number(chunk.startLine),
            endLine: Number(chunk.endLine),
            lineCount: Number(chunk.lineCount || 0),
            content: chunk.content,
        },
    }));

    // Batch upsert into Pinecone
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await projectIndex.upsert({ records: batch });
    }

    return {
        success: true,
        count: records.length,
        namespace: getProjectNamespace(projectId),
    };
};

/**
 * Wipes all vectors in a project's namespace.
 * Used when a repository is re-scanned to avoid stale vector pollution.
 * @param {string} projectId
 * @returns {Promise<{ success: boolean, projectId: string }>}
 */
export const deleteProjectVectors = async (projectId) => {
    try {
        const projectIndex = await getProjectIndex(projectId);
        await projectIndex.deleteAll();
        return { success: true, projectId: projectId.toString() };
    } catch (err) {
        // If namespace is already empty or doesn't exist, treat as success
        console.warn(`[Pinecone] Warning while deleting namespace for project ${projectId}: ${err.message}`);
        return { success: true, projectId: projectId.toString() };
    }
};

/**
 * Queries Pinecone for the top-K most semantically similar code chunks within a project.
 * @param {object} options
 * @param {string} options.projectId
 * @param {number[]} options.vector - Query embedding vector
 * @param {number} [options.topK=5]
 * @param {object} [options.filter] - Optional metadata filter
 * @returns {Promise<Array<object>>} Top matching chunk matches with similarity score and metadata
 */
export const queryProjectVectors = async ({
    projectId,
    vector,
    topK = 5,
    filter = undefined,
}) => {
    const projectIndex = await getProjectIndex(projectId);
    const queryOptions = {
        vector,
        topK,
        includeMetadata: true,
        includeValues: false,
    };

    if (filter) {
        queryOptions.filter = filter;
    }

    const queryResponse = await projectIndex.query(queryOptions);
    return queryResponse.matches || [];
};

export default {
    DEFAULT_INDEX_NAME,
    VECTOR_DIMENSIONS,
    VECTOR_METRIC,
    getPineconeClient,
    getPineconeIndex,
    getProjectNamespace,
    getProjectIndex,
    upsertCodeChunks,
    deleteProjectVectors,
    queryProjectVectors,
};
