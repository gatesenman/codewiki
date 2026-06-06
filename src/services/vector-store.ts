/**
 * Local Vector Store for Semantic Search
 *
 * Lightweight in-memory vector store using TF-IDF-like scoring for semantic
 * search without requiring external services. It is local-first: with no
 * embedding provider configured it behaves exactly as a TF-IDF cosine index.
 *
 * When an (optional) embedding provider is configured, the store can also run
 * dense vector search and fuse it with the keyword ranking via Reciprocal Rank
 * Fusion (RRF) for higher-quality "hybrid" retrieval — see `searchHybrid`.
 */

export interface VectorDocument {
  id: string
  content: string
  metadata: Record<string, string>
}

/**
 * Pluggable embedding backend. Implementations turn text into dense vectors.
 * Kept minimal so callers can supply OpenAI-compatible, Ollama, or any custom
 * provider — or none at all (TF-IDF-only, fully offline).
 */
export interface EmbeddingProvider {
  /** Embed a batch of texts; returns one vector per input, in order. */
  embed(texts: string[]): Promise<number[][]>
}

export interface SearchResult {
  id: string
  score: number
  content: string
  metadata: Record<string, string>
}

export interface HybridSearchOptions {
  /** RRF constant; larger = flatter weighting. Default 60. */
  rrfK?: number
  /** Candidate pool size pulled from each ranker before fusion. */
  candidatePool?: number
}

interface IndexedDocument {
  id: string
  content: string
  metadata: Record<string, string>
  tokens: Map<string, number> // term -> tf-idf score
  embedding?: number[]
  norm: number
}

export const VECTOR_SNAPSHOT_VERSION = 1

/** A document as persisted to disk (no derived TF-IDF state). */
export interface PersistedDocument {
  id: string
  content: string
  metadata: Record<string, string>
  embedding?: number[]
}

export interface VectorStoreSnapshot {
  version: number
  documents: PersistedDocument[]
}

export class VectorStore {
  private documents: Map<string, IndexedDocument> = new Map()
  private idf: Map<string, number> = new Map()
  private totalDocs = 0
  private embeddingProvider?: EmbeddingProvider
  private defaultRrfK = 60

  /**
   * Configure (or clear) the optional embedding provider used by
   * `embedDocuments` / `searchHybrid`. Pass `undefined` to revert to
   * TF-IDF-only behaviour.
   */
  setEmbeddingProvider(provider?: EmbeddingProvider): void {
    this.embeddingProvider = provider
  }

  /** Set the default RRF constant used by `searchHybrid` (config-driven). */
  setRrfK(k: number): void {
    if (Number.isFinite(k) && k > 0) this.defaultRrfK = k
  }

  hasEmbeddings(): boolean {
    for (const doc of this.documents.values()) {
      if (doc.embedding) return true
    }
    return false
  }

  async addDocument(doc: VectorDocument): Promise<void> {
    const tokens = this.tokenize(doc.content)
    const tf = this.computeTF(tokens)

    // Preserve a previously-computed embedding when re-adding the same id so an
    // unchanged document does not need to be re-embedded.
    const existing = this.documents.get(doc.id)
    this.documents.set(doc.id, {
      ...doc,
      tokens: tf,
      embedding: existing?.embedding,
      norm: 0,
    })
    this.totalDocs = this.documents.size
  }

  /** Remove a document by id. Returns true if it existed. */
  removeDocument(id: string): boolean {
    const existed = this.documents.delete(id)
    this.totalDocs = this.documents.size
    return existed
  }

  hasDocument(id: string): boolean {
    return this.documents.has(id)
  }

  /**
   * Export documents (content, metadata, cached embeddings) for persistence.
   * Derived data (tokens/idf/norm) is intentionally omitted and recomputed on
   * import via `rebuildIndex`, keeping snapshots compact.
   */
  export(): VectorStoreSnapshot {
    const documents: PersistedDocument[] = []
    for (const doc of this.documents.values()) {
      documents.push({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        embedding: doc.embedding,
      })
    }
    return { version: VECTOR_SNAPSHOT_VERSION, documents }
  }

