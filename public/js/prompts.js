/**
 * prompts.js — Client-side prompt template store
 * Loads from server and provides lookup functionality.
 */

const Prompts = (() => {
    let _prompts = [];
    let _loaded = false;

    /**
     * Fetch prompt list from server.
     * @param {boolean} force - reload even if already loaded
     */
    async function load(force = false) {
        if (_loaded && !force) return _prompts;
        try {
            const res = await fetch('/api/prompts');
            if (!res.ok) throw new Error('Failed to load prompts');
            _prompts = await res.json();
            _loaded = true;
        } catch (err) {
            console.error('Prompts.load error:', err);
            _prompts = [];
        }
        return _prompts;
    }

    /**
     * Get full prompt body by slug.
     */
    async function getBody(slug) {
        try {
            const res = await fetch(`/api/prompts/${slug}`);
            if (!res.ok) throw new Error('Prompt not found');
            const data = await res.json();
            return data.body || '';
        } catch (err) {
            console.error('Prompts.getBody error:', err);
            return '';
        }
    }

    /**
     * List all prompts (name + slug + description).
     */
    function list() {
        return _prompts;
    }

    function isLoaded() { return _loaded; }

    return { load, getBody, list, isLoaded };
})();
