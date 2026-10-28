/**
 * ELK's layout engine, as a Web Worker.
 *
 * elkjs ships its worker as a classic script, and when that script finds itself in a worker
 * scope it installs its own message dispatcher on `self`, which `elk-api` on the main thread
 * then talks to. This module exists so the bundlers can find it: both Vite and Turbopack
 * resolve `new Worker(new URL("./elk-worker.ts", import.meta.url))` beside the code that
 * starts it, where a bare `elkjs/...` specifier inside `new URL()` is not one either resolves.
 *
 * Not the bundled build: imported in a worker scope it installs that same dispatcher instead
 * of exporting the in-thread worker it needs, so `new ELK()` there has nothing to run on.
 */
import "elkjs/lib/elk-worker.min.js";
