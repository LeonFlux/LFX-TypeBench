import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { heroicons } from './icons.ts';

export default defineConfig({
  plugins: [tailwindcss(), heroicons()],
});
