'use strict';

async function requestJson(url, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    const content = await response.text();
    if (response.ok) return content ? JSON.parse(content) : null;
    if (attempt === attempts || (response.status !== 429 && response.status < 500)) {
      throw new Error(`${options.method || 'GET'} ${url} falhou (${response.status}): ${content.slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
}

module.exports = { requestJson };
