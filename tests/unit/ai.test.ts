import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgent, type AgentTool } from '@/lib/ai/agent';
import { OpenAiSession } from '@/lib/ai/openai';
import { AnthropicSession, normalizeHistory } from '@/lib/ai/anthropic';
import { GeminiSession, geminiSchema, mergePart } from '@/lib/ai/gemini';
import { configureTransport, aiErrorText } from '@/lib/ai/transport';
import { AiError } from '@/lib/ai/types';
import { scriptFetch, sseResponse } from './helpers';

afterEach(() => { vi.unstubAllGlobals(); });
configureTransport({ headers: p => ({ 'x-device-id': 'dev-12345678', ...(p === 'openai' ? { 'x-user-key': 'sk-user-test-key' } : {}) }) });

const pinTool: AgentTool = {
  name: 'search_places',
  description: 'search',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  run: vi.fn(async (args, ctx) => { ctx.pinned.push('P1'); ctx.step('찾는 중'); return { results: [{ ref: 'P1', name: '一蘭', q: args.query }] }; }),
};

describe('OpenAI Responses adapter', () => {
  it('streams text, runs tools via previous_response_id, and collects citations', async () => {
    const calls = scriptFetch([
      () => sseResponse([
        { data: { type: 'response.created', response: { id: 'resp_1' } } },
        { data: { type: 'response.output_text.delta', delta: '찾아볼게요' } },
        { data: { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_places', arguments: '{"query":"ラーメン"}' } } },
        { data: { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [
          { type: 'message', content: [{ type: 'output_text', text: '찾아볼게요', annotations: [] }] },
          { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_places', arguments: '{"query":"ラーメン"}' },
        ] } } },
      ]),
      () => sseResponse([
        { data: { type: 'response.created', response: { id: 'resp_2' } } },
        { data: { type: 'response.output_item.added', item: { type: 'web_search_call' } } },
        { data: { type: 'response.output_text.delta', delta: '一蘭 (P1) 추천' } },
        { data: { type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [
          { type: 'web_search_call', id: 'ws_1' },
          { type: 'message', content: [{ type: 'output_text', text: '一蘭 (P1) 추천', annotations: [{ type: 'url_citation', url: 'https://ichiran.com', title: 'Ichiran' }] }] },
        ] } } },
      ]),
    ]);
    const drafts: string[] = [];
    const res = await runAgent({
      provider: 'openai', model: 'gpt-6.1-sol', system: 'SYS', history: [{ role: 'user', text: '안녕' }, { role: 'assistant', text: '안녕하세요' }],
      text: '라멘', images: [{ mime: 'image/jpeg', b64: 'AAAA' }], tools: [pinTool], webSearch: { country: 'JP', city: 'Shinjuku' },
      onDraft: t => drafts.push(t),
    });
    expect(calls[0].url).toBe('/api/ai/openai/responses');
    expect((calls[0].init.headers as Record<string, string>)['x-user-key']).toBe('sk-user-test-key');
    const b0 = calls[0].body;
    expect(b0).toMatchObject({ model: 'gpt-6.1-sol', instructions: 'SYS', stream: true, store: true, reasoning: { effort: 'low' } });
    expect(b0.input).toEqual([
      { role: 'user', content: '안녕' }, { role: 'assistant', content: '안녕하세요' },
      { role: 'user', content: [{ type: 'input_text', text: '라멘' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' }] },
    ]);
    expect(b0.tools[0]).toMatchObject({ type: 'function', name: 'search_places', strict: false });
    expect(b0.tools[1]).toMatchObject({ type: 'web_search', user_location: { type: 'approximate', country: 'JP', city: 'Shinjuku' } });
    const b1 = calls[1].body;
    expect(b1.previous_response_id).toBe('resp_1');
    expect(b1.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: JSON.stringify({ results: [{ ref: 'P1', name: '一蘭', q: 'ラーメン' }] }) }]);
    expect(res.text).toBe('一蘭 (P1) 추천');
    expect(res.sources).toEqual([{ url: 'https://ichiran.com', title: 'Ichiran' }]);
    expect(res.pinned).toEqual(['P1']);
    expect(res.steps).toContain('웹 검색 중…');
    expect(drafts).toContain('');
  });

  it('retries without reasoning when the model rejects it', async () => {
    const calls = scriptFetch([
      () => Response.json({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model." } }, { status: 400 }),
      () => sseResponse([{ data: { type: 'response.completed', response: { id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] } } }]),
    ]);
    const s = new OpenAiSession();
    const r = await s.start({ system: 's', history: [], user: { text: 'hi' }, tools: [], model: 'gpt-x' }, {});
    expect(r.text).toBe('OK');
    expect(calls[1].body.reasoning).toBeUndefined();
    expect(calls[1].body.tools).toBeUndefined();
  });

  it('maps HTTP errors to friendly messages', async () => {
    scriptFetch([() => Response.json({ error: 'rate_limited', message: '요청이 너무 많아요.' }, { status: 429 })]);
    const s = new OpenAiSession();
    await expect(s.start({ system: 's', history: [], user: { text: 'hi' }, tools: [], model: 'gpt-x' }, {})).rejects.toBeInstanceOf(AiError);
    expect(aiErrorText(new AiError('rate', '요청이 너무 많아요.', 429))).toContain('잠시 후');
    expect(aiErrorText(new AiError('no_key', 'x'))).toContain('키');
  });
});

describe('Anthropic Messages adapter', () => {
  it('assembles thinking, tool_use JSON deltas, web search blocks and sends them back intact', async () => {
    const calls = scriptFetch([
      () => sseResponse([
        { event: 'message_start', data: { type: 'message_start', message: { id: 'm1', content: [] } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '생각' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: {} } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"新宿 ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'ラーメン"}' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://a.jp', title: 'A', encrypted_content: 'ENC' }] } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_places', input: {} } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"qu' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: 'ery":"ラーメン"}' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 3 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
      () => sseResponse([
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '一蘭 (P1)' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://a.jp', title: 'A' } } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } },
      ]),
    ]);
    const res = await runAgent({ provider: 'anthropic', model: 'claude-sonnet-5-5', system: 'SYS', history: [{ role: 'assistant', text: '인사' }, { role: 'user', text: 'q1' }, { role: 'user', text: 'q2' }], text: '라멘', tools: [pinTool], webSearch: { city: 'Shinjuku' } });
    const b0 = calls[0].body;
    expect(b0).toMatchObject({ model: 'claude-sonnet-5-5', system: 'SYS', stream: true, output_config: { effort: 'low' }, thinking: { type: 'between_tools' } });
    expect(b0.tools[0]).toEqual({ name: 'search_places', description: 'search', input_schema: pinTool.parameters });
    expect(b0.tools[1]).toMatchObject({ type: 'web_search_20250305', name: 'web_search', user_location: { country: 'JP', city: 'Shinjuku' } });
    // leading assistant dropped, consecutive user turns merged into one user turn
    expect(b0.messages).toHaveLength(1);
    expect(b0.messages[0].role).toBe('user');
    expect(b0.messages[0].content.map((c: any) => c.text)).toEqual(['q1\n\nq2', '라멘']);
    const b1 = calls[1].body;
    const assistant = b1.messages[b1.messages.length - 2];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: '생각', signature: 'SIG' });
    expect(assistant.content[1]).toEqual({ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: '新宿 ラーメン' } });
    expect(assistant.content[2].content[0].encrypted_content).toBe('ENC');
    expect(assistant.content[3]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'search_places', input: { query: 'ラーメン' } });
    expect(b1.messages[b1.messages.length - 1]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify({ results: [{ ref: 'P1', name: '一蘭', q: 'ラーメン' }] }) }] });
    expect(res.text).toBe('一蘭 (P1)');
    expect(res.sources).toEqual([{ url: 'https://a.jp', title: 'A' }]);
    expect(res.steps).toContain('웹 검색: 新宿 ラーメン');
  });

  it('resumes pause_turn and drops unsupported extras on 400', async () => {
    const calls = scriptFetch([
      () => Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'thinking.type: between_tools is not supported for this model' } }, { status: 400 }),
      () => sseResponse([
        { data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '부분' } } },
        { data: { type: 'content_block_stop', index: 0 } },
        { data: { type: 'message_delta', delta: { stop_reason: 'pause_turn' } } },
      ]),
      () => sseResponse([
        { data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '완성' } } },
        { data: { type: 'content_block_stop', index: 0 } },
        { data: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } },
      ]),
    ]);
    const res = await runAgent({ provider: 'anthropic', model: 'claude-sonnet-5-5', system: 's', history: [], text: 'q', tools: [] });
    expect(calls[1].body.thinking).toBeUndefined();
    expect(calls[2].body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '부분' }] });
    expect(res.text).toBe('완성');
  });

  it('normalizes history', () => {
    expect(normalizeHistory([{ role: 'assistant', text: 'a' }, { role: 'user', text: ' ' }, { role: 'user', text: 'u1' }, { role: 'assistant', text: 'x' }, { role: 'assistant', text: 'y' }]))
      .toEqual([{ role: 'user', text: 'u1' }, { role: 'assistant', text: 'x\n\ny' }]);
  });
});

