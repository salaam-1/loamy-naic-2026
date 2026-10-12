import { describe, expect, it } from 'vitest'
import {
  PINNED_MODEL, ModelConfigurationError, adapterFromEnv,
  resolveInferenceUrl, resolveModel,
} from '@/lib/loam/model/adapter'

/**
 * The model Loam answers with, and the host it answers from.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *   The forensic audit found `glm-5.2:cloud` registered in this machine's
 *   Ollama and the server reporting `OLLAMA_NO_CLOUD:false`. `LOAM_MODEL` was
 *   a bare `??` default, so one env line could have routed Nigerian
 *   agricultural questions to a hosted third-party model while every log line
 *   still read "N-ATLaS". Nothing about that would have failed visibly.
 */
describe('the inference model is pinned', () => {
  it('defaults to the hash-verified N-ATLaS quantization', () => {
    expect(PINNED_MODEL).toBe('natlas-q4km:latest')
    expect(resolveModel({})).toBe(PINNED_MODEL)
    expect(resolveModel({ LOAM_MODEL: '   ' })).toBe(PINNED_MODEL)
  })

  it('accepts the pinned model stated explicitly', () => {
    expect(resolveModel({ LOAM_MODEL: 'natlas-q4km:latest' })).toBe(PINNED_MODEL)
  })

  it('REFUSES an Ollama cloud model', () => {
    // `glm-5.2:cloud` is registered on this machine today, which is why the
    // refusal is by tag rather than by a blocklist of model names.
    for (const m of ['glm-5.2:cloud', 'natlas-q4km:cloud', 'deepseek-v3.1:CLOUD']) {
      expect(() => resolveModel({ LOAM_MODEL: m })).toThrow(ModelConfigurationError)
    }
    expect(() => resolveModel({ LOAM_MODEL: 'glm-5.2:cloud' })).toThrow(/cloud model/i)
  })

  it('refuses a cloud model EVEN WITH the override set', () => {
    // The override exists for running a different LOCAL model deliberately.
    // It must not become a way to opt into hosted inference.
    expect(() => resolveModel({ LOAM_MODEL: 'glm-5.2:cloud', LOAM_ALLOW_MODEL_OVERRIDE: 'true' }))
      .toThrow(ModelConfigurationError)
  })

  it('refuses any other model unless the override is explicit', () => {
    expect(() => resolveModel({ LOAM_MODEL: 'llama3:8b' })).toThrow(/not the pinned model/i)
    expect(resolveModel({ LOAM_MODEL: 'llama3:8b', LOAM_ALLOW_MODEL_OVERRIDE: 'true' }))
      .toBe('llama3:8b')
  })
})

describe('the inference host cannot be Ollama cloud', () => {
  it('defaults to the local host', () => {
    expect(resolveInferenceUrl({})).toBe('http://127.0.0.1:11434')
  })

  it('REFUSES ollama.com and its subdomains', () => {
    for (const u of ['https://ollama.com', 'https://api.ollama.com/v1', 'http://ollama.com:443']) {
      expect(() => resolveInferenceUrl({ LOAM_INFERENCE_URL: u })).toThrow(ModelConfigurationError)
    }
  })

  it('refuses a malformed URL rather than guessing', () => {
    expect(() => resolveInferenceUrl({ LOAM_INFERENCE_URL: 'not a url' }))
      .toThrow(/not a valid URL/i)
  })

  it('allows another local or self-hosted host', () => {
    expect(resolveInferenceUrl({ LOAM_INFERENCE_URL: 'http://localhost:11434' }))
      .toBe('http://localhost:11434')
  })
})

describe('adapterFromEnv applies both guards', () => {
  it('builds an Ollama adapter on the pinned model by default', () => {
    const a = adapterFromEnv({}) as { name: string }
    expect(a.name).toBe('ollama')
  })

  it('throws rather than constructing a cloud-routed adapter', () => {
    expect(() => adapterFromEnv({ LOAM_MODEL: 'glm-5.2:cloud' })).toThrow(ModelConfigurationError)
    expect(() => adapterFromEnv({ LOAM_INFERENCE_URL: 'https://ollama.com' }))
      .toThrow(ModelConfigurationError)
  })
})
