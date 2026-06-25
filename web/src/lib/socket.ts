import { io, Socket } from 'socket.io-client';
import type { Role } from './roles';

// In dev the Vite proxy forwards /socket.io to the server; in prod the server
// serves these assets, so same-origin works. Override with VITE_SERVER_URL.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export function connectSocket(role: Role, token?: string): Socket {
  return io(SERVER_URL, {
    query: { role, ...(token ? { token } : {}) },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
}
