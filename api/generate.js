function cleanOutput(value) {
  if (typeof value !== 'string') return '';
  let text = value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
  // 不完整的思考块不展示；只有结束标签时也丢弃其前内容。
  text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
  if (/<\/think\s*>/i.test(text)) text = text.split(/<\/think\s*>/i).pop();
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

'use strict';
const LIMIT = 64 * 1024;
module.exports = async function generate(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(405, { error: '请使用提交按钮发起筛选。' });
  }
  let body;
  try {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (Buffer.byteLength(JSON.stringify(body)) > LIMIT) return send(413, { error: '输入内容过长，请缩短后重试。' });
    } else {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > LIMIT) return send(413, { error: '输入内容过长，请缩短后重试。' });
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
  } catch {
    return send(400, { error: '提交内容格式不正确，请重新输入。' });
  }
  const input = body?.job_description;
  if (typeof input !== 'string' || !input.trim()) return send(400, { error: '请先填写简历描述。' });
  if (Array.from(input).length > 10000) return send(400, { error: '简历描述最多填写 10000 字。' });
  const key = process.env.DIFY_API_KEY?.trim();
  let url;
  try {
    url = new URL((process.env.DIFY_API_BASE || '').replace(/\/+$/, '') + '/workflows/run');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !key) throw new Error();
  } catch {
    return send(503, { error: '服务尚未配置完成，请配置 Dify 地址和密钥。' });
  }
  const controller = new AbortController();
  // 留出时间在 Vercel 的 60 秒上限前返回中文提示。
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { job_description: input.trim() }, response_mode: 'blocking', user: 'xiaozhou-web' }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) return send(502, { error: '筛选服务暂时不可用，请稍后重试。' });
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
  } catch {
    return send(502, { error: controller.signal.aborted ? '请再试一次。' : '暂时无法连接筛选服务，请稍后重试。' });
  } finally { clearTimeout(timer); }
};
