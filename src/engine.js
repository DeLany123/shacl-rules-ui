import { QueryEngine } from '@landmaes/query-shacl-rule';
import { Store, Parser } from 'n3';

// Extract SPARQL-style PREFIX lines from the SHACL query so the Turtle
// parser knows about prefixes like ":" without the user having to redeclare them.
function extractPrefixLines(shaclQuery) {
  return shaclQuery
    .split('\n')
    .filter(line => /^\s*PREFIX\s+/i.test(line))
    .join('\n');
}

// Expose a single async function that the UI calls instead of fetch('/api/run').
// It resolves to an array of quad-like objects { subject, predicate, object, graph }
// and calls onQuad(quad) for each inferred quad as it arrives (streaming feel).
export async function runShaclQuery({ shaclQuery, turtleData }, onQuad) {
  const engine = new QueryEngine();

  const store = new Store();
  if (turtleData && turtleData.trim()) {
    const prefixes = extractPrefixLines(shaclQuery);
    const fullTurtle = prefixes ? `${prefixes}\n${turtleData}` : turtleData;
    const parser = new Parser();
    const quads = parser.parse(fullTurtle);
    store.addQuads(quads);
  }

  const quadStream = await engine.queryQuads(shaclQuery, {
    sources: [store],
    destination: store,
    queryFormat: { language: 'shacl', version: '1.2' },
  });

  return new Promise((resolve, reject) => {
    quadStream.on('data', (quad) => {
      onQuad({
        subject:   quad.subject.value,
        predicate: quad.predicate.value,
        object:    quad.object.value,
        graph:     quad.graph ? quad.graph.value : '',
      });
    });
    quadStream.on('error', reject);
    quadStream.on('end', resolve);
  });
}

// Make available as a global so the IIFE bundle can be used from vanilla app.js
window.ShaclEngine = { runShaclQuery };