  /** Restore documents from a snapshot, replacing current contents. */
  async import(snapshot: VectorStoreSnapshot): Promise<void> {
    this.clear()
    for (const d of snapshot.documents) {
      await this.addDocument({ id: d.id, content: d.content, metadata: d.metadata })
      if (d.embedding) {
        const doc = this.documents.get(d.id)
        if (doc) doc.embedding = d.embedding
      }
    }
    this.rebuildIndex()
  }

  /**
   * Rebuild IDF scores after all documents are added
   */
  rebuildIndex(): void {
    // Compute document frequency
    const df = new Map<string, number>()
    for (const doc of this.documents.values()) {
      for (const term of doc.tokens.keys()) {
        df.set(term, (df.get(term) || 0) + 1)
      }
    }

    // Compute IDF
    this.idf.clear()
    for (const [term, freq] of df) {
      this.idf.set(term, Math.log(this.totalDocs / (freq + 1)) + 1)
    }

    // Update TF-IDF scores and norms
    for (const doc of this.documents.values()) {
      let normSq = 0
      for (const [term, tf] of doc.tokens) {
        const tfidf = tf * (this.idf.get(term) || 1)
        doc.tokens.set(term, tfidf)
        normSq += tfidf * tfidf
      }
      doc.norm = Math.sqrt(normSq)
    }
  }

  /**
   * Search for similar documents using cosine similarity
   */
  search(query: string, topK: number = 10): SearchResult[] {
    if (this.documents.size === 0) return []

    // Rebuild index if needed
    if (this.idf.size === 0) this.rebuildIndex()

    const queryTokens = this.tokenize(query)
    const queryTF = this.computeTF(queryTokens)
    const queryVec = new Map<string, number>()
    let queryNormSq = 0

    for (const [term, tf] of queryTF) {
      const tfidf = tf * (this.idf.get(term) || 1)
      queryVec.set(term, tfidf)
      queryNormSq += tfidf * tfidf
    }
    const queryNorm = Math.sqrt(queryNormSq)

    if (queryNorm === 0) return []

    // Compute cosine similarity with all documents
    const scores: SearchResult[] = []

    for (const doc of this.documents.values()) {
      if (doc.norm === 0) continue

      let dotProduct = 0
      for (const [term, score] of queryVec) {
        const docScore = doc.tokens.get(term) || 0
        dotProduct += score * docScore
      }

      const similarity = dotProduct / (queryNorm * doc.norm)
      if (similarity > 0.01) {
        scores.push({
          id: doc.id,
          score: similarity,
          content: doc.content.substring(0, 500),
          metadata: doc.metadata,
        })
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  /**
   * Compute and cache embeddings for every document missing one, using the
   * configured provider. No-op when no provider is set. Safe to call after
   * (re)indexing; subsequent calls only embed new documents.
   */
  async embedDocuments(batchSize: number = 64): Promise<number> {
    if (!this.embeddingProvider) return 0
    const pending = Array.from(this.documents.values()).filter(d => !d.embedding)
    let embedded = 0
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize)
      const vectors = await this.embeddingProvider.embed(batch.map(d => d.content))
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j]
        if (vec && vec.length) {
          batch[j].embedding = vec
          embedded++
        }
      }
    }
    return embedded
  }

  /**
   * Dense vector search over documents that have embeddings. Returns ranked
   * results by cosine similarity. Empty when no provider/embeddings exist.
   */
  async semanticSearch(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (!this.embeddingProvider || !this.hasEmbeddings()) return []
    const [queryVec] = await this.embeddingProvider.embed([query])
    if (!queryVec || !queryVec.length) return []
    const queryNorm = denseNorm(queryVec)
    if (queryNorm === 0) return []

    const scores: SearchResult[] = []
    for (const doc of this.documents.values()) {
      if (!doc.embedding) continue
      const sim = cosineDense(queryVec, doc.embedding, queryNorm)
      if (sim > 0) {
        scores.push({
          id: doc.id,
          score: sim,
          content: doc.content.substring(0, 500),
          metadata: doc.metadata,
        })
      }
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  /**
   * Hybrid retrieval: fuse the TF-IDF keyword ranking with the dense semantic
   * ranking via Reciprocal Rank Fusion. Falls back to pure keyword search when
   * no embedding provider/embeddings are available, so callers can always use
   * this method regardless of configuration.
   */
  async searchHybrid(
    query: string,
    topK: number = 10,
    options: HybridSearchOptions = {},
  ): Promise<SearchResult[]> {
    const rrfK = options.rrfK ?? this.defaultRrfK
    const pool = options.candidatePool ?? Math.max(topK * 4, 20)

    const keyword = this.search(query, pool)
    if (!this.embeddingProvider || !this.hasEmbeddings()) {
      return keyword.slice(0, topK)
    }
    const semantic = await this.semanticSearch(query, pool)
    if (semantic.length === 0) return keyword.slice(0, topK)

    return fuseRrf([keyword, semantic], rrfK, this.documents, topK)
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && t.length < 50)
      // Split camelCase and snake_case
      .flatMap(t => {
        const parts = t
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/_/g, ' ')
          .split(/\s+/)
        return [t, ...parts.filter(p => p.length > 1)]
      })
  }

  private computeTF(tokens: string[]): Map<string, number> {
    const freq = new Map<string, number>()
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1)
    }
    // Normalize by max frequency
    const maxFreq = Math.max(...freq.values(), 1)
    const tf = new Map<string, number>()
    for (const [term, count] of freq) {
      tf.set(term, 0.5 + 0.5 * (count / maxFreq))
    }
    return tf
  }

  getDocumentCount(): number {
    return this.documents.size
  }

  clear(): void {
    this.documents.clear()
    this.idf.clear()
    this.totalDocs = 0
  }
}