describe('Gemini adapter', () => {
  it('keeps thought signatures, echoes call ids and maps history roles', async () => {
    const calls = scriptFetch([
      () => sseResponse([
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: '찾' }] } }] } },
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: '을게요' }] } }] } },
        { data: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'fc-1', name: 'search_places', args: { query: 'ラーメン' } }, thoughtSignature: 'TS1' }] }, finishReason: 'STOP' }] } },
      ]),
      () => sseResponse([
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: '一蘭 ' }] } }] } },
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: '(P1)', thoughtSignature: 'TS2' }] }, finishReason: 'STOP' }] } },
      ]),
    ]);
    const res = await runAgent({ provider: 'gemini', model: 'gemini-3.8-flash', system: 'SYS', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }], text: '라멘', tools: [pinTool], images: [{ mime: 'image/png', b64: 'QQ==' }] });
    expect(calls[0].url).toBe('/api/ai/gemini/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    const b0 = calls[0].body;
    expect(b0.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(b0.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    expect(b0.contents[2].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'QQ==' } });
    // additionalProperties is stripped for Gemini
    expect(b0.tools[0].functionDeclarations[0].parameters).toEqual({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] });
    const b1 = calls[1].body;
    const model = b1.contents[3];
    expect(model.role).toBe('model');
    expect(model.parts).toEqual([{ text: '찾을게요' }, { functionCall: { id: 'fc-1', name: 'search_places', args: { query: 'ラーメン' } }, thoughtSignature: 'TS1' }]);
    expect(b1.contents[4]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'search_places', id: 'fc-1', response: { results: [{ ref: 'P1', name: '一蘭', q: 'ラーメン' }] } } }] });
    expect(res.text).toBe('一蘭 (P1)');
  });

  it('retries without thinkingConfig and reports blocked prompts', async () => {
    const calls = scriptFetch([
      () => Response.json({ error: { code: 400, message: 'Invalid JSON payload: Unknown name "thinkingLevel"', status: 'INVALID_ARGUMENT' } }, { status: 400 }),
      () => sseResponse([{ data: { promptFeedback: { blockReason: 'SAFETY' } } }]),
    ]);
    const s = new GeminiSession();
    await expect(s.start({ system: 's', history: [], user: { text: 'x' }, tools: [], model: 'gemini-3.8-flash' }, {})).rejects.toMatchObject({ code: 'content' });
    expect(calls[1].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('merges text parts without losing signatures', () => {
    const parts: any[] = [];
    mergePart(parts, { text: 'a' }); mergePart(parts, { text: 'b' }); mergePart(parts, { text: '', thoughtSignature: 'S' }); mergePart(parts, { text: 'c' });
    expect(parts).toEqual([{ text: 'ab' }, { text: '', thoughtSignature: 'S' }, { text: 'c' }]);
    expect(geminiSchema({ type: 'object', properties: { a: { type: 'array', items: { type: 'number', default: 1 } as any } }, $schema: 'x' } as any))
      .toEqual({ type: 'object', properties: { a: { type: 'array', items: { type: 'number' } } } });
  });
});

describe('agent loop', () => {
  it('stops after maxRounds and reports truncation; tool errors are returned to the model', async () => {
    const failing: AgentTool = { name: 't', description: 'd', parameters: { type: 'object' }, run: async () => { throw new Error('boom'); } };
    const loop = () => sseResponse([
      { data: { type: 'response.created', response: { id: 'r' } } },
      { data: { type: 'response.completed', response: { id: 'r', status: 'completed', output: [{ type: 'function_call', call_id: 'c', name: 't', arguments: '{}' }] } } },
    ]);
    const calls = scriptFetch([loop, loop, loop]);
    const res = await runAgent({ provider: 'openai', model: 'gpt-x', system: 's', history: [], text: 'q', tools: [failing], maxRounds: 3 });
    expect(res.truncated).toBe(true);
    expect(JSON.parse(calls[1].body.input[0].output)).toEqual({ error: 'boom' });
  });
});
