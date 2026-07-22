import { createServer } from 'node:net';

// Ask the OS for an available loopback port. Vite still starts with
// --strictPort, so the small close/start race fails loudly rather than letting a
// test connect to an unrelated server.
export function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
