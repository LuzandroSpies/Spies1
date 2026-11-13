'use strict';

const path = require('path');
const express = require('express');
const { fileStore } = require('./lib/store');
const { createApi } = require('./lib/api');
const ai = require('./lib/ai');

const app = express();
app.use(express.json({ limit: '6mb' })); // CSV imports arrive as JSON text
app.use(express.static(path.join(__dirname, 'public')));

const handle = createApi({ store: fileStore(), ai });

app.use('/api', async (req, res) => {
  try {
    res.json(await handle(req.method, req.path, req.body || {}, req.query || {}));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3100;
  app.listen(port, () => console.log(`DealFlip running at http://localhost:${port}`));
}

module.exports = app;
