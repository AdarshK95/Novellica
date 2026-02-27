/**
 * diff-engine.js — Pure diff logic module (no DOM dependencies)
 * Uses LCS-based comparison for prose-friendly sentence/word diffs.
 */

const DiffEngine = (() => {

    /**
     * Split text into sentences (default) or words.
     */
    function tokenize(text, wordLevel = false) {
        if (!text) return [];
        if (wordLevel) {
            return text.split(/(\s+)/).filter(t => t.length > 0);
        }
        // Sentence-level: split on sentence-ending punctuation or newlines, keeping delimiters
        const tokens = [];
        let current = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            current += ch;
            if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
                tokens.push(current);
                current = '';
            } else if (ch === '\n') {
                tokens.push(current);
                current = '';
            }
        }
        if (current.length > 0) tokens.push(current);
        return tokens;
    }

    /**
     * Normalize text for comparison when ignoring formatting.
     */
    function normalizeFormatting(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s.,!?;:'"()\-]/g, '')
            .trim();
    }

    /**
     * LCS table for two token arrays.
     */
    function lcsTable(a, b, normalize) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const av = normalize ? normalizeFormatting(a[i - 1]) : a[i - 1];
                const bv = normalize ? normalizeFormatting(b[j - 1]) : b[j - 1];
                if (av === bv) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        return dp;
    }

    /**
     * Backtrack through LCS table to produce diff operations.
     */
    function backtrack(dp, a, b, normalize) {
        const ops = [];
        let i = a.length, j = b.length;

        while (i > 0 || j > 0) {
            const av = i > 0 ? (normalize ? normalizeFormatting(a[i - 1]) : a[i - 1]) : null;
            const bv = j > 0 ? (normalize ? normalizeFormatting(b[j - 1]) : b[j - 1]) : null;

            if (i > 0 && j > 0 && av === bv) {
                // If text differs but normalized is equal → formatting change
                if (a[i - 1] !== b[j - 1]) {
                    ops.unshift({ type: 'modify', original: a[i - 1], modified: b[j - 1] });
                } else {
                    ops.unshift({ type: 'equal', text: a[i - 1] });
                }
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                ops.unshift({ type: 'add', modified: b[j - 1] });
                j--;
            } else {
                ops.unshift({ type: 'delete', original: a[i - 1] });
                i--;
            }
        }
        return ops;
    }

    /**
     * Main compare function.
     * @param {string} original
     * @param {string} modified
     * @param {Object} opts - { wordLevel, ignoreFormatting }
     * @returns {Array} diff operations
     */
    function compare(original, modified, opts = {}) {
        const wordLevel = opts.wordLevel || false;
        const ignoreFormat = opts.ignoreFormatting || false;

        const a = tokenize(original || '', wordLevel);
        const b = tokenize(modified || '', wordLevel);

        const dp = lcsTable(a, b, ignoreFormat);
        return backtrack(dp, a, b, ignoreFormat);
    }

    /**
     * Group nearby edits with a context radius.
     * Returns array of groups: { type: 'group'|'unchanged', ops: [...] }
     */
    function groupEdits(ops, radius = 2) {
        if (!ops || ops.length === 0) return [];

        const groups = [];
        let currentGroup = null;
        let unchangedBuffer = [];

        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const isChange = op.type !== 'equal';

            if (isChange) {
                // Flush some of the unchanged buffer as context
                if (unchangedBuffer.length > 0) {
                    const contextOps = unchangedBuffer.slice(-radius);
                    const hiddenOps = unchangedBuffer.slice(0, -radius);

                    if (hiddenOps.length > 0 && currentGroup) {
                        groups.push(currentGroup);
                        currentGroup = null;
                    }
                    if (hiddenOps.length > 0) {
                        groups.push({ type: 'unchanged', ops: hiddenOps, collapsed: true });
                    }

                    if (!currentGroup) currentGroup = { type: 'group', ops: [] };
                    currentGroup.ops.push(...contextOps);
                    unchangedBuffer = [];
                }

                if (!currentGroup) currentGroup = { type: 'group', ops: [] };
                currentGroup.ops.push(op);
            } else {
                unchangedBuffer.push(op);

                // If we accumulate too many unchanged, flush the group
                if (unchangedBuffer.length > radius * 2 && currentGroup) {
                    currentGroup.ops.push(...unchangedBuffer.slice(0, radius));
                    groups.push(currentGroup);
                    currentGroup = null;
                    unchangedBuffer = unchangedBuffer.slice(radius);
                }
            }
        }

        // Flush remaining
        if (currentGroup) {
            currentGroup.ops.push(...unchangedBuffer);
            groups.push(currentGroup);
        } else if (unchangedBuffer.length > 0) {
            groups.push({ type: 'unchanged', ops: unchangedBuffer, collapsed: true });
        }

        return groups;
    }

    /**
     * Compute summary statistics from diff ops.
     */
    function stats(ops) {
        let additions = 0, deletions = 0, modifications = 0;
        let sentencesChanged = 0, paragraphsChanged = 0;

        for (const op of ops) {
            if (op.type === 'add') { additions++; sentencesChanged++; }
            else if (op.type === 'delete') { deletions++; sentencesChanged++; }
            else if (op.type === 'modify') { modifications++; sentencesChanged++; }

            // Count paragraph changes (ops containing newlines)
            const text = op.original || op.modified || op.text || '';
            if (text.includes('\n') && op.type !== 'equal') paragraphsChanged++;
        }

        return { additions, deletions, modifications, sentencesChanged, paragraphsChanged };
    }

    return { compare, groupEdits, stats, normalizeFormatting };
})();
