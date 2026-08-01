// Jest setup file to polyfill import.meta.dirname
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Polyfill import.meta.dirname for Jest environment
if (typeof import.meta.dirname === 'undefined') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  Object.defineProperty(import.meta, 'dirname', {
    value: __dirname,
    writable: false,
  });
}
