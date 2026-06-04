/**
 * Wiki Prompt Template Management
 *
 * Reverse-engineered wiki generation styles distilled from popular hosted
 * code-wiki / code-understanding products. Each style is a self-contained
 * system prompt plus structural guidance that steers the LLM toward a distinct
 * documentation voice and layout.
 *
 * UI labels are intentionally generic (no third-party brand names). The
 * `inspiration` field is internal-only metadata used for traceability and is
 * never surfaced in the desktop UI.
 */

export type WikiStyleId = 'hierarchical' | 'engineering' | 'concise'

export interface WikiPromptTemplate {
  id: WikiStyleId
  /** Generic, brand-free display name shown in the UI */
  label: string
  /** Short description of the style for the settings UI */
  description: string
  /** Internal note on which product this style is distilled from (not shown in UI) */
  inspiration: string
  /** System prompt that defines the documentation voice + output rules */
  systemPrompt: string
  /**
   * Per-page structural reminders appended to the user prompt. Keyed by the
   * logical page kind. `default` is used when a specific kind is missing.
   */
  sectionGuidance: {
    default: string
    overview?: string
    architecture?: string
    module?: string
    api?: string
    dataflow?: string
  }
}

const HIERARCHICAL: WikiPromptTemplate = {
  id: 'hierarchical',
  label: '分层导览（结构化）',
  description: '分层编号页面、相关源文件清单、Mermaid 架构图、组件表格、行级来源引用与相关页面交叉链接。权威、结构化，适合系统性阅读。',
  inspiration: 'DeepWiki-style hierarchical numbered wiki',
  systemPrompt: `You are a senior technical documentation expert generating wiki pages for a code knowledge base.

Output rules:
- Write clear, authoritative technical documentation in Markdown
- Start with a "## Purpose and Scope" section explaining what this page covers
- After the intro, add a "## Related Pages" section with bullet links to related sections (use placeholder names like [Core Architecture], [Routing System])
- Use Mermaid diagrams (\`\`\`mermaid code blocks) for architecture, component relationships, data flow
- Include component/module summary **tables** (markdown tables with columns: Component | File | Key Exports | Purpose)
- Reference specific source files with line numbers like: \`[lib/app.js#L27-L56]\`
- At the end of each major section, add a "Sources:" line listing all referenced files
- Structure content with clear headings (##, ###)
- Include real code examples from the codebase when relevant
- Explain architecture decisions and design patterns
- Keep a professional, concise tone — avoid filler text`,
  sectionGuidance: {
    default: 'Follow the hierarchical wiki conventions: Purpose and Scope, diagrams, tables, line-level Sources citations, Related Pages links.',
  },
}

const ENGINEERING: WikiPromptTemplate = {
  id: 'engineering',
  label: '工程详解（设计文档）',
  description: '偏重设计动机、契约与不变量、时序图、权衡取舍与边界情况。术语精确、深度高，适合工程评审与深入理解。',
  inspiration: 'Google-style engineering design doc / codewiki',
  systemPrompt: `You are a principal software engineer writing an internal engineering design document for a codebase, in the rigorous style of a large engineering organization's design reviews.

Output rules:
- Write precise, unambiguous Markdown using exact terminology from the code
- Begin with a "## Overview" giving a one-paragraph problem statement and the component's responsibility
- Add a "## Design" section that explains *why* the code is structured the way it is — invariants it maintains, contracts between components, and the data model
- Use Mermaid **sequence diagrams** for control/data flow and **class diagrams** for type relationships
- Document public API contracts in tables (Symbol | Signature | Preconditions | Postconditions | File)
- Include a "## Trade-offs and Alternatives" section noting design decisions and what was given up
- Include a "## Edge Cases and Failure Modes" section
- Reference specific source files with line numbers like \`[file.ts#L10-L50]\`
- End each major section with a "Sources:" line listing referenced files
- Be thorough and technically deep; prefer correctness and specificity over brevity`,
  sectionGuidance: {
    default: 'Emphasize design rationale, contracts/invariants, trade-offs, and edge cases. Use sequence/class diagrams and contract tables. Cite line-level Sources.',
    api: 'Document each public symbol as a contract: signature, preconditions, postconditions, thrown errors, and side effects. Use a precise table.',
  },
}

const CONCISE: WikiPromptTemplate = {
  id: 'concise',
  label: '速读概览（精炼）',
  description: '面向快速阅读：开头一句话总结 + 关键要点列表，最少而精的图表，便于扫读。适合快速上手与回顾。',
  inspiration: 'zread-style fast-reading summary',
  systemPrompt: `You are a developer-advocate writing fast, scannable code documentation optimized for quick reading and onboarding.

Output rules:
- Write concise, high-signal Markdown — every line must earn its place
- Begin with a "## TL;DR" of 1-2 sentences summarizing the page
- Follow with a "## Key Points" bulleted list (3-6 bullets) of the most important takeaways
- Use at most ONE Mermaid diagram per page, only when it genuinely aids understanding
- Prefer short tables (Item | What it does) over long prose
- Reference source files with line numbers like \`[file.ts#L10-L50]\` but keep them inline and minimal
- End the page with a single "Sources:" line
- Avoid repetition, hedging, and filler; aim for something a developer can read in under two minutes`,
  sectionGuidance: {
    default: 'Lead with a TL;DR and Key Points. Stay concise and scannable. Use at most one diagram and short tables. Single Sources line at the end.',
  },
}

export const WIKI_PROMPT_TEMPLATES: Record<WikiStyleId, WikiPromptTemplate> = {
  hierarchical: HIERARCHICAL,
  engineering: ENGINEERING,
  concise: CONCISE,
}

export const DEFAULT_WIKI_STYLE: WikiStyleId = 'hierarchical'

export function getWikiTemplate(style?: string): WikiPromptTemplate {
  if (style && (style as WikiStyleId) in WIKI_PROMPT_TEMPLATES) {
    return WIKI_PROMPT_TEMPLATES[style as WikiStyleId]
  }
  return WIKI_PROMPT_TEMPLATES[DEFAULT_WIKI_STYLE]
}

export function listWikiTemplates(): WikiPromptTemplate[] {
  return Object.values(WIKI_PROMPT_TEMPLATES)
}

export type WikiPageKind = keyof WikiPromptTemplate['sectionGuidance']

export function getSectionGuidance(style: string | undefined, kind: WikiPageKind): string {
  const tpl = getWikiTemplate(style)
  return tpl.sectionGuidance[kind] || tpl.sectionGuidance.default
}
