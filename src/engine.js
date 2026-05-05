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

// Parse PREFIX declarations into a map { "prefix:" -> "baseIRI" }
function parsePrefixMap(shaclQuery) {
  const map = {};
  const re = /^\s*PREFIX\s+(\S+)\s*<([^>]+)>/gim;
  let m;
  while ((m = re.exec(shaclQuery)) !== null) map[m[1]] = m[2];
  return map;
}

// Extract content between matching braces starting at the opening brace position
function extractBraceContent(str, openPos) {
  let depth = 0, i = openPos;
  while (i < str.length) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') { depth--; if (depth === 0) return str.slice(openPos + 1, i); }
    i++;
  }
  return null;
}

// Parse all RULE { head } WHERE { body } blocks from a SHACL query
export function parseRules(shaclQuery) {
  const rules = [];
  const re = /RULE\s*\{/gi;
  let m;
  while ((m = re.exec(shaclQuery)) !== null) {
    const headStart = m.index + m[0].length - 1;
    const head = extractBraceContent(shaclQuery, headStart);
    if (head === null) continue;
    const afterHead = headStart + head.length + 2;
    const whereRe = /\s*WHERE\s*\{/gi;
    whereRe.lastIndex = afterHead;
    const wm = whereRe.exec(shaclQuery);
    if (!wm) continue;
    const bodyStart = wm.index + wm[0].length - 1;
    const body = extractBraceContent(shaclQuery, bodyStart);
    if (body === null) continue;
    rules.push({
      head: head.trim().replace(/\.$/, '').trim(),
      where: body.trim(),
      text: `RULE { ${head.trim()} }\nWHERE {\n  ${body.trim()}\n}`,
    });
  }
  return rules;
}

// Resolve a prefixed/IRI token to a plain IRI string, or return null if unknown
function resolveToken(token, prefixMap) {
  if (token.startsWith('<') && token.endsWith('>')) return { iri: token.slice(1, -1) };
  const colon = token.indexOf(':');
  if (colon >= 0) {
    const prefix = token.slice(0, colon + 1);
    if (prefixMap[prefix]) return { iri: prefixMap[prefix] + token.slice(colon + 1) };
  }
  // plain literal token (true, 42, "text", etc.)
  return { literal: token.replace(/^"|"$/g, '') };
}

// Try to match a rule head (3-token pattern) against a concrete triple.
// Returns a bindings map { varName: {value, isIRI} } or null on mismatch.
function matchHead(headStr, triple, prefixMap) {
  const tokens = headStr.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (tokens.length < 3) return null;
  const positions = ['subject', 'predicate', 'object'];
  const bindings = {};
  for (let i = 0; i < 3; i++) {
    const token = tokens[i];
    const tripleVal = triple[positions[i]];
    if (token.startsWith('?')) {
      const isIRI = /^(https?:|urn:|[a-z][a-z0-9+\-.]*:\/\/)/.test(tripleVal);
      bindings[token.slice(1)] = { value: tripleVal, isIRI };
    } else {
      const resolved = resolveToken(token, prefixMap);
      const expected = resolved.iri ?? resolved.literal;
      if (expected !== tripleVal) return null;
    }
  }
  return bindings;
}

// Module-level state: store and query are saved after each run for provenance queries
let lastStore = null;
let lastShaclQuery = '';

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
    quadStream.on('end', () => {
      lastStore = store;
      lastShaclQuery = shaclQuery;
      resolve();
    });
  });
}

// Given a clicked triple, return provenance: which rules could have produced it
// and what data bindings were used.
export async function explainTriple(shaclQuery, triple) {
  if (!lastStore) return [];
  const prefixMap = parsePrefixMap(shaclQuery);
  const prefixLines = extractPrefixLines(shaclQuery);
  const rules = parseRules(shaclQuery);
  const results = [];

  for (const rule of rules) {
    const bindings = matchHead(rule.head, triple, prefixMap);
    if (!bindings) continue;

    // Build BIND statements to inject head variable bindings into the WHERE clause
    const binds = Object.entries(bindings).map(([v, { value, isIRI }]) =>
      isIRI ? `BIND(<${value}> AS ?${v})` : `BIND("${value}" AS ?${v})`
    ).join(' ');

    const sparql = `${prefixLines}\nSELECT * WHERE { ${binds} ${rule.where} }`;
    try {
      const engine2 = new QueryEngine();
      const stream = await engine2.queryBindings(sparql, { sources: [lastStore] });
      const rows = await stream.toArray();
      const bindingRows = rows.map(row => {
        const obj = {};
        for (const [key, val] of row) obj[key.value] = val.value;
        return obj;
      });
      results.push({ rule, bindingRows });
    } catch (e) {
      results.push({ rule, bindingRows: [], error: e.message });
    }
  }
  return results;
}

// Make available as a global so the IIFE bundle can be used from vanilla app.js
window.ShaclEngine = { runShaclQuery, explainTriple, parseRules };
