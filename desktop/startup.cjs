// No engine output is executed in the renderer. Only validated integer progress crosses this boundary.
function createStartupParser(onProgress, onReady) {
  let pending = '', shown = -1, ready = false;
  return chunk => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop().slice(-4096);
    for (const line of lines) {
      const progress = /^PROGRESS (\d{1,3})$/.exec(line);
      if (progress && !ready) {
        const value = Number(progress[1]);
        if (value <= 100 && value > shown) { shown = value; onProgress(value); }
      }
      const match = /^READY (\d+)$/.exec(line);
      if (match && !ready && Number(match[1]) > 0 && Number(match[1]) <= 65535) {
        ready = true; onReady(Number(match[1]));
      }
    }
  };
}

function splashHtml(locale) {
  const pt = /^pt\b/i.test(locale);
  const loading = pt ? 'A iniciar o RE:Forge…' : 'Starting RE:Forge…';
  const detail = pt ? 'A carregar cartas e decks' : 'Loading cards and decks';
  return `<!doctype html><html lang="${pt ? 'pt' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RE:Forge</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1f3b2d;color:#efe7d6;font:16px/1.5 system-ui,sans-serif}main{width:min(400px,calc(100% - 64px))}h1{font:600 64px/1 Georgia,serif;margin:0 0 32px}p{margin:12px 0}progress{display:block;width:100%;height:8px;border:0;border-radius:4px;overflow:hidden;background:#526b5c;accent-color:#efe7d6}progress::-webkit-progress-bar{background:#526b5c}progress::-webkit-progress-value{background:#efe7d6}footer{display:flex;justify-content:space-between;gap:16px;font-size:14px;color:#c9d3c6;margin-top:12px}</style>
<main><h1>RE:Forge</h1><p>${loading}</p><progress id="startup-progress" max="100" value="0" aria-label="${loading}"></progress><footer><span>${detail}</span><output id="startup-value" aria-live="polite">0%</output></footer></main></html>`;
}

module.exports = { createStartupParser, splashHtml };
