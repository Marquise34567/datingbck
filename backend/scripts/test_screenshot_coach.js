#!/usr/bin/env node
// Simple test script to POST an image to the local /api/screenshot-coach endpoint.
// Usage: node scripts/test_screenshot_coach.js /full/path/to/screenshot.png

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error('Usage: node scripts/test_screenshot_coach.js /full/path/to/screenshot.png');
    process.exit(2);
  }
  const resolved = path.resolve(imgPath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(3);
  }

  const fd = new FormData();
  fd.append('image', fs.createReadStream(resolved));
  fd.append('note', 'Test run from scripts/test_screenshot_coach.js');

  const url = process.env.BACKEND_URL || 'http://127.0.0.1:4000/api/screenshot-coach';
  console.log('Posting to', url);
  try {
    const res = await fetch(url, { method: 'POST', body: fd, headers: fd.getHeaders() });
    const txt = await res.text();
    console.log('HTTP', res.status, res.statusText);
    try {
      console.log(JSON.stringify(JSON.parse(txt), null, 2));
    } catch (e) {
      console.log(txt);
    }
  } catch (err) {
    console.error('Request failed:', err && err.message ? err.message : err);
    process.exit(4);
  }
}

main();
