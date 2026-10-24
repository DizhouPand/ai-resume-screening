function cleanOutput(value) {
  if (typeof value !== 'string') return '';
  let text = value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
  // 不完整的思考块不展示；只有结束标签时也丢弃其前内容。
  text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
  if (/<\/think\s*>/i.test(text)) text = text.split(/<\/think\s*>/i).pop();
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

const LIMIT = 64 * 1024;
const send = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/generate') return generate(request, env);
    if ((path === '/' || path === '/index.html') && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
    return new Response('页面不存在', { status: 404 });
  }
};

async function generate(request, env) {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: '请使用提交按钮发起筛选。' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return send(400, { error: '请先填写简历描述。' });
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMIT) { await reader.cancel(); return send(413, { error: '输入内容过长，请缩短后重试。' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return send(400, { error: '提交内容格式不正确，请重新输入。' }); }
  const input = body?.job_description;
  if (typeof input !== 'string' || !input.trim()) return send(400, { error: '请先填写简历描述。' });
  if (Array.from(input).length > 10000) return send(400, { error: '简历描述最多填写 10000 字。' });
  const key = env.DIFY_API_KEY?.trim();
  if (key && !/^[\x21-\x7e]+$/.test(key)) {
    console.error('DIFY_DIAGNOSTIC', 'invalid-key-characters');
    return send(503, { error: 'Dify 密钥含有无效字符，请重新填写纯英文密钥后部署。' });
  }
  let url;
  try {
    url = new URL((env.DIFY_API_BASE || '').replace(/\/+$/, '') + '/workflows/run');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !key) throw new Error();
  } catch {
    return send(503, { error: '服务尚未配置完成，请配置 Dify 地址和密钥。' });
  }
  const controller = new AbortController();
  // 预留时间向浏览器返回中文超时提示。
  const timer = setTimeout(() => controller.abort(), 55000);
  let stage = 'request';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { job_description: input.trim() }, response_mode: 'blocking', user: 'xiaozhou-web' }),
      signal: controller.signal,
      redirect: 'manual',
    });
    if (!response.ok) return send(502, { error: '筛选服务暂时不可用，请稍后重试。' });
    stage = 'response-json';
    const result = await response.json();
    if (result?.data?.status !== 'succeeded') return send(502, { error: '本次筛选未完成，请再试一次。' });
    const outputs = result.data.outputs;
    const aliases = { verdict1: 'verdict', verdict2: 'interview_result2' };
    const value = name => {
      const v = outputs?.[name] ?? outputs?.[aliases[name]];
      return cleanOutput(v);
    };
    // 只返回指定结果字段，不转发上游响应、错误或配置。
    if (value('verdict2')) return send(200, { type: 'low', verdict: value('verdict2') });
    if (value('verdict1')) return send(200, { type: 'review', verdict: value('verdict1') });
    if (value('text') || value('question')) return send(200, { type: 'interview', text: value('text'), question: value('question') });
    return send(502, { error: '筛选结果格式不符合约定，请检查工作流输出配置。' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const category = /ByteString|header|character|ISO-8859/i.test(message) ? 'header-format' : /redirect/i.test(message) ? 'redirect' : /URL|string|Request/i.test(message) ? 'request-format' : stage === 'response-json' ? 'invalid-json' : 'network-or-runtime';
    console.error('DIFY_DIAGNOSTIC', { stage, category, name: error instanceof Error ? error.name : 'unknown' });
    return send(502, { error: controller.signal.aborted ? '请再试一次。' : '暂时无法连接筛选服务，请稍后重试。' });
  } finally { clearTimeout(timer); }
}
