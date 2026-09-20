export default {
  root: new URL('.', import.meta.url).pathname,
  base: './',
  build: { rollupOptions: { input: { planes: new URL('./index.html', import.meta.url).pathname, boxes: new URL('./boxes.html', import.meta.url).pathname } } },
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  preview: { host: '127.0.0.1', port: 5194, strictPort: true },
};
