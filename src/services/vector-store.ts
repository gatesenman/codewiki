/**
 * Local Vector Store for Semantic Search
 * 
 * Lightweight in-memory vector store using TF-IDF-like scoring
 * for semantic search without requiring external services.
 * When an LLM API key is available, it can use OpenAI embeddings
 * for higher quality results.
 */

export interface VectorDocument {
  id: string
  content: string
  metadata: Record<string, string>
}

interface IndexedDocument {
  id: string
  content: string
  metadata: Record<string, string>
  tokens: Map<string, number> // term -> tf-idf score
  embedding?: number[]
  norm: number
}

export class VectorStore {
  private documents: Map<string, IndexedDocument> = new Map()
  private idf: Map<string, number> = new Map()
  private totalDocs = 0

  async addDocument(doc: VectorDocument): Promise<void> {
    const tokens = this.tokenize(doc.content)
    const tf = this.computeTF(tokens)

    this.documents.set(doc.id, {
      ...doc,
      tokens: tf,
      norm: 0,
    })
    this.totalDocs++
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
  search(query: string, topK: number = 10): Array<{ id: string; score: number; content: string; metadata: Record<string, string> }> {
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
    const scores: Array<{ id: string; score: number; content: string; metadata: Record<string, string> }> = []

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
