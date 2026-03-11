const fs = require('fs');

module.exports = {
    load(file) {
        try {
            if (!fs.existsSync(file)) return [];

            const content = fs.readFileSync(file, 'utf8').trim();
            if (!content) return [];

            const data = JSON.parse(content);
            return Array.isArray(data) ? data : [];
        } catch {
            console.warn('⚠ History rusak, reset');
            return [];
        }
    }
    ,

    save(file, data) {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    }
};