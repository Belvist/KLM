export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  dimensions(): number;
}

export class OpenAIEmbeddingService implements EmbeddingService {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY,
    private model = process.env.KLM_EMBEDDING_MODEL ?? "text-embedding-3-small"
  ) {}

  dimensions(): number {
    return 1536;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY required for semantic memory (embeddings)");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 8000),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const vector = data.data[0]?.embedding;
    if (!vector?.length) {
      throw new Error("Empty embedding response");
    }
    return vector;
  }
}