function denseNorm(v: number[]): number {
  let s = 0
  for (const x of v) s += x * x
  return Math.sqrt(s)
}

/** Cosine similarity; `aNorm` may be precomputed for the query side. */
function cosineDense(a: number[], b: number[], aNorm?: number): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let bNormSq = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    bNormSq += b[i] * b[i]
  }
  const denom = (aNorm ?? denseNorm(a)) * Math.sqrt(bNormSq)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Reciprocal Rank Fusion across multiple ranked result lists.
 * score(d) = Σ 1 / (k + rank_i(d)). Rank-based, so it is robust to the
 * different score scales of TF-IDF vs cosine embeddings.
 */
function fuseRrf(
  rankings: SearchResult[][],
  k: number,
  documents: Map<string, IndexedDocument>,
  topK: number,
): SearchResult[] {
  const fused = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((res, idx) => {
      const rank = idx + 1
      fused.set(res.id, (fused.get(res.id) || 0) + 1 / (k + rank))
    })
  }
  return Array.from(fused.entries())
    .map(([id, score]) => {
      const doc = documents.get(id)
      return {
        id,
        score,
        content: doc ? doc.content.substring(0, 500) : '',
        metadata: doc ? doc.metadata : {},
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * OpenAI-compatible embedding provider (works with OpenAI and any service
 * exposing a `/embeddings` endpoint with the same schema). Optional — only
 * used when the app is configured with an API key.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string
  private model: string
  private baseURL: string

  constructor(opts: { apiKey: string; model?: string; baseURL?: string }) {
    this.apiKey = opts.apiKey
    this.model = opts.model || 'text-embedding-3-small'
    this.baseURL = (opts.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '')
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    })
    if (!res.ok) {
      throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`)
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> }
    return json.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
  }
}

/**
 * Ollama embedding provider for fully-offline local embeddings (e.g.
 * `nomic-embed-text`). Ollama embeds one prompt per request, so a batch is
 * issued as sequential requests.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private model: string
  private baseURL: string

  constructor(opts: { model?: string; baseURL?: string } = {}) {
    this.model = opts.model || 'nomic-embed-text'
    this.baseURL = (opts.baseURL || 'http://localhost:11434').replace(/\/$/, '')
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (const text of texts) {
      const res = await fetch(`${this.baseURL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      })
      if (!res.ok) {
        throw new Error(`Ollama embedding failed: ${res.status} ${await res.text()}`)
      }
      const json = (await res.json()) as { embedding: number[] }
      out.push(json.embedding || [])
    }
    return out
  }
}
