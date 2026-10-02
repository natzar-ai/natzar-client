// The mock Natzar API (./mock-natzar.ts) behind a real node:http server, for
// fixtures that run the middleware in ANOTHER process (the Next.js app): point
// its NATZAR_API_URL at `url`.
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mockNatzar, type MockNatzarOptions} from './mock-natzar.ts';

export async function serveMockNatzar(options: MockNatzarOptions = {}) {
  const mock = mockNatzar(options);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const body = Buffer.concat(chunks).toString('utf8');
      const answer = await mock.fetchLike(`http://127.0.0.1${req.url}`, {method: req.method, headers, ...(body ? {body} : {})});
      res.statusCode = answer.status;
      answer.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await answer.text());
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {mock, url: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>((r) => server.close(() => r()))};
}
