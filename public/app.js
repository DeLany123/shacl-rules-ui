const { createApp, ref, computed, watch, nextTick } = Vue;

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

    function showModal(which) { modal.value = which; }

    // --- DATA block sync ---
    // Replaces (or inserts) the DATA { } block in the SHACL editor
    // whenever the Turtle textarea changes.
    function syncDataBlock(turtle) {
      const allLines = turtle.trim().split('\n');

      // Separate PREFIX declarations from actual triple lines
      const prefixLines = allLines.filter(l => /^\s*(PREFIX|@prefix)\s/i.test(l));
      const tripleLines = allLines.filter(l => l.trim() && !/^\s*(PREFIX|@prefix)\s/i.test(l) && !l.trim().startsWith('#'));

      // Sync PREFIX lines into the top of the SHACL query
      // (add any that aren't already declared there)
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
    function triggerFileUpload() {
      fileInput.value.click();
    }

    function handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        turtleData.value = e.target.result;
        // reset so the same file can be re-uploaded
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
      statusText.value = 'Running…';
      statusClass.value = 'running';

      try {
        const resp = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shaclQuery: shaclQuery.value.trim(),
            turtleData: turtleData.value.trim(),
          }),
        });

        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            let data;
            try { data = JSON.parse(line); } catch { continue; }
            rows.value.push(data);
            await nextTick();
            if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight;
          }
        }

        const errCount = rows.value.filter(r => r.error).length;
        const good = rows.value.length - errCount;
        statusText.value  = errCount > 0
          ? `Done with errors — ${good} triple${good !== 1 ? 's' : ''} inferred`
          : `Done — ${good} triple${good !== 1 ? 's' : ''} inferred`;
        statusClass.value = errCount > 0 ? 'error' : 'done';
      } catch (err) {
        statusText.value = 'Request failed: ' + err.message;
        statusClass.value = 'error';
      } finally {
        running.value = false;
      }
    }

    return {
      shaclQuery, turtleData, running, rows, neverRan, goodRows,
      statusText, statusClass, scroll, fileInput, modal,
      fmt, clearResults, runQuery, triggerFileUpload, handleFileUpload, showModal,
    };
  },
}).mount('#app');

