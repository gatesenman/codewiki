import { useState, useRef, useEffect, memo } from 'react'
import { Send, Bot, User, Loader2, Trash2, Code } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuid } from 'uuid'
import { useAppStore } from '../store'
import { services } from '../services/service-registry'
import { t } from '../services/i18n'
import { MermaidDiagram } from './MermaidDiagram'
import type { ChatMessage, CodeSource } from '../types'

export function ChatPanel() {
  const currentProject = useAppStore(s => s.currentProject)
  const chatMessages = useAppStore(s => s.chatMessages)
  const addChatMessage = useAppStore(s => s.addChatMessage)
  const updateChatMessage = useAppStore(s => s.updateChatMessage)
  const clearChat = useAppStore(s => s.clearChat)
  const settings = useAppStore(s => s.settings)
  useAppStore(s => s.locale)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSend = async () => {
    if (!input.trim() || !currentProject || isTyping) return

    const userMessage: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }
    addChatMessage(userMessage)
    setInput('')
    setIsTyping(true)

    try {
      const llm = services.getLLMService(settings)
      const codeAgent = services.getCodeAgent(settings)

      // Find relevant context using ontology + vector search
      const readFile = (path: string) => window.electronAPI.readFile(path)
      const sources = await codeAgent.findContext(
        input.trim(),
        currentProject.ontologyGraph,
        readFile,
      )

      // Build context-rich prompt
      const contextStr = sources.slice(0, 5).map(s =>
        `### ${s.filePath} (lines ${s.startLine}-${s.endLine})\n\`\`\`\n${s.content}\n\`\`\``
      ).join('\n\n')

      const systemPrompt = `You are a code assistant for the project "${currentProject.name}". Answer questions about the codebase accurately and concisely. Reference specific files and line numbers when relevant. Use markdown formatting.

Project has ${currentProject.ontologyGraph.entities.length} code entities and ${currentProject.ontologyGraph.relations.length} relations.

Relevant code context:
${contextStr}`

      const promptMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...chatMessages.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: input.trim() },
      ]

      if (llm.streamEnabled) {
        // Stream tokens into a placeholder assistant message.
        const assistantMessage: ChatMessage = {
          id: uuid(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          sources: sources.slice(0, 3),
        }
        addChatMessage(assistantMessage)
        let acc = ''
        for await (const chunk of llm.streamChat(promptMessages)) {
          acc += chunk
          updateChatMessage(assistantMessage.id, acc)
        }
      } else {
        const response = await llm.chat(promptMessages)
        const assistantMessage: ChatMessage = {
          id: uuid(),
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          sources: sources.slice(0, 3),
        }
        addChatMessage(assistantMessage)
      }
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: `${t('error')}: ${err instanceof Error ? err.message : t('chatErrorFallback')}. ${t('chatErrorSuffix')}`,
        timestamp: Date.now(),
      }
      addChatMessage(errorMessage)
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-wiki-border bg-wiki-sidebar flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-wiki-accent" />
          <h2 className="text-sm font-semibold">{t('chatHeaderTitle')}</h2>
        </div>
        {chatMessages.length > 0 && (
          <button
            onClick={clearChat}
            className="p-1.5 rounded hover:bg-wiki-card text-wiki-muted hover:text-wiki-text"
            title={t('chatClear')}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {chatMessages.length === 0 && (
          <div className="text-center py-12 text-wiki-muted">
            <Bot size={40} className="mx-auto mb-3 text-wiki-muted/30" />
            <h3 className="text-sm font-medium mb-2">{t('chatEmptyTitle')}</h3>
            <p className="text-xs text-wiki-muted/60 max-w-sm mx-auto">
              {t('chatEmptyDesc')}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                t('chatSuggestion1'),
                t('chatSuggestion2'),
                t('chatSuggestion3'),
                t('chatSuggestion4'),
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-3 py-1.5 rounded-lg border border-wiki-border text-xs text-wiki-muted hover:text-wiki-text hover:border-wiki-accent/30 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map(msg => (
          <MemoMessageBubble key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-wiki-accent/10">
              <Bot size={16} className="text-wiki-accent" />
            </div>
            <div className="flex items-center gap-2 text-sm text-wiki-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('chatThinking')}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-3 border-t border-wiki-border bg-wiki-sidebar">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={t('chatPlaceholder')}
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent resize-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="p-2.5 rounded-lg bg-wiki-accent text-white hover:bg-wiki-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

const MemoMessageBubble = memo(MessageBubble)

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`p-1.5 rounded-lg ${isUser ? 'bg-wiki-purple/10' : 'bg-wiki-accent/10'}`}>
        {isUser ? <User size={16} className="text-wiki-purple" /> : <Bot size={16} className="text-wiki-accent" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block px-4 py-2.5 rounded-lg text-sm ${
          isUser
            ? 'bg-wiki-purple/10 border border-wiki-purple/20 text-wiki-text'
            : 'bg-wiki-card border border-wiki-border text-wiki-text'
        }`}>
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <div className="wiki-content prose-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children }) {
                    const match = /language-(\w+)/.exec(className || '')
                    if (match?.[1] === 'mermaid') {
                      return <MermaidDiagram chart={String(children)} />
                    }
                    return <code className={className}>{children}</code>
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Source references */}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.sources.map((source, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wiki-card/50 border border-wiki-border text-[10px] text-wiki-muted"
                title={`${source.filePath}:${source.startLine}-${source.endLine}`}
              >
                <Code size={10} />
                {source.filePath.split('/').pop()}:{source.startLine}
              </div>
            ))}
          </div>
        )}

        <div className="mt-1 text-[10px] text-wiki-muted/40">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}
