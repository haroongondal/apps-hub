import { describe, expect, it } from 'vitest'
import { parseEnvFile } from '../src/main/lib/env-file'

describe('parseEnvFile', () => {
  it('reads a plain key and value', () => {
    expect(parseEnvFile('AI_GATEWAY_API_KEY=abc123')).toEqual({ AI_GATEWAY_API_KEY: 'abc123' })
  })

  it('reads a file with no trailing newline and CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('skips blank lines and comments', () => {
    expect(parseEnvFile('# a comment\n\nA=1\n   # indented\nB=2\n')).toEqual({ A: '1', B: '2' })
  })

  it('strips an export prefix and surrounding whitespace', () => {
    expect(parseEnvFile('export A = 1 \n  B=2  ')).toEqual({ A: '1', B: '2' })
  })

  it('strips matching quotes but keeps inner ones', () => {
    expect(parseEnvFile(`A="1"\nB='2'\nC="say \\"hi\\""\nD='mismatched"`)).toEqual({
      A: '1',
      B: '2',
      C: 'say \\"hi\\"',
      D: `'mismatched"`
    })
  })

  it('keeps an = that appears inside the value', () => {
    expect(parseEnvFile('A=sk-abc==\nB=a=b=c')).toEqual({ A: 'sk-abc==', B: 'a=b=c' })
  })

  it('ignores lines that carry no assignment', () => {
    expect(parseEnvFile('NOT_AN_ASSIGNMENT\n=novalue\nA=1')).toEqual({ A: '1' })
  })

  it('keeps an empty value rather than dropping the key', () => {
    expect(parseEnvFile('A=')).toEqual({ A: '' })
  })
})
