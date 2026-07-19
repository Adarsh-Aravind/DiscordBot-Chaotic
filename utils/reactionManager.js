// Who gets spelled at with 🇬 🇦 🇾. Toggleable at runtime via `.gay`, and
// persisted to disk so a restart doesn't undo it.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(__dirname, '..', 'data', 'reaction-targets.json');

// Loaded once at require time; every mutation writes straight back out.
const targets = load();

function load() {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (Array.isArray(saved)) return new Set(saved.filter(Boolean));
    } catch {
        // No file yet (or it's junk) — fall through to the config default.
    }
    return new Set(config.reactionUserId ? [config.reactionUserId] : []);
}

function save() {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify([...targets], null, 2));
    } catch (err) {
        console.error('[Reactions] Could not save targets:', err.message);
    }
}

module.exports = {
    isTarget(userId) {
        return targets.has(userId);
    },

    /**
     * Flips a user's status.
     * @returns {boolean} true if they're now a target, false if they were removed.
     */
    toggle(userId) {
        if (targets.delete(userId)) {
            save();
            return false;
        }
        targets.add(userId);
        save();
        return true;
    },

    list() {
        return [...targets];
    }
};
