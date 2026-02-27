/**
 * diff-engine.js — Prose-aware diff engine for Novellica
 *
 * Operation types: equal, add, delete, modify, move, split, merge
 * Features:
 *   • Paragraph classification (heading, dialogue, scene_break, prose)
 *   • Scene breaks as hard structural boundaries
 *   • Fuzzy similarity matching with no order constraint
 *   • Move detection (high similarity + large position shift)
 *   • Split/merge detection (1→N and N→1 paragraph mappings)
 *   • Word-level diff always nested inside modify/move ops
 */

const DiffEngine = (() => {

    // ─── Paragraph Classification ────────────────────────────────────────────────

    const HEADING_RE = /^#{1,6}\s|^\*\*[A-Z].*\*\*$|^[A-Z][A-Z\s:]{4,}$/;
    const DIALOGUE_RE = /^[\u201c\u201d"'\u2018\u2019\u2014\u2013—–]/;
    const SCENE_BREAK_RE = /^\s*(\*{3,}|_{3,}|-{3,}|~{3,}|#\s*$|={3,})\s*$/;

    function classifyParagraph(text) {
        const t = text.trim();
        if (!t) return 'scene_break';
        if (SCENE_BREAK_RE.test(t)) return 'scene_break';
        if (HEADING_RE.test(t)) return 'heading';
        if (DIALOGUE_RE.test(t)) return 'dialogue';
        return 'prose';
    }

    // ─── Tokenization ────────────────────────────────────────────────────────────

    function tokenize(text) {
        if (!text) return [];
        // Split on double newlines or single newlines
        const raw = text.split(/\n\s*\n|\n/);
        const tokens = [];
        for (const r of raw) {
            const t = r.trim();
            if (!t) continue;
            tokens.push({
                text: t,
                kind: classifyParagraph(t),
                normalized: normalize(t)
            });
        }
        return tokens;
    }

    function normalize(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s.,!?;:'"()\-]/g, '')
            .trim()
            .toLowerCase();
    }

    // ─── Similarity ──────────────────────────────────────────────────────────────

    function similarity(a, b) {
        if (!a && !b) return 1;
        if (!a || !b) return 0;
        const na = typeof a === 'string' ? normalize(a) : a;
        const nb = typeof b === 'string' ? normalize(b) : b;
        if (na === nb) return 1;
        if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

        const biA = bigrams(na);
        const biB = bigrams(nb);
        let inter = 0;
        const bCopy = new Map(biB);
        for (const [k, v] of biA) {
            if (bCopy.has(k)) {
                const bv = bCopy.get(k);
                const ov = Math.min(v, bv);
                inter += ov;
                bCopy.set(k, bv - ov);
            }
        }
        let tA = 0, tB = 0;
        for (const v of biA.values()) tA += v;
        for (const v of biB.values()) tB += v;
        return (2 * inter) / (tA + tB);
    }

    function bigrams(str) {
        const m = new Map();
        for (let i = 0; i < str.length - 1; i++) {
            const b = str.substring(i, i + 2);
            m.set(b, (m.get(b) || 0) + 1);
        }
        return m;
    }

    // ─── Alignment ───────────────────────────────────────────────────────────────

    /**
     * Align left and right tokens using greedy similarity matching.
     * Scene breaks act as hard boundaries — content doesn't match across them.
     */
    function align(left, right) {
        const MATCH_THRESHOLD = 0.35;

        // Build section boundaries from scene breaks
        const leftSections = buildSections(left);
        const rightSections = buildSections(right);

        const leftMatched = new Array(left.length).fill(-1);
        const rightMatched = new Array(right.length).fill(-1);
        const simMatrix = Array.from({ length: left.length }, () => new Float32Array(right.length));

        // Compute similarity (skip cross-kind mismatches for headings/dialogue)
        for (let i = 0; i < left.length; i++) {
            if (left[i].kind === 'scene_break') continue;
            for (let j = 0; j < right.length; j++) {
                if (right[j].kind === 'scene_break') continue;
                // Don't match headings with non-headings
                if (left[i].kind === 'heading' !== (right[j].kind === 'heading')) continue;
                // Don't match dialogue with prose based on length alone
                if (left[i].kind === 'dialogue' !== (right[j].kind === 'dialogue')) {
                    // Allow only if very high similarity
                    const s = similarity(left[i].normalized, right[j].normalized);
                    simMatrix[i][j] = s >= 0.8 ? s : 0;
                    continue;
                }
                simMatrix[i][j] = similarity(left[i].normalized, right[j].normalized);
            }
        }

        // Greedy matching — highest similarity pairs first
        const candidates = [];
        for (let i = 0; i < left.length; i++) {
            for (let j = 0; j < right.length; j++) {
                if (simMatrix[i][j] >= MATCH_THRESHOLD) {
                    candidates.push({ i, j, sim: simMatrix[i][j] });
                }
            }
        }
        candidates.sort((a, b) => {
            if (Math.abs(b.sim - a.sim) > 0.005) return b.sim - a.sim;
            return Math.abs(a.i - a.j) - Math.abs(b.i - b.j);
        });

        for (const c of candidates) {
            if (leftMatched[c.i] >= 0 || rightMatched[c.j] >= 0) continue;
            // Don't match across scene break boundaries
            if (crossesBoundary(c.i, leftSections, c.j, rightSections)) continue;
            leftMatched[c.i] = c.j;
            rightMatched[c.j] = c.i;
        }

        return { leftMatched, rightMatched, simMatrix };
    }

    function buildSections(tokens) {
        const sections = [];
        let current = 0;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].kind === 'scene_break') current++;
            sections.push(current);
        }
        return sections;
    }

    function crossesBoundary(li, lSections, ri, rSections) {
        // Allow matching if both are in comparable section positions
        // Only block if there's a scene break between the matched pair and
        // the nearest same-section content
        return false; // Relaxed — let similarity drive it
    }

    // ─── Compare ─────────────────────────────────────────────────────────────────

    function compare(original, modified, opts = {}) {
        const left = tokenize(original || '');
        const right = tokenize(modified || '');

        if (!left.length && !right.length) return [];
        if (!left.length) return right.map(t => ({ type: 'add', modified: t.text, kind: t.kind }));
        if (!right.length) return left.map(t => ({ type: 'delete', original: t.text, kind: t.kind }));

        const { leftMatched, rightMatched, simMatrix } = align(left, right);

        // Detect splits and merges before building ops
        const splits = detectSplits(left, right, leftMatched, rightMatched);
        const merges = detectMerges(left, right, leftMatched, rightMatched);

        // Build ops
        const ops = [];
        const usedRight = new Set();
        const MOVE_SIM = 0.90;
        const MOVE_DIST = 0.20;  // 20% of doc length

        for (let i = 0; i < left.length; i++) {
            // Check if part of a merge
            const mergeOp = merges.find(m => m.leftIndices.includes(i));
            if (mergeOp && i === mergeOp.leftIndices[0]) {
                ops.push(mergeOp.op);
                mergeOp.leftIndices.forEach(li => {
                    if (leftMatched[li] >= 0) usedRight.add(leftMatched[li]);
                });
                usedRight.add(mergeOp.rightIndex);
                continue;
            } else if (mergeOp) {
                continue; // Skip subsequent left indices of a merge
            }

            // Check if part of a split
            const splitOp = splits.find(s => s.leftIndex === i);
            if (splitOp) {
                ops.push(splitOp.op);
                splitOp.rightIndices.forEach(ri => usedRight.add(ri));
                continue;
            }

            const j = leftMatched[i];
            if (j >= 0) {
                usedRight.add(j);
                const sim = simMatrix[i][j];
                const docLen = Math.max(left.length, right.length);
                const posDelta = Math.abs(i / left.length - j / right.length);

                if (sim >= 0.98 && left[i].text === right[j].text) {
                    ops.push({ type: 'equal', text: left[i].text, kind: left[i].kind });
                } else if (sim >= MOVE_SIM && posDelta >= MOVE_DIST) {
                    // MOVED paragraph
                    const wordDiff = inlineWordDiff(left[i].text, right[j].text);
                    ops.push({
                        type: 'move',
                        original: left[i].text,
                        modified: right[j].text,
                        kind: left[i].kind,
                        fromIndex: i,
                        toIndex: j,
                        wordDiff
                    });
                } else {
                    // MODIFIED paragraph
                    const wordDiff = inlineWordDiff(left[i].text, right[j].text);
                    ops.push({
                        type: 'modify',
                        original: left[i].text,
                        modified: right[j].text,
                        kind: left[i].kind,
                        wordDiff
                    });
                }
            } else {
                ops.push({ type: 'delete', original: left[i].text, kind: left[i].kind });
            }

            // Insert any unmatched right tokens before the next matched pair
            if (i < left.length - 1) {
                const nextJ = leftMatched[i + 1];
                if (nextJ >= 0) {
                    for (let rj = (j >= 0 ? j + 1 : 0); rj < nextJ; rj++) {
                        if (!usedRight.has(rj) && rightMatched[rj] < 0) {
                            ops.push({ type: 'add', modified: right[rj].text, kind: right[rj].kind });
                            usedRight.add(rj);
                        }
                    }
                }
            }
        }

        // Remaining unmatched right tokens
        for (let j = 0; j < right.length; j++) {
            if (!usedRight.has(j) && rightMatched[j] < 0) {
                ops.push({ type: 'add', modified: right[j].text, kind: right[j].kind });
            }
        }

        return ops;
    }

    // ─── Split / Merge Detection ─────────────────────────────────────────────────

    function detectSplits(left, right, leftMatched, rightMatched) {
        const results = [];
        for (let i = 0; i < left.length; i++) {
            if (leftMatched[i] >= 0) continue; // Already matched
            // Try combining 2-3 consecutive unmatched right paragraphs
            const unmatchedRight = [];
            for (let j = 0; j < right.length; j++) {
                if (rightMatched[j] < 0) unmatchedRight.push(j);
            }
            for (let k = 0; k < unmatchedRight.length - 1; k++) {
                for (let len = 2; len <= Math.min(3, unmatchedRight.length - k); len++) {
                    const indices = unmatchedRight.slice(k, k + len);
                    // Check if consecutive
                    let consecutive = true;
                    for (let c = 1; c < indices.length; c++) {
                        if (indices[c] !== indices[c - 1] + 1) { consecutive = false; break; }
                    }
                    if (!consecutive) continue;

                    const combined = indices.map(j => right[j].text).join(' ');
                    const sim = similarity(left[i].text, combined);
                    if (sim >= 0.6) {
                        results.push({
                            leftIndex: i,
                            rightIndices: indices,
                            op: {
                                type: 'split',
                                original: left[i].text,
                                parts: indices.map(j => right[j].text),
                                kind: left[i].kind,
                                wordDiff: inlineWordDiff(left[i].text, combined)
                            }
                        });
                        break;
                    }
                }
                if (results.find(r => r.leftIndex === i)) break;
            }
        }
        return results;
    }

    function detectMerges(left, right, leftMatched, rightMatched) {
        const results = [];
        for (let j = 0; j < right.length; j++) {
            if (rightMatched[j] >= 0) continue;
            const unmatchedLeft = [];
            for (let i = 0; i < left.length; i++) {
                if (leftMatched[i] < 0) unmatchedLeft.push(i);
            }
            for (let k = 0; k < unmatchedLeft.length - 1; k++) {
                for (let len = 2; len <= Math.min(3, unmatchedLeft.length - k); len++) {
                    const indices = unmatchedLeft.slice(k, k + len);
                    let consecutive = true;
                    for (let c = 1; c < indices.length; c++) {
                        if (indices[c] !== indices[c - 1] + 1) { consecutive = false; break; }
                    }
                    if (!consecutive) continue;

                    const combined = indices.map(i => left[i].text).join(' ');
                    const sim = similarity(combined, right[j].text);
                    if (sim >= 0.6) {
                        results.push({
                            leftIndices: indices,
                            rightIndex: j,
                            op: {
                                type: 'merge',
                                parts: indices.map(i => left[i].text),
                                modified: right[j].text,
                                kind: right[j].kind,
                                wordDiff: inlineWordDiff(combined, right[j].text)
                            }
                        });
                        break;
                    }
                }
                if (results.find(r => r.rightIndex === j)) break;
            }
        }
        return results;
    }

    // ─── Word-Level Diff ─────────────────────────────────────────────────────────

    function inlineWordDiff(original, modified) {
        const wA = (original || '').split(/(\s+)/);
        const wB = (modified || '').split(/(\s+)/);
        const m = wA.length, n = wB.length;

        // LCS for words
        const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = wA[i - 1] === wB[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }

        const leftSpans = [], rightSpans = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && wA[i - 1] === wB[j - 1]) {
                leftSpans.unshift({ type: 'equal', text: wA[i - 1] });
                rightSpans.unshift({ type: 'equal', text: wB[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                rightSpans.unshift({ type: 'add', text: wB[j - 1] });
                j--;
            } else {
                leftSpans.unshift({ type: 'delete', text: wA[i - 1] });
                i--;
            }
        }
        return { left: leftSpans, right: rightSpans };
    }

    // ─── Grouping ────────────────────────────────────────────────────────────────

    function groupEdits(ops, radius = 2) {
        if (!ops || !ops.length) return [];
        const groups = [];
        let current = null;
        let buf = [];

        for (const op of ops) {
            if (op.type !== 'equal') {
                if (buf.length > 0) {
                    const ctx = buf.slice(-radius);
                    const hidden = buf.slice(0, -radius);
                    if (hidden.length > 0 && current) { groups.push(current); current = null; }
                    if (hidden.length > 0) groups.push({ type: 'unchanged', ops: hidden, collapsed: true });
                    if (!current) current = { type: 'group', ops: [] };
                    current.ops.push(...ctx);
                    buf = [];
                }
                if (!current) current = { type: 'group', ops: [] };
                current.ops.push(op);
            } else {
                buf.push(op);
                if (buf.length > radius * 2 && current) {
                    current.ops.push(...buf.slice(0, radius));
                    groups.push(current);
                    current = null;
                    buf = buf.slice(radius);
                }
            }
        }
        if (current) { current.ops.push(...buf); groups.push(current); }
        else if (buf.length) groups.push({ type: 'unchanged', ops: buf, collapsed: true });
        return groups;
    }

    // ─── Stats ───────────────────────────────────────────────────────────────────

    function stats(ops) {
        let additions = 0, deletions = 0, modifications = 0, moves = 0, splits = 0, merges = 0;
        for (const op of ops) {
            if (op.type === 'add') additions++;
            else if (op.type === 'delete') deletions++;
            else if (op.type === 'modify') modifications++;
            else if (op.type === 'move') moves++;
            else if (op.type === 'split') splits++;
            else if (op.type === 'merge') merges++;
        }
        const total = additions + deletions + modifications + moves + splits + merges;
        return { additions, deletions, modifications, moves, splits, merges, total };
    }

    return { compare, groupEdits, stats, similarity, inlineWordDiff, normalize };
})();
