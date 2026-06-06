/**
 * LLM Service
 * 
 * Handles communication with LLM providers (OpenAI, Anthropic, DeepSeek, Ollama)
 * for wiki generation, code analysis, and chat.
 */

import type { AppSettings } from '../types'
import { configManager } from './config-manager'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export class LLMService {
  private settings: AppSettings

  constructor(settings: AppSettings) {
    this.settings = settings
  }

  updateSettings(settings: AppSettings) {
    this.settings = settings
  }

  /** Whether streaming responses are enabled in settings. */
  get streamEnabled(): boolean {
    return configManager.getConfig().llm.streamResponse
  }

  /** Tuning derived from the `llm` settings section. */
  private tuning() {
    const llm = configManager.getConfig().llm
    return {
      temperature: llm.temperature,
      maxTokens: llm.maxTokens,
      contextWindow: llm.contextWindow,
    }
  }

  /**
   * Trim conversation history so the prompt stays within the configured
   * context window (rough 4 chars/token heuristic). The system prompt and the
   * latest user message are always retained.
   */
  private fitContext(messages: LLMMessage[]): LLMMessage[] {
    const { contextWindow } = this.tuning()
    const budgetChars = Math.max(2000, contextWindow * 4)
    let total = messages.reduce((n, m) => n + m.content.length, 0)
    if (total <= budgetChars) return messages
    const result = [...messages]
    // Drop oldest non-system, non-last messages until within budget.
    let i = 0
    while (total > budgetChars && result.length > 2) {
      while (i < result.length && (result[i].role === 'system' || i === result.length - 1)) i++
      if (i >= result.length) break
      total -= result[i].content.length
      result.splice(i, 1)
    }
    return result
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.settings.apiKey) {
      return this.mockResponse(messages)
    }

    const provider = this.settings.llmProvider
    switch (provider) {
      case 'openai':
        return this.chatOpenAI(messages)
      case 'anthropic':
        return this.chatAnthropic(messages)
      case 'deepseek':
        return this.chatOpenAICompatible(messages, 'https://api.deepseek.com/v1')
      case 'ollama':
        return this.chatOpenAICompatible(messages, 'http://localhost:11434/v1')
      default:
        return this.chatOpenAI(messages)
    }
  }

  async *streamChat(messages: LLMMessage[]): AsyncGenerator<string> {
    if (!this.settings.apiKey) {
      const response = await this.mockResponse(messages)
      yield response.content
      return
    }

    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: this.fitContext(messages),
        stream: true,
        temperature: this.tuning().temperature,
        max_tokens: this.tuning().maxTokens,
      }),
    })

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const json = JSON.parse(data)
            const content = json.choices?.[0]?.delta?.content
            if (content) yield content
          } catch {
            // skip invalid JSON
          }
        }
      }
    }
  }

  private async chatOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    const baseUrl = this.settings.apiBaseUrl || 'https://api.openai.com/v1'
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: this.fitContext(messages),
        temperature: this.tuning().temperature,
        max_tokens: this.tuning().maxTokens,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
      },
    }
  }

  private async chatAnthropic(messages: LLMMessage[]): Promise<LLMResponse> {
    const systemMsg = messages.find(m => m.role === 'system')
    const nonSystemMsgs = messages.filter(m => m.role !== 'system')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.settings.model || 'claude-sonnet-4-20250514',
        system: systemMsg?.content || '',
        messages: this.fitContext(nonSystemMsgs).map(m => ({ role: m.role, content: m.content })),
        max_tokens: this.tuning().maxTokens,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return {
      content: data.content[0].text,
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
      },
    }
  }

  private async chatOpenAICompatible(messages: LLMMessage[], baseUrl: string): Promise<LLMResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: this.fitContext(messages),
        temperature: this.tuning().temperature,
        max_tokens: this.tuning().maxTokens,
      }),
    })

    if (!response.ok) throw new Error(`API error: ${response.status}`)

    const data = await response.json()
    return {
      content: data.choices[0].message.content,
    }
  }

  private getBaseUrl(): string {
    if (this.settings.apiBaseUrl) return this.settings.apiBaseUrl
    switch (this.settings.llmProvider) {
      case 'openai': return 'https://api.openai.com/v1'
      case 'deepseek': return 'https://api.deepseek.com/v1'
      case 'ollama': return 'http://localhost:11434/v1'
      default: return 'https://api.openai.com/v1'
    }
  }

  /**
   * Generate mock responses when no API key is configured
   */
  private async mockResponse(messages: LLMMessage[]): Promise<LLMResponse> {
    const lastMsg = messages[messages.length - 1]
    const isWikiGen = messages.some(m => m.content.includes('wiki') || m.content.includes('documentation'))

    if (isWikiGen) {
      return {
        content: this.generateMockWiki(lastMsg.content),
      }
    }

    return {
      content: `I can help you with that! However, no LLM API key is configured.\n\nPlease go to **Settings** and add your API key to enable:\n- Wiki generation\n- Code analysis\n- Semantic chat\n- Code agent\n\nSupported providers: OpenAI, Anthropic, DeepSeek, Ollama (local).`,
    }
  }

  private generateMockWiki(context: string): string {
    return `# Project Overview

> This wiki was generated in demo mode. Configure an LLM API key for full AI-powered analysis.

## Architecture

This project follows a modular architecture with clear separation of concerns.

\`\`\`mermaid
graph TD
    A[Entry Point] --> B[Core Module]
    B --> C[Services]
    B --> D[Components]
    C --> E[Data Layer]
    D --> F[UI Layer]
\`\`\`

## Key Components

The codebase contains the following key components identified through static analysis:

- **Source Files**: Code files organized by module
- **Configuration**: Project configuration and build setup
- **Dependencies**: External libraries and frameworks

## Getting Started

1. Clone the repository
2. Install dependencies
3. Run the development server

---

*Configure an LLM API key in Settings for detailed, AI-powered documentation.*`
  }
}
