// What `tauri dev` needs, and what `bun build --watch` does not provide: something LISTENING
// on devUrl. The watcher compiles; it does not serve. Without this, `tauri dev` opens a window
// pointed at a port nobody is on, and shows a blank page with no useful error.
//
// It also spawns the watcher itself, rather than relying on `cmd1 & cmd2` in an npm script —
// that shell trick works on macOS and Linux and breaks on Windows.
//
// No dependency, and none of it exists in a release build: Tauri then loads `frontendDist`
// straight off disk.
const PORT = Number(process.env.PORT ?? 1420);
const DIST = new URL('../dist/', import.meta.url).pathname;

const watcher = Bun.spawn(
  ['bun', 'build', './index.html', '--outdir=dist', '--sourcemap=linked', '--watch'],
  { cwd: new URL('..', import.meta.url).pathname, stdout: 'inherit', stderr: 'inherit' },
);
const stop = () => { watcher.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(DIST + (path === '/' ? 'index.html' : path.slice(1)));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(DIST + 'index.html'));   // one page: everything falls back to it
  },
});
console.log(`dev server on http://localhost:${PORT} — serving dist/, rebuilding on change`);
