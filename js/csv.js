// Minimal RFC 4180 CSV reader/writer (no dependencies, no DOM).

/**
 * Guess the delimiter from the first non-empty line (outside quotes).
 * @param {string} text
 * @returns {string}
 */
export function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== '') || '';
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of [';', '\t']) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

/**
 * Parse CSV text into rows of cells. Handles quoted fields, escaped quotes (""),
 * embedded newlines, CRLF/LF, a leading BOM and a missing trailing newline.
 * Blank lines are skipped.
 * @param {string} text
 * @param {string} [delimiter] auto-detected when omitted
 * @returns {string[][]}
 */
export function parseCsvRows(text, delimiter) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const delim = delimiter || detectCsvDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let wasQuoted = false;

  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => {
    endCell();
    // skip rows that are entirely empty (blank lines)
    if (!(row.length === 1 && row[0] === '' )) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '' && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delim) {
      endCell();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0 || wasQuoted) endRow();
  return rows;
}

/**
 * Parse CSV text into { headers, rows } where each row is an object keyed by header.
 * Headers are trimmed; duplicate headers get a numeric suffix ("name", "name#2").
 * Rows shorter than the header are padded with empty strings.
 * @param {string} text
 * @param {string} [delimiter]
 * @returns {{headers: string[], rows: Object<string,string>[], delimiter: string}}
 */
export function parseCsvTable(text, delimiter) {
  const delim = delimiter || detectCsvDelimiter(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  const raw = parseCsvRows(text, delim);
  if (raw.length === 0) return { headers: [], rows: [], delimiter: delim };
  const seen = {};
  const headers = raw[0].map(h => {
    const base = h.trim();
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base}#${seen[base]}`;
  });
  const rows = raw.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    return obj;
  });
  return { headers, rows, delimiter: delim };
}

/**
 * Serialise rows to CSV (LF line endings, values quoted only when needed).
 * @param {Array<Object>} rows
 * @param {string[]} headers column order
 * @returns {string}
 */
export function writeCsv(rows, headers) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n') + '\n';
}
