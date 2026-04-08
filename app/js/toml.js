(function () {
    function isEscaped(text, index) {
        let slashCount = 0;
        for (let i = index - 1; i >= 0; i -= 1) {
            if (text[i] === "\\") {
                slashCount += 1;
            } else {
                break;
            }
        }
        return slashCount % 2 === 1;
    }

    function stripComment(line) {
        let inString = false;
        let quote = "";

        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];

            if ((ch === '"' || ch === "'") && !isEscaped(line, i)) {
                if (!inString) {
                    inString = true;
                    quote = ch;
                } else if (quote === ch) {
                    inString = false;
                    quote = "";
                }
            }

            if (ch === "#" && !inString) {
                return line.slice(0, i).trim();
            }
        }

        return line.trim();
    }

    function splitArrayValues(body) {
        const parts = [];
        let current = "";
        let inString = false;
        let quote = "";
        let depth = 0;

        for (let i = 0; i < body.length; i += 1) {
            const ch = body[i];

            if ((ch === '"' || ch === "'") && !isEscaped(body, i)) {
                if (!inString) {
                    inString = true;
                    quote = ch;
                } else if (quote === ch) {
                    inString = false;
                    quote = "";
                }
            }

            if (!inString) {
                if (ch === "[") depth += 1;
                if (ch === "]") depth -= 1;

                if (ch === "," && depth === 0) {
                    if (current.trim()) {
                        parts.push(current.trim());
                    }
                    current = "";
                    continue;
                }
            }

            current += ch;
        }

        if (current.trim()) {
            parts.push(current.trim());
        }

        return parts;
    }

    function parseArray(raw) {
        const body = raw.slice(1, -1).trim();
        if (!body) return [];
        return splitArrayValues(body).map(parsePrimitive);
    }

    function parsePrimitive(raw) {
        const value = raw.trim();

        if (!value.length) return "";

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            return value.slice(1, -1);
        }

        if (value === "true") return true;
        if (value === "false") return false;

        if (value.startsWith("[") && value.endsWith("]")) {
            return parseArray(value);
        }

        if (/^-?\d+$/.test(value)) {
            return parseInt(value, 10);
        }

        if (/^-?\d+\.\d+$/.test(value)) {
            return parseFloat(value);
        }

        return value;
    }

    function ensurePath(root, keys) {
        let ref = root;

        keys.forEach((key) => {
            if (
                typeof ref[key] !== "object" ||
                ref[key] === null ||
                Array.isArray(ref[key])
            ) {
                ref[key] = {};
            }
            ref = ref[key];
        });

        return ref;
    }

    function parse(text) {
        const root = {};
        let current = root;

        const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines = normalized.split("\n");

        for (const rawLine of lines) {
            const line = stripComment(rawLine);
            if (!line) continue;

            if (line.startsWith("[[") && line.endsWith("]]")) {
                const path = line
                    .slice(2, -2)
                    .trim()
                    .split(".")
                    .map((s) => s.trim())
                    .filter(Boolean);

                if (!path.length) {
                    throw new Error("Invalid array table declaration");
                }

                const parent = ensurePath(root, path.slice(0, -1));
                const key = path[path.length - 1];

                if (!Array.isArray(parent[key])) {
                    parent[key] = [];
                }

                const obj = {};
                parent[key].push(obj);
                current = obj;
                continue;
            }

            if (line.startsWith("[") && line.endsWith("]")) {
                const path = line
                    .slice(1, -1)
                    .trim()
                    .split(".")
                    .map((s) => s.trim())
                    .filter(Boolean);

                if (!path.length) {
                    throw new Error("Invalid table declaration");
                }

                current = ensurePath(root, path);
                continue;
            }

            const idx = line.indexOf("=");
            if (idx === -1) {
                throw new Error(`Invalid TOML line: ${line}`);
            }

            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();

            current[key] = parsePrimitive(value);
        }

        return root;
    }

    window.CosmosTomlParser = { parse };
})();