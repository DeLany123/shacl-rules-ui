import express from 'express';
import { QueryEngine } from '@landmaes/query-shacl-rule';
import { Store, Parser } from 'n3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// Use the pre-built engine from @landmaes/query-shacl-rule.
// No config file needed — SHACL actors are already bundled inside.
const myEngine = new QueryEngine();
console.log('Comunica engine ready.');

app.post('/api/run', async (req, res) => {
  const { shaclQuery, turtleData } = req.body;

  // Set up the response as a streaming newline-delimited JSON
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    // Build a writable N3 store — passed as both source AND destination so the
    // shacl-rule fixpoint loop can INSERT newly inferred quads back into it and
    // re-query in the next iteration.
    const store = new Store();
    if (turtleData && turtleData.trim()) {
      const parser = new Parser();
      const quads = parser.parse(turtleData);
      store.addQuads(quads);
    }

    const quadStream = await myEngine.queryQuads(shaclQuery, {
      sources: [store],
      destination: store,  // required: fixpoint inserts flow back into the same store
      queryFormat: { language: 'shacl', version: '1.2' },
    });

    quadStream.on('data', (quad) => {
      res.write(JSON.stringify({
        subject: quad.subject.value,
        predicate: quad.predicate.value,
        object: quad.object.value,
        graph: quad.graph.value || '',
      }) + '\n');
    });

    quadStream.on('error', (err) => {
      res.write(JSON.stringify({ error: err.message }) + '\n');
      res.end();
    });

    quadStream.on('end', () => {
      res.end();
    });
  } catch (err) {
    res.write(JSON.stringify({ error: err.message }) + '\n');
    res.end();
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`SHACL Rule UI running at http://localhost:${PORT}`);
});

