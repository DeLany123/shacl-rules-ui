import './engine.js';
import { createApp, ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';

const DEFAULT_SHACL =
`PREFIX : <http://example/>

DATA {
  :alice :parent :bob .
  :bob   :parent :carol .
}

RULE { ?grandParent :ancestor ?grandChild . }
WHERE {
  ?grandParent :parent ?mid .
  ?mid         :parent ?grandChild .
}`;

createApp({
  setup() {
    const shaclQuery  = ref(DEFAULT_SHACL);
    const turtleData  = ref('');
    const running     = ref(false);
    const rows        = ref([]);
    const neverRan    = ref(true);
    const statusText  = ref('Ready');
    const statusClass = ref('');
    const scroll      = ref(null);
    const fileInput   = ref(null);
    const modal       = ref(null); // 'grammar' | 'how' | null
    const execTime    = ref(null); // ms, set after run
    const provenance  = ref(null); // { triple, loading, results }

    // --- Resize handles ---
    const editorHeight  = ref(420);
    const resultsHeight = ref(260);
    const draggingEditor  = ref(false);
    const draggingResults = ref(false);

    function startResizeEditor(e) {
      draggingEditor.value = true;
      const startY = e.clientY, startH = editorHeight.value;
      const onMove = ev => { editorHeight.value = Math.max(120, startH + (ev.clientY - startY)); };
      const onUp   = () => { draggingEditor.value = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function startResizeResults(e) {
      draggingResults.value = true;
      const startY = e.clientY, startH = resultsHeight.value;
      const onMove = ev => { resultsHeight.value = Math.max(80, startH + (ev.clientY - startY)); };
      const onUp   = () => { draggingResults.value = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    // --- Examples dropdown ---
    const examples     = ref([]);
    const showExamples = ref(false);
    const examplesBtn  = ref(null);

    // --- URL state ---
    function encodeURLComponent(s) {
      return encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
    }

    function loadStateFromUrl() {
      let hash = location.hash;
      if (!hash && location.search && !location.search.includes('&state')) {
        hash = location.search.replace(/\+/g, '%20');
        history.replaceState(null, null, window.location.href.replace('?', '#').replace(/\+/g, '%20'));
      }
      const state = hash.slice(1).split('&').reduce((acc, item) => {
        const kv = item.match(/^([^=]+)=(.*)/);
        if (kv) acc[decodeURIComponent(kv[1])] = decodeURIComponent(kv[2]);
        return acc;
      }, {});
      if (state.query !== undefined) shaclQuery.value = state.query;
      if (state.data !== undefined) turtleData.value = state.data;
    }

    function saveStateToUrl() {
      const parts = [];
      parts.push('query=' + encodeURLComponent(shaclQuery.value));
      if (turtleData.value) parts.push('data=' + encodeURLComponent(turtleData.value));
      const qs = '#' + parts.join('&');
      history.replaceState(null, null, location.href.replace(/(?:#.*)?$/, qs));
    }

    onMounted(async () => {
      // Load URL state before fetching examples
      loadStateFromUrl();
      window.addEventListener('popstate', loadStateFromUrl);

      try {
        const res = await fetch('./examples/index.json');
        examples.value = await res.json();
      } catch (e) {
        console.warn('Could not load examples index:', e);
      }
      document.addEventListener('click', handleOutsideClick);

      // Save state whenever editors change
      watch([shaclQuery, turtleData], saveStateToUrl, { flush: 'post' });
    });

    onUnmounted(() => {
      document.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('popstate', loadStateFromUrl);
    });

    function handleOutsideClick(e) {
      if (examplesBtn.value && !examplesBtn.value.contains(e.target)) {
        showExamples.value = false;
      }
    }

    function toggleExamples() { showExamples.value = !showExamples.value; }

    async function loadExample(ex) {
      showExamples.value = false;
      try {
        const res = await fetch(`./examples/${ex.file}`);
        const text = await res.text();
        shaclQuery.value = text.trim();
        turtleData.value = '';
        rows.value = [];
        neverRan.value = true;
        statusText.value = `Loaded: ${ex.name}`;
        statusClass.value = '';
      } catch (e) {
        statusText.value = 'Failed to load example.';
        statusClass.value = 'error';
      }
    }

    function showModal(which) { modal.value = which; }

    // --- DATA block sync ---
    function syncDataBlock(turtle) {
      const allLines = turtle.trim().split('\n');

      const prefixLines = allLines.filter(l => /^\s*(PREFIX|@prefix)\s/i.test(l));
      const tripleLines = allLines.filter(l => l.trim() && !/^\s*(PREFIX|@prefix)\s/i.test(l) && !l.trim().startsWith('#'));

      for (const prefixLine of prefixLines) {
        const match = prefixLine.match(/PREFIX\s+(\S+)\s+/i);
        if (match && !shaclQuery.value.includes(match[1])) {
          shaclQuery.value = prefixLine.trim() + '\n' + shaclQuery.value;
        }
      }

      const inner = tripleLines.length
        ? '\n  ' + tripleLines.join('\n  ') + '\n'
        : '\n';
      const dataBlock = `DATA {${inner}}`;

      if (/DATA\s*\{[\s\S]*?\}/.test(shaclQuery.value)) {
        shaclQuery.value = shaclQuery.value.replace(/DATA\s*\{[\s\S]*?\}/, dataBlock);
      } else {
        const queryLines = shaclQuery.value.split('\n');
        let insertAt = 0;
        for (let i = 0; i < queryLines.length; i++) {
          if (queryLines[i].trim().toUpperCase().startsWith('PREFIX')) insertAt = i + 1;
        }
        queryLines.splice(insertAt, 0, '', dataBlock);
        shaclQuery.value = queryLines.join('\n');
      }
    }

    watch(turtleData, (val) => syncDataBlock(val));

    // --- File upload ---
    function triggerFileUpload() { fileInput.value.click(); }

    function handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        turtleData.value = e.target.result;
        event.target.value = '';
      };
      reader.readAsText(file);
    }

    const goodRows = computed(() => rows.value.filter(r => !r.error).length);

    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fmt(val) {
      if (!val) return '<em style="color:#475569">default graph</em>';
      if (/^(https?:|urn:)/.test(val))
        return `<span class="uri">&lt;${esc(val)}&gt;</span>`;
      return `<span class="literal">${esc(val)}</span>`;
    }

    function clearResults() {
      rows.value = [];
      neverRan.value = true;
      statusText.value = 'Ready';
      statusClass.value = '';
      execTime.value = null;
      provenance.value = null;
    }

    function downloadTurtle() {
      const good = rows.value.filter(r => !r.error);
      if (!good.length) return;

      // Collect prefix declarations from the SHACL query
      const prefixLines = shaclQuery.value
        .split('\n')
        .filter(l => /^\s*PREFIX\s+/i.test(l))
        .map(l => l.trim());

      // Build a prefix map for compacting IRIs
      const prefixMap = {};
      for (const line of prefixLines) {
        const m = line.match(/PREFIX\s+(\S+)\s*<([^>]+)>/i);
        if (m) prefixMap[m[1]] = m[2];  // e.g. {"ex:": "http://example/"}
      }

      function compact(iri) {
        if (!iri) return '[]'; // blank/default graph — skip
        for (const [prefix, base] of Object.entries(prefixMap)) {
          if (iri.startsWith(base)) return prefix + iri.slice(base.length);
        }
        return `<${iri}>`;
      }

      function termToTurtle(val) {
        if (!val) return null;
        if (/^(https?:|urn:|[a-z][a-z0-9+\-.]*:\/\/)/.test(val)) return compact(val);
        // literal — wrap in quotes; detect datatype suffix
        if (val.includes('^^')) {
          const [lit, dt] = val.split('^^');
          return `"${lit}"^^${compact(dt)}`;
        }
        return `"${val.replace(/"/g, '\\"')}"`;
      }

      const tripleLines = good.map(r => {
        const s = termToTurtle(r.subject);
        const p = termToTurtle(r.predicate);
        const o = termToTurtle(r.object);
        if (!s || !p || !o) return null;
        return `${s} ${p} ${o} .`;
      }).filter(Boolean);

      const ttl = [
        '# Inferred triples exported from SHACL Rules Inference UI',
        '',
        ...prefixLines,
        prefixLines.length ? '' : null,
        ...tripleLines,
      ].filter(l => l !== null).join('\n') + '\n';

      const blob = new Blob([ttl], { type: 'text/turtle' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'inferred.ttl';
      a.click();
      URL.revokeObjectURL(url);
    }

    async function clickRow(row) {
      if (row.error) return;
      provenance.value = { triple: row, loading: true, results: [] };
      try {
        const results = await window.ShaclEngine.explainTriple(shaclQuery.value.trim(), row);
        provenance.value = { triple: row, loading: false, results };
      } catch (e) {
        provenance.value = { triple: row, loading: false, results: [], error: e.message };
      }
    }

    async function runQuery() {
      if (!shaclQuery.value.trim()) {
        statusText.value = 'Please enter a SHACL query.';
        statusClass.value = 'error';
        return;
      }

      running.value = true;
      rows.value = [];
      neverRan.value = false;
      execTime.value = null;
      provenance.value = null;
      statusText.value = 'Running…';
      statusClass.value = 'running';
      const t0 = performance.now();

      try {
        await window.ShaclEngine.runShaclQuery(
          { shaclQuery: shaclQuery.value.trim(), turtleData: turtleData.value },
          async (quad) => {
            rows.value.push(quad);
            await nextTick();
            if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight;
          }
        );

        const errCount = rows.value.filter(r => r.error).length;
        const good = rows.value.length - errCount;
        execTime.value = Math.round(performance.now() - t0);
        statusText.value  = errCount > 0
          ? `Done with errors — ${good} triple${good !== 1 ? 's' : ''} inferred`
          : `Done — ${good} triple${good !== 1 ? 's' : ''} inferred`;
        statusClass.value = errCount > 0 ? 'error' : 'done';
      } catch (err) {
        statusText.value = 'Inference failed: ' + err.message;
        statusClass.value = 'error';
        console.error(err);
      } finally {
        running.value = false;
      }
    }

    return {
      shaclQuery, turtleData, running, rows, neverRan, goodRows,
      statusText, statusClass, scroll, fileInput, modal,
      execTime, provenance,
      editorHeight, resultsHeight, draggingEditor, draggingResults,
      startResizeEditor, startResizeResults,
      examples, showExamples, examplesBtn,
      fmt, clearResults, runQuery, triggerFileUpload, handleFileUpload,
      showModal, toggleExamples, loadExample, clickRow, downloadTurtle,
    };
  },
}).mount('#app');


