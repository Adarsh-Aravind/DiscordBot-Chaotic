// Crash-safe JSON files for the bot's own state.
//
// `fs.writeFileSync` truncates the file and then writes, so a process that dies
// mid-write — pm2 restarting, the box losing power — leaves a half-written file
// behind, and the next boot reads it, fails to parse it, and silently falls back
// to defaults. That is how saved state "wipes itself" on restart.
//
// Writing to a temp file and renaming it over the target avoids that: a rename
// within one directory is atomic, so a reader sees either the whole old file or
// the whole new one, never a truncated one.

const fs = require('fs');
const path = require('path');

/**
 * Read and parse a JSON file.
 *
 * @template T
 * @param {string} file
 * @param {T} fallback returned when the file is missing, unreadable or invalid
 * @param {string} [label] prefix for the warning when a file exists but is junk
 * @returns {T}
 */
function readJson(file, fallback, label = 'state') {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch {
        // Missing is the normal first-run case, not worth a word.
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw);
        // `null` parses fine but is never what a caller wants back.
        return parsed === null ? fallback : parsed;
    } catch (err) {
        // A file that exists but won't parse is worth saying out loud: it means
        // state is being dropped, which otherwise looks like it was never saved.
        console.error(`[${label}] ${file} is corrupt, ignoring it: ${err.message}`);
        return fallback;
    }
}

/**
 * Write a JSON file atomically. Never throws — losing state is not worth
 * taking the bot down for.
 *
 * @param {string} file
 * @param {unknown} value
 * @param {string} [label] prefix for the warning if it fails
 * @returns {boolean} whether it was written
 */
function writeJson(file, value, label = 'state') {
    // Unique per call, so two writers can't clobber each other's temp file and
    // rename a partial one into place.
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(temp, JSON.stringify(value, null, 2));
        fs.renameSync(temp, file);
        return true;
    } catch (err) {
        console.error(`[${label}] Could not save ${file}: ${err.message}`);
        // Don't leave the temp file lying around if the rename was what failed.
        try { fs.unlinkSync(temp); } catch { /* already gone */ }
        return false;
    }
}

module.exports = { readJson, writeJson };
