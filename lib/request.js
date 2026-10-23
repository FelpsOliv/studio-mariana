export function parseBody(request, maximumBytes = 4096) {
  const length = Number(request.headers['content-length'] || 0);
  if (length > maximumBytes) throw Object.assign(new Error('Payload muito grande.'), { status: 400 });
  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > maximumBytes) throw Object.assign(new Error('Corpo da requisição inválido.'), { status: 400 });
  return body;
}
