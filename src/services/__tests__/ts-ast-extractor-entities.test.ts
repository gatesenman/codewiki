import { describe, it, expect } from 'vitest'
import { extractTsAst } from '../ts-ast-extractor'

describe('ts-ast-extractor new entity types', () => {
  it('extracts Constructor from class', () => {
    const code = `
class Foo {
  constructor(private name: string) {}
}
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const ctors = result.entities.filter(e => e.type === 'Constructor')
    expect(ctors.length).toBe(1)
    expect(ctors[0].name).toBe('constructor')
    expect(ctors[0].parentName).toBe('Foo')
  })

  it('extracts Property from class', () => {
    const code = `
class Foo {
  name: string = ''
  age: number = 0
}
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const props = result.entities.filter(e => e.type === 'Property')
    expect(props.length).toBe(2)
    expect(props.map(p => p.name).sort()).toEqual(['age', 'name'])
  })

  it('extracts Constant (readonly) from class as Constant', () => {
    const code = `
class Config {
  readonly MAX_SIZE = 100
  static DEFAULT_NAME = 'test'
}
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const constants = result.entities.filter(e => e.type === 'Constant')
    expect(constants.length).toBe(2)
  })

  it('extracts Hook (useXxx pattern)', () => {
    const code = `
function useAuth() {
  return { user: null }
}

const useTheme = () => {
  return 'dark'
}
`
    const result = extractTsAst(code, 'test.tsx', 'tsx')
    const hooks = result.entities.filter(e => e.type === 'Hook')
    expect(hooks.length).toBe(2)
    expect(hooks.map(h => h.name).sort()).toEqual(['useAuth', 'useTheme'])
  })

  it('extracts TypeAlias (not Type)', () => {
    const code = `
type UserId = string
type UserMap = Map<string, User>
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const aliases = result.entities.filter(e => e.type === 'TypeAlias')
    expect(aliases.length).toBe(2)
    expect(aliases.map(a => a.name).sort()).toEqual(['UserId', 'UserMap'])
  })

  it('extracts Namespace', () => {
    const code = `
namespace MyUtils {
  export function helper() {}
}
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const ns = result.entities.filter(e => e.type === 'Namespace')
    expect(ns.length).toBe(1)
    expect(ns[0].name).toBe('MyUtils')
  })

  it('extracts top-level UPPER_CASE const as Constant', () => {
    const code = `
const MAX_RETRIES = 3
const DEFAULT_URL = 'https://example.com'
const myVar = 'not a constant'
`
    const result = extractTsAst(code, 'test.ts', 'ts')
    const constants = result.entities.filter(e => e.type === 'Constant')
    expect(constants.length).toBe(2)
    expect(constants.map(c => c.name).sort()).toEqual(['DEFAULT_URL', 'MAX_RETRIES'])
  })

  it('distinguishes Component from Hook from Function', () => {
    const code = `
function UserList() { return null }
function useUserList() { return [] }
function fetchUsers() { return [] }
`
    const result = extractTsAst(code, 'test.tsx', 'tsx')
    const component = result.entities.find(e => e.name === 'UserList')
    const hook = result.entities.find(e => e.name === 'useUserList')
    const fn = result.entities.find(e => e.name === 'fetchUsers')

    expect(component?.type).toBe('Component')
    expect(hook?.type).toBe('Hook')
    expect(fn?.type).toBe('Function')
  })
})
