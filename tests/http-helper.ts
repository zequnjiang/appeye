import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';

/** Exercise the public HTTP boundary without opening an external network connection. */
export async function serve(app: RequestListener) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = '';

  return {
    baseUrl,
    get cookie() { return cookie; },
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) cookie = cookies.map((value) => value.split(';')[0]).join('; ');
      return response;
    },
    async close() { await closeServer(server); },
  };
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
