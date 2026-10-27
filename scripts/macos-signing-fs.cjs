// Preload before electron-builder/osx-sign captures fs.open in its binary scanner.
// The scanner walks all packaged files concurrently; queue EMFILE retries instead
// of depending on a runner's per-process/kernel file descriptor limits.
const fs = require('node:fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);
console.log(`macOS signing filesystem queue: graceful-fs ${require('graceful-fs/package.json').version}`);
