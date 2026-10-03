/* Mock upstream APIs for end-to-end tests: OpenAI, Anthropic, Gemini (incl. live tokens), FX, weather,
   earthquakes, NAVITIME and the Maps Grounding Lite MCP server. Deterministic answers keyed on the prompt. */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4010);
export const log = [];

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const sse = (res, events) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const e of events) res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`);
  res.end();
};
const readBody = req => new Promise(resolve => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(JSON.parse(s)); } catch { resolve(s); } });
});
const chunks = (s, n = 12) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; };

/* ---------- canned answers ---------- */
function jsonAnswer(prompt) {
  if (/예약 확인서/.test(prompt)) return { kind: 'restaurant', title: 'すしざんまい 新宿店', date: '2026-11-24', time: '19:30', people: 2, confirmation: 'TBL-77812', platform: 'TableCheck', price: '¥12,000', address: '東京都新宿区歌舞伎町１丁目２１−１', note: '15분 이상 늦으면 취소될 수 있어요' };
  if (/한국어 발음/.test(prompt)) return { lines: [{ ja: 'もしもし、予約をお願いしたいのですが。', read: '모시모시, 요야쿠오 오네가이시타이노데스가.' }] };
  if (/카메라|사진은 사용자가/.test(prompt)) return { say: '왼쪽 노란 표지판의 東口(동쪽 출구) 방향으로 가세요.', steps: ['왼쪽으로 20m', '계단을 올라가세요'], signs: [{ ja: '東口', ko: '동쪽 출구' }, { ja: 'JR線', ko: 'JR선' }], confidence: 'high', need: '' };
  return { ok: true };
}
const wantsTool = text => /편의점|convenience/.test(text);
const finalWithRef = output => {
  let ref = 'P1', name = '편의점';
  try { const o = typeof output === 'string' ? JSON.parse(output) : output; const r = o?.results?.[0] || o?.places?.[0]; if (r) { ref = r.ref; name = r.name; } } catch { /* default */ }
  return `가장 가까운 편의점은 **${name}** (${ref})이에요. 걸어서 2분 정도예요.`;
};

/* ---------- OpenAI Responses ---------- */
function openaiResponses(body, res) {
  const id = `resp_${Math.random().toString(36).slice(2, 10)}`;
  const inputs = Array.isArray(body.input) ? body.input : [];
  const fco = inputs.find(x => x.type === 'function_call_output');
  const userText = JSON.stringify(inputs);
  let text = '';
  const output = [];
  const events = [{ data: { type: 'response.created', response: { id, status: 'in_progress' } } }];
  if (fco) text = finalWithRef(fco.output);
  else if (body.text?.format?.type === 'json_object') text = JSON.stringify(jsonAnswer(userText + (body.instructions || '')));
  else if (body.tools?.length && wantsTool(userText)) {
    const item = { type: 'function_call', id: 'fc_1', call_id: 'call_conv_1', name: 'search_places', arguments: JSON.stringify({ category: 'conv' }), status: 'completed' };
    events.push({ data: { type: 'response.output_item.done', output_index: 0, item } });
    output.push(item);
  } else text = 'OK — ChatGPT 응답이에요.';
  if (text) {
    for (const c of chunks(text)) events.push({ data: { type: 'response.output_text.delta', delta: c } });
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] });
  }
  events.push({ data: { type: 'response.completed', response: { id, status: 'completed', output } } });
  sse(res, events);
}

/* ---------- Anthropic Messages ---------- */
function anthropicMessages(body, res) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  const content = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content || '') }];
  const toolResult = content.find(c => c.type === 'tool_result');
  const userText = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const ev = [{ data: { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [], model: body.model } } }];
  let stop = 'end_turn';
  const textBlock = t => {
    ev.push({ data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    for (const c of chunks(t)) ev.push({ data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } } });
    ev.push({ data: { type: 'content_block_stop', index: 0 } });
  };
  if (toolResult) textBlock(finalWithRef(toolResult.content));
  else if (/JSON 객체 하나만/.test(userText)) textBlock(JSON.stringify(jsonAnswer(userText)));
  else if (body.tools?.some(t => t.name === 'search_places') && wantsTool(userText)) {
    ev.push({ data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_places', input: {} } } });
    ev.push({ data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"categ' } } });
    ev.push({ data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ory":"conv"}' } } });
    ev.push({ data: { type: 'content_block_stop', index: 0 } });
    stop = 'tool_use';
  } else textBlock('OK — Claude 응답이에요. 앞으로 쭉 가다가 오른쪽 계단으로 내려가세요.');
  ev.push({ data: { type: 'message_delta', delta: { stop_reason: stop } } });
  ev.push({ data: { type: 'message_stop' } });
  sse(res, ev);
}

/* ---------- Gemini ---------- */
function geminiStream(body, res) {
  const contents = Array.isArray(body.contents) ? body.contents : [];
  const last = contents[contents.length - 1] || { parts: [] };
  const fr = (last.parts || []).find(p => p.functionResponse);
  const userText = (last.parts || []).filter(p => typeof p.text === 'string').map(p => p.text).join('\n');
  const cand = parts => ({ data: { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] } });
  if (fr) return sse(res, chunks(finalWithRef(fr.functionResponse.response), 20).map(t => cand([{ text: t }])));
  if (body.generationConfig?.responseMimeType === 'application/json') return sse(res, [cand([{ text: JSON.stringify(jsonAnswer(userText + JSON.stringify(body.systemInstruction || ''))) }])]);
  const hasSearch = body.tools?.[0]?.functionDeclarations?.some(f => f.name === 'search_places');
  if (hasSearch && wantsTool(userText)) return sse(res, [cand([{ functionCall: { id: 'g1', name: 'search_places', args: { category: 'conv' } }, thoughtSignature: 'sig' }])]);
  sse(res, ['OK — Gemini ', '응답이에요.'].map(t => cand([{ text: t }])));
}

/* ---------- NAVITIME ---------- */
const navitime = {
  items: [{
    summary: { move: { time: 18, transit_count: 0, fare: { unit_0: 210, unit_48: 208 }, from_time: '2026-11-23T10:00:00+09:00', to_time: '2026-11-23T10:18:00+09:00', distance: 4200 } },
    sections: [
      { type: 'point', name: 'start' },
      { type: 'move', move: 'walk', time: 4, distance: 250, line_name: '徒歩' },
      { type: 'point', name: '新宿', gateway: '東口', start_platform: '14番線', numbering: { departure: [{ symbol: 'JY', number: '17' }] } },
      { type: 'move', move: 'local_train', time: 7, distance: 3400, line_name: 'ＪＲ山手線内回り', from_time: '2026-11-23T10:04:00+09:00', to_time: '2026-11-23T10:11:00+09:00', transport: { name: 'ＪＲ山手線', color: '#9ACD32', company: { name: 'JR東日本' }, links: [{ destination: { name: '渋谷・品川方面' } }] } },
      { type: 'point', name: '渋谷', goal_platform: '2番線', gateway: 'ハチ公口' },
      { type: 'move', move: 'walk', time: 7, distance: 550 },
      { type: 'point', name: 'goal' },
    ],
    shapes: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[139.7004, 35.6905], [139.7006, 35.6896], [139.7016, 35.6580]] } }] },
  }],
};

/* ---------- MCP (Maps Grounding Lite) ---------- */
function mcp(body, res) {
  const id = body?.id;
  const reply = result => send(res, 200, { jsonrpc: '2.0', id, result }, { 'Mcp-Session-Id': 'mock-session' });
  if (body?.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-maps' } });
  if (body?.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
  if (body?.method === 'tools/list') return reply({ tools: [{ name: 'search_places', inputSchema: { type: 'object', properties: { text_query: { type: 'string' }, location_bias: { type: 'object' }, language_code: {}, region_code: {} } } }] });
  if (body?.method === 'tools/call') {
    const data = { summary: '신주쿠역 동쪽 출구 근처 편의점 2곳이에요.', places: [
      { id: 'ChIJ_famima', displayName: { text: '패밀리마트 신주쿠역 동쪽 출구점' }, location: { latitude: 35.69112, longitude: 139.70104 }, googleMapsUri: 'https://maps.google.com/?cid=famima' },
      { id: 'ChIJ_seven', displayName: { text: '세븐일레븐 신주쿠 3초메점' }, location: { latitude: 35.69021, longitude: 139.70392 }, googleMapsUri: 'https://maps.google.com/?cid=seven' },
    ] };
    return reply({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  }
  send(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } });
}

function now9() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, hour: d.getUTCHours(), quake: `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(Math.max(0, d.getUTCMinutes() - 5))}:00` };
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = req.method === 'POST' ? await readBody(req) : null;
  log.push({ method: req.method, path: url.pathname, body });
  if (log.length > 500) log.shift();
  const p = url.pathname;
  try {
    if (p === '/__log') return send(res, 200, log.slice(-100));
    if (p === '/openai/v1/responses') return openaiResponses(body, res);
    if (p === '/openai/v1/realtime/client_secrets') return send(res, 200, { value: 'ek_test_123', expires_at: Math.floor(Date.now() / 1000) + 60 });
    if (p === '/anthropic/v1/messages') return anthropicMessages(body, res);
    if (p.startsWith('/gemini/v1beta/models/') && p.endsWith(':streamGenerateContent')) return geminiStream(body, res);
    if (p.startsWith('/gemini/v1beta/models/') && p.endsWith(':generateContent')) return send(res, 200, { candidates: [{ content: { parts: [{ text: '검색 결과: 오늘은 정상 운행 중이에요.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.jreast.co.jp/', title: 'JR東日本' } }] } }] });
    if (p === '/gemini/v1alpha/auth_tokens') return send(res, 200, { name: 'auth_tokens/mock-token' });
    if (p.startsWith('/fx/')) return send(res, 200, { amount: 1, base: 'JPY', date: now9().date, rates: { KRW: 9.12 } });
    if (p.startsWith('/weather/')) {
      const t = now9();
      const tomorrow = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10);
      const hrs = Array.from({ length: 48 }, (_, i) => `${i < 24 ? t.date : tomorrow}T${String(i % 24).padStart(2, '0')}:00`);
      return send(res, 200, {
        current: { time: `${t.date}T${String(t.hour).padStart(2, '0')}:10`, temperature_2m: 14.6, apparent_temperature: 13.1, weather_code: 2, precipitation: 0, wind_speed_10m: 9, relative_humidity_2m: 58 },
        hourly: { time: hrs, temperature_2m: hrs.map((_, i) => 14 + Math.sin(i / 4) * 2), precipitation_probability: hrs.map((_, i) => (i > 5 && i < 9 ? 60 : 10)), weather_code: hrs.map((_, i) => (i > 5 && i < 9 ? 61 : 2)) },
        daily: { time: [0, 1, 2, 3].map(i => { const d = new Date(Date.now() + 9 * 3600e3 + i * 86400e3); return d.toISOString().slice(0, 10); }), weather_code: [2, 61, 3, 0], temperature_2m_max: [17, 15, 16, 18], temperature_2m_min: [9, 10, 8, 9], precipitation_probability_max: [10, 80, 30, 0] },
      });
    }
    if (p.startsWith('/quake/')) {
      const strong = process.env.MOCK_QUAKE === 'strong';
      return send(res, 200, [{ id: 'q1', code: 551, time: now9().quake, earthquake: { time: now9().quake, hypocenter: { name: '千葉県北西部', latitude: 35.7, longitude: 140.1, depth: 60, magnitude: strong ? 5.9 : 3.2 }, maxScale: strong ? 50 : 20, domesticTsunami: 'None' } }]);
    }
    if (p === '/navitime/route_transit') return send(res, 200, navitime);
    if (p === '/mcp') return mcp(body, res);
    send(res, 404, { error: 'not_mocked', path: p });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, '127.0.0.1', () => console.log(`mock upstream on ${PORT}`));
}
