// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually
import "./_dnt.polyfills.js";

import * as dntShim from "./_dnt.shims.js";


class Env {
    bindings;
    outer;
    exports;
    constructor(bindings = {}, outer = null){
        this.bindings = bindings;
        this.outer = outer;
    }
    get(key) {
        if (key in this.bindings) {
            return this.bindings[key];
        } else if (this.outer) {
            return this.outer.get(key);
        } else {
            throw new Error(`Symbol '${key}' not found`);
        }
    }
    set(key, value) {
        this.bindings[key] = value;
    }
}
const baseEnv = new Env();
function makeNil() {
    return {
        type: "nil"
    };
}
function makeSymbol(name) {
    return {
        type: "symbol",
        name
    };
}
function makeList(value) {
    return {
        type: "list",
        value
    };
}
function makeNumber(n) {
    return {
        type: "number",
        value: n
    };
}
function makeString(s) {
    return {
        type: "string",
        value: s
    };
}
function makeBoolean(b) {
    return {
        type: "boolean",
        value: b
    };
}
function makeEnumCase(name) {
    return {
        type: "enum-case",
        name
    };
}
function parse(input) {
    const result = [];
    let i = 0;
    const len = input.length;
    function skipWs() {
        while(i < len){
            const ch = input[i];
            if (ch === ";") {
                while(i < len && input[i] !== "\n"){
                    i++;
                }
            } else if (/\s/.test(ch)) {
                i++;
            } else {
                break;
            }
        }
    }
    function readString() {
        const startPos = i;
        i++;
        let buf = "";
        const parts = [];
        let interpolation = false;
        while(i < len){
            if (input[i] === '"') {
                i++;
                break;
            }
            if (input[i] === "\\" && i + 1 < len && input[i + 1] === "(") {
                interpolation = true;
                if (buf !== "") {
                    const strNode = makeString(buf);
                    parts.push(strNode);
                }
                buf = "";
                i += 2;
                let exprStr = "";
                let parenCount = 1;
                while(i < len && parenCount > 0){
                    const c = input[i];
                    if (c === "(") {
                        parenCount++;
                    } else if (c === ")") {
                        parenCount--;
                        if (parenCount === 0) {
                            i++;
                            break;
                        }
                    }
                    exprStr += c;
                    i++;
                }
                const subAST = parse(exprStr);
                if (subAST.length > 0) {
                    parts.push(subAST[0]);
                }
            } else {
                buf += input[i];
                i++;
            }
        }
        const endPos = i;
        if (!interpolation) {
            const node = makeString(buf);
            node.start = startPos;
            node.end = endPos;
            return node;
        } else {
            if (buf !== "") {
                parts.push(makeString(buf));
            }
            const listNode = makeList([
                makeSymbol("str"),
                ...parts
            ]);
            listNode.start = startPos;
            listNode.end = endPos;
            return listNode;
        }
    }
    function readSymbolOrNumber() {
        const startPos = i;
        while(i < len && !/\s/.test(input[i]) && ![
            "(",
            ")",
            "[",
            "]",
            ";"
        ].includes(input[i])){
            i++;
        }
        const endPos = i;
        const token = input.slice(startPos, endPos);
        if (token.startsWith(".")) {
            const node = makeEnumCase(token.slice(1));
            node.start = startPos;
            node.end = endPos;
            return node;
        }
        if (/^[+\-]?\d+(\.\d+)?$/.test(token)) {
            const node = makeNumber(parseFloat(token));
            node.start = startPos;
            node.end = endPos;
            return node;
        }
        if (token === "true") {
            const node = makeBoolean(true);
            node.start = startPos;
            node.end = endPos;
            return node;
        }
        if (token === "false") {
            const node = makeBoolean(false);
            node.start = startPos;
            node.end = endPos;
            return node;
        }
        if (token === "nil") {
            const node = makeNil();
            node.start = startPos;
            node.end = endPos;
            return node;
        }
        const symNode = makeSymbol(token);
        symNode.start = startPos;
        symNode.end = endPos;
        return symNode;
    }
    function readList() {
        const startPos = i;
        const openChar = input[i];
        i++;
        const items = [];
        while(true){
            skipWs();
            if (i >= len) break;
            const ch = input[i];
            if (openChar === "(" && ch === ")" || openChar === "[" && ch === "]") {
                i++;
                const listNode = makeList(items);
                listNode.start = startPos;
                listNode.end = i;
                return listNode;
            }
            items.push(readForm());
        }
        const listNode = makeList(items);
        listNode.start = startPos;
        listNode.end = i;
        return listNode;
    }
    function readForm() {
        skipWs();
        if (i >= len) return makeNil();
        const ch = input[i];
        if (ch === "(" || ch === "[") {
            return readList();
        }
        if (ch === '"') {
            return readString();
        }
        if (ch === ")" || ch === "]") {
            i++;
            return makeNil();
        }
        return readSymbolOrNumber();
    }
    while(true){
        skipWs();
        if (i >= len) break;
        result.push(readForm());
    }
    return result;
}
function wrapJsValue(obj) {
    return {
        type: "opaque",
        value: obj
    };
}
const osType = (()=>{
    const { Deno: Deno1 } = dntShim.dntGlobalThis;
    if (typeof Deno1?.build?.os === "string") {
        return Deno1.build.os;
    }
    const { navigator } = dntShim.dntGlobalThis;
    if (navigator?.appVersion?.includes?.("Win")) {
        return "windows";
    }
    return "linux";
})();
const isWindows = osType === "windows";
const CHAR_FORWARD_SLASH = 47;
function assertPath(path) {
    if (typeof path !== "string") {
        throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
    }
}
function isPosixPathSeparator(code) {
    return code === 47;
}
function isPathSeparator(code) {
    return isPosixPathSeparator(code) || code === 92;
}
function isWindowsDeviceRoot(code) {
    return code >= 97 && code <= 122 || code >= 65 && code <= 90;
}
function normalizeString(path, allowAboveRoot, separator, isPathSeparator) {
    let res = "";
    let lastSegmentLength = 0;
    let lastSlash = -1;
    let dots = 0;
    let code;
    for(let i = 0, len = path.length; i <= len; ++i){
        if (i < len) code = path.charCodeAt(i);
        else if (isPathSeparator(code)) break;
        else code = CHAR_FORWARD_SLASH;
        if (isPathSeparator(code)) {
            if (lastSlash === i - 1 || dots === 1) {} else if (lastSlash !== i - 1 && dots === 2) {
                if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
                    if (res.length > 2) {
                        const lastSlashIndex = res.lastIndexOf(separator);
                        if (lastSlashIndex === -1) {
                            res = "";
                            lastSegmentLength = 0;
                        } else {
                            res = res.slice(0, lastSlashIndex);
                            lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (res.length === 2 || res.length === 1) {
                        res = "";
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    if (res.length > 0) res += `${separator}..`;
                    else res = "..";
                    lastSegmentLength = 2;
                }
            } else {
                if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
                else res = path.slice(lastSlash + 1, i);
                lastSegmentLength = i - lastSlash - 1;
            }
            lastSlash = i;
            dots = 0;
        } else if (code === 46 && dots !== -1) {
            ++dots;
        } else {
            dots = -1;
        }
    }
    return res;
}
function _format(sep, pathObject) {
    const dir = pathObject.dir || pathObject.root;
    const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
    if (!dir) return base;
    if (dir === pathObject.root) return dir + base;
    return dir + sep + base;
}
const WHITESPACE_ENCODINGS = {
    "\u0009": "%09",
    "\u000A": "%0A",
    "\u000B": "%0B",
    "\u000C": "%0C",
    "\u000D": "%0D",
    "\u0020": "%20"
};
function encodeWhitespace(string) {
    return string.replaceAll(/[\s]/g, (c)=>{
        return WHITESPACE_ENCODINGS[c] ?? c;
    });
}
class DenoStdInternalError extends Error {
    constructor(message){
        super(message);
        this.name = "DenoStdInternalError";
    }
}
function assert(expr, msg = "") {
    if (!expr) {
        throw new DenoStdInternalError(msg);
    }
}
const sep = "\\";
const delimiter = ";";
function resolve(...pathSegments) {
    let resolvedDevice = "";
    let resolvedTail = "";
    let resolvedAbsolute = false;
    for(let i = pathSegments.length - 1; i >= -1; i--){
        let path;
        const { Deno: Deno1 } = dntShim.dntGlobalThis;
        if (i >= 0) {
            path = pathSegments[i];
        } else if (!resolvedDevice) {
            if (typeof Deno1?.cwd !== "function") {
                throw new TypeError("Resolved a drive-letter-less path without a CWD.");
            }
            path = Deno1.cwd();
        } else {
            if (typeof Deno1?.env?.get !== "function" || typeof Deno1?.cwd !== "function") {
                throw new TypeError("Resolved a relative path without a CWD.");
            }
            path = Deno1.cwd();
            if (path === undefined || path.slice(0, 3).toLowerCase() !== `${resolvedDevice.toLowerCase()}\\`) {
                path = `${resolvedDevice}\\`;
            }
        }
        assertPath(path);
        const len = path.length;
        if (len === 0) continue;
        let rootEnd = 0;
        let device = "";
        let isAbsolute = false;
        const code = path.charCodeAt(0);
        if (len > 1) {
            if (isPathSeparator(code)) {
                isAbsolute = true;
                if (isPathSeparator(path.charCodeAt(1))) {
                    let j = 2;
                    let last = j;
                    for(; j < len; ++j){
                        if (isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        const firstPart = path.slice(last, j);
                        last = j;
                        for(; j < len; ++j){
                            if (!isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            last = j;
                            for(; j < len; ++j){
                                if (isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j === len) {
                                device = `\\\\${firstPart}\\${path.slice(last)}`;
                                rootEnd = j;
                            } else if (j !== last) {
                                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                                rootEnd = j;
                            }
                        }
                    }
                } else {
                    rootEnd = 1;
                }
            } else if (isWindowsDeviceRoot(code)) {
                if (path.charCodeAt(1) === 58) {
                    device = path.slice(0, 2);
                    rootEnd = 2;
                    if (len > 2) {
                        if (isPathSeparator(path.charCodeAt(2))) {
                            isAbsolute = true;
                            rootEnd = 3;
                        }
                    }
                }
            }
        } else if (isPathSeparator(code)) {
            rootEnd = 1;
            isAbsolute = true;
        }
        if (device.length > 0 && resolvedDevice.length > 0 && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
            continue;
        }
        if (resolvedDevice.length === 0 && device.length > 0) {
            resolvedDevice = device;
        }
        if (!resolvedAbsolute) {
            resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
            resolvedAbsolute = isAbsolute;
        }
        if (resolvedAbsolute && resolvedDevice.length > 0) break;
    }
    resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);
    return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
}
function normalize(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = 0;
    let device;
    let isAbsolute = false;
    const code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            isAbsolute = true;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    const firstPart = path.slice(last, j);
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            return `\\\\${firstPart}\\${path.slice(last)}\\`;
                        } else if (j !== last) {
                            device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                            rootEnd = j;
                        }
                    }
                }
            } else {
                rootEnd = 1;
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                device = path.slice(0, 2);
                rootEnd = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) {
                        isAbsolute = true;
                        rootEnd = 3;
                    }
                }
            }
        }
    } else if (isPathSeparator(code)) {
        return "\\";
    }
    let tail;
    if (rootEnd < len) {
        tail = normalizeString(path.slice(rootEnd), !isAbsolute, "\\", isPathSeparator);
    } else {
        tail = "";
    }
    if (tail.length === 0 && !isAbsolute) tail = ".";
    if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
        tail += "\\";
    }
    if (device === undefined) {
        if (isAbsolute) {
            if (tail.length > 0) return `\\${tail}`;
            else return "\\";
        } else if (tail.length > 0) {
            return tail;
        } else {
            return "";
        }
    } else if (isAbsolute) {
        if (tail.length > 0) return `${device}\\${tail}`;
        else return `${device}\\`;
    } else if (tail.length > 0) {
        return device + tail;
    } else {
        return device;
    }
}
function isAbsolute(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return false;
    const code = path.charCodeAt(0);
    if (isPathSeparator(code)) {
        return true;
    } else if (isWindowsDeviceRoot(code)) {
        if (len > 2 && path.charCodeAt(1) === 58) {
            if (isPathSeparator(path.charCodeAt(2))) return true;
        }
    }
    return false;
}
function join(...paths) {
    const pathsCount = paths.length;
    if (pathsCount === 0) return ".";
    let joined;
    let firstPart = null;
    for(let i = 0; i < pathsCount; ++i){
        const path = paths[i];
        assertPath(path);
        if (path.length > 0) {
            if (joined === undefined) joined = firstPart = path;
            else joined += `\\${path}`;
        }
    }
    if (joined === undefined) return ".";
    let needsReplace = true;
    let slashCount = 0;
    assert(firstPart != null);
    if (isPathSeparator(firstPart.charCodeAt(0))) {
        ++slashCount;
        const firstLen = firstPart.length;
        if (firstLen > 1) {
            if (isPathSeparator(firstPart.charCodeAt(1))) {
                ++slashCount;
                if (firstLen > 2) {
                    if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
                    else {
                        needsReplace = false;
                    }
                }
            }
        }
    }
    if (needsReplace) {
        for(; slashCount < joined.length; ++slashCount){
            if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
        }
        if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
    }
    return normalize(joined);
}
function relative(from, to) {
    assertPath(from);
    assertPath(to);
    if (from === to) return "";
    const fromOrig = resolve(from);
    const toOrig = resolve(to);
    if (fromOrig === toOrig) return "";
    from = fromOrig.toLowerCase();
    to = toOrig.toLowerCase();
    if (from === to) return "";
    let fromStart = 0;
    let fromEnd = from.length;
    for(; fromStart < fromEnd; ++fromStart){
        if (from.charCodeAt(fromStart) !== 92) break;
    }
    for(; fromEnd - 1 > fromStart; --fromEnd){
        if (from.charCodeAt(fromEnd - 1) !== 92) break;
    }
    const fromLen = fromEnd - fromStart;
    let toStart = 0;
    let toEnd = to.length;
    for(; toStart < toEnd; ++toStart){
        if (to.charCodeAt(toStart) !== 92) break;
    }
    for(; toEnd - 1 > toStart; --toEnd){
        if (to.charCodeAt(toEnd - 1) !== 92) break;
    }
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for(; i <= length; ++i){
        if (i === length) {
            if (toLen > length) {
                if (to.charCodeAt(toStart + i) === 92) {
                    return toOrig.slice(toStart + i + 1);
                } else if (i === 2) {
                    return toOrig.slice(toStart + i);
                }
            }
            if (fromLen > length) {
                if (from.charCodeAt(fromStart + i) === 92) {
                    lastCommonSep = i;
                } else if (i === 2) {
                    lastCommonSep = 3;
                }
            }
            break;
        }
        const fromCode = from.charCodeAt(fromStart + i);
        const toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode) break;
        else if (fromCode === 92) lastCommonSep = i;
    }
    if (i !== length && lastCommonSep === -1) {
        return toOrig;
    }
    let out = "";
    if (lastCommonSep === -1) lastCommonSep = 0;
    for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
        if (i === fromEnd || from.charCodeAt(i) === 92) {
            if (out.length === 0) out += "..";
            else out += "\\..";
        }
    }
    if (out.length > 0) {
        return out + toOrig.slice(toStart + lastCommonSep, toEnd);
    } else {
        toStart += lastCommonSep;
        if (toOrig.charCodeAt(toStart) === 92) ++toStart;
        return toOrig.slice(toStart, toEnd);
    }
}
function toNamespacedPath(path) {
    if (typeof path !== "string") return path;
    if (path.length === 0) return "";
    const resolvedPath = resolve(path);
    if (resolvedPath.length >= 3) {
        if (resolvedPath.charCodeAt(0) === 92) {
            if (resolvedPath.charCodeAt(1) === 92) {
                const code = resolvedPath.charCodeAt(2);
                if (code !== 63 && code !== 46) {
                    return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
                }
            }
        } else if (isWindowsDeviceRoot(resolvedPath.charCodeAt(0))) {
            if (resolvedPath.charCodeAt(1) === 58 && resolvedPath.charCodeAt(2) === 92) {
                return `\\\\?\\${resolvedPath}`;
            }
        }
    }
    return path;
}
function dirname(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = -1;
    let end = -1;
    let matchedSlash = true;
    let offset = 0;
    const code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = offset = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            return path;
                        }
                        if (j !== last) {
                            rootEnd = offset = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                rootEnd = offset = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
                }
            }
        }
    } else if (isPathSeparator(code)) {
        return path;
    }
    for(let i = len - 1; i >= offset; --i){
        if (isPathSeparator(path.charCodeAt(i))) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }
    if (end === -1) {
        if (rootEnd === -1) return ".";
        else end = rootEnd;
    }
    return path.slice(0, end);
}
function basename(path, ext = "") {
    if (ext !== undefined && typeof ext !== "string") {
        throw new TypeError('"ext" argument must be a string');
    }
    assertPath(path);
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (path.length >= 2) {
        const drive = path.charCodeAt(0);
        if (isWindowsDeviceRoot(drive)) {
            if (path.charCodeAt(1) === 58) start = 2;
        }
    }
    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return "";
        let extIdx = ext.length - 1;
        let firstNonSlashEnd = -1;
        for(i = path.length - 1; i >= start; --i){
            const code = path.charCodeAt(i);
            if (isPathSeparator(code)) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd === -1) {
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx >= 0) {
                    if (code === ext.charCodeAt(extIdx)) {
                        if (--extIdx === -1) {
                            end = i;
                        }
                    } else {
                        extIdx = -1;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = path.length;
        return path.slice(start, end);
    } else {
        for(i = path.length - 1; i >= start; --i){
            if (isPathSeparator(path.charCodeAt(i))) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
        }
        if (end === -1) return "";
        return path.slice(start, end);
    }
}
function extname(path) {
    assertPath(path);
    let start = 0;
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    if (path.length >= 2 && path.charCodeAt(1) === 58 && isWindowsDeviceRoot(path.charCodeAt(0))) {
        start = startPart = 2;
    }
    for(let i = path.length - 1; i >= start; --i){
        const code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        return "";
    }
    return path.slice(startDot, end);
}
function format(pathObject) {
    if (pathObject === null || typeof pathObject !== "object") {
        throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
    }
    return _format("\\", pathObject);
}
function parse1(path) {
    assertPath(path);
    const ret = {
        root: "",
        dir: "",
        base: "",
        ext: "",
        name: ""
    };
    const len = path.length;
    if (len === 0) return ret;
    let rootEnd = 0;
    let code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            rootEnd = j;
                        } else if (j !== last) {
                            rootEnd = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                rootEnd = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) {
                        if (len === 3) {
                            ret.root = ret.dir = path;
                            return ret;
                        }
                        rootEnd = 3;
                    }
                } else {
                    ret.root = ret.dir = path;
                    return ret;
                }
            }
        }
    } else if (isPathSeparator(code)) {
        ret.root = ret.dir = path;
        return ret;
    }
    if (rootEnd > 0) ret.root = path.slice(0, rootEnd);
    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for(; i >= rootEnd; --i){
        code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        if (end !== -1) {
            ret.base = ret.name = path.slice(startPart, end);
        }
    } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
        ret.ext = path.slice(startDot, end);
    }
    if (startPart > 0 && startPart !== rootEnd) {
        ret.dir = path.slice(0, startPart - 1);
    } else ret.dir = ret.root;
    return ret;
}
function fromFileUrl(url) {
    url = url instanceof URL ? url : new URL(url);
    if (url.protocol != "file:") {
        throw new TypeError("Must be a file URL.");
    }
    let path = decodeURIComponent(url.pathname.replace(/\//g, "\\").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).replace(/^\\*([A-Za-z]:)(\\|$)/, "$1\\");
    if (url.hostname != "") {
        path = `\\\\${url.hostname}${path}`;
    }
    return path;
}
function toFileUrl(path) {
    if (!isAbsolute(path)) {
        throw new TypeError("Must be an absolute path.");
    }
    const [, hostname, pathname] = path.match(/^(?:[/\\]{2}([^/\\]+)(?=[/\\](?:[^/\\]|$)))?(.*)/);
    const url = new URL("file:///");
    url.pathname = encodeWhitespace(pathname.replace(/%/g, "%25"));
    if (hostname != null && hostname != "localhost") {
        url.hostname = hostname;
        if (!url.hostname) {
            throw new TypeError("Invalid hostname.");
        }
    }
    return url;
}
const mod = {
    sep: sep,
    delimiter: delimiter,
    resolve: resolve,
    normalize: normalize,
    isAbsolute: isAbsolute,
    join: join,
    relative: relative,
    toNamespacedPath: toNamespacedPath,
    dirname: dirname,
    basename: basename,
    extname: extname,
    format: format,
    parse: parse1,
    fromFileUrl: fromFileUrl,
    toFileUrl: toFileUrl
};
const sep1 = "/";
const delimiter1 = ":";
function resolve1(...pathSegments) {
    let resolvedPath = "";
    let resolvedAbsolute = false;
    for(let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--){
        let path;
        if (i >= 0) path = pathSegments[i];
        else {
            const { Deno: Deno1 } = dntShim.dntGlobalThis;
            if (typeof Deno1?.cwd !== "function") {
                throw new TypeError("Resolved a relative path without a CWD.");
            }
            path = Deno1.cwd();
        }
        assertPath(path);
        if (path.length === 0) {
            continue;
        }
        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    }
    resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
    if (resolvedAbsolute) {
        if (resolvedPath.length > 0) return `/${resolvedPath}`;
        else return "/";
    } else if (resolvedPath.length > 0) return resolvedPath;
    else return ".";
}
function normalize1(path) {
    assertPath(path);
    if (path.length === 0) return ".";
    const isAbsolute = path.charCodeAt(0) === 47;
    const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
    path = normalizeString(path, !isAbsolute, "/", isPosixPathSeparator);
    if (path.length === 0 && !isAbsolute) path = ".";
    if (path.length > 0 && trailingSeparator) path += "/";
    if (isAbsolute) return `/${path}`;
    return path;
}
function isAbsolute1(path) {
    assertPath(path);
    return path.length > 0 && path.charCodeAt(0) === 47;
}
function join1(...paths) {
    if (paths.length === 0) return ".";
    let joined;
    for(let i = 0, len = paths.length; i < len; ++i){
        const path = paths[i];
        assertPath(path);
        if (path.length > 0) {
            if (!joined) joined = path;
            else joined += `/${path}`;
        }
    }
    if (!joined) return ".";
    return normalize1(joined);
}
function relative1(from, to) {
    assertPath(from);
    assertPath(to);
    if (from === to) return "";
    from = resolve1(from);
    to = resolve1(to);
    if (from === to) return "";
    let fromStart = 1;
    const fromEnd = from.length;
    for(; fromStart < fromEnd; ++fromStart){
        if (from.charCodeAt(fromStart) !== 47) break;
    }
    const fromLen = fromEnd - fromStart;
    let toStart = 1;
    const toEnd = to.length;
    for(; toStart < toEnd; ++toStart){
        if (to.charCodeAt(toStart) !== 47) break;
    }
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for(; i <= length; ++i){
        if (i === length) {
            if (toLen > length) {
                if (to.charCodeAt(toStart + i) === 47) {
                    return to.slice(toStart + i + 1);
                } else if (i === 0) {
                    return to.slice(toStart + i);
                }
            } else if (fromLen > length) {
                if (from.charCodeAt(fromStart + i) === 47) {
                    lastCommonSep = i;
                } else if (i === 0) {
                    lastCommonSep = 0;
                }
            }
            break;
        }
        const fromCode = from.charCodeAt(fromStart + i);
        const toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode) break;
        else if (fromCode === 47) lastCommonSep = i;
    }
    let out = "";
    for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
        if (i === fromEnd || from.charCodeAt(i) === 47) {
            if (out.length === 0) out += "..";
            else out += "/..";
        }
    }
    if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
    else {
        toStart += lastCommonSep;
        if (to.charCodeAt(toStart) === 47) ++toStart;
        return to.slice(toStart);
    }
}
function toNamespacedPath1(path) {
    return path;
}
function dirname1(path) {
    assertPath(path);
    if (path.length === 0) return ".";
    const hasRoot = path.charCodeAt(0) === 47;
    let end = -1;
    let matchedSlash = true;
    for(let i = path.length - 1; i >= 1; --i){
        if (path.charCodeAt(i) === 47) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }
    if (end === -1) return hasRoot ? "/" : ".";
    if (hasRoot && end === 1) return "//";
    return path.slice(0, end);
}
function basename1(path, ext = "") {
    if (ext !== undefined && typeof ext !== "string") {
        throw new TypeError('"ext" argument must be a string');
    }
    assertPath(path);
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return "";
        let extIdx = ext.length - 1;
        let firstNonSlashEnd = -1;
        for(i = path.length - 1; i >= 0; --i){
            const code = path.charCodeAt(i);
            if (code === 47) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd === -1) {
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx >= 0) {
                    if (code === ext.charCodeAt(extIdx)) {
                        if (--extIdx === -1) {
                            end = i;
                        }
                    } else {
                        extIdx = -1;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = path.length;
        return path.slice(start, end);
    } else {
        for(i = path.length - 1; i >= 0; --i){
            if (path.charCodeAt(i) === 47) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
        }
        if (end === -1) return "";
        return path.slice(start, end);
    }
}
function extname1(path) {
    assertPath(path);
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    for(let i = path.length - 1; i >= 0; --i){
        const code = path.charCodeAt(i);
        if (code === 47) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        return "";
    }
    return path.slice(startDot, end);
}
function format1(pathObject) {
    if (pathObject === null || typeof pathObject !== "object") {
        throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
    }
    return _format("/", pathObject);
}
function parse2(path) {
    assertPath(path);
    const ret = {
        root: "",
        dir: "",
        base: "",
        ext: "",
        name: ""
    };
    if (path.length === 0) return ret;
    const isAbsolute = path.charCodeAt(0) === 47;
    let start;
    if (isAbsolute) {
        ret.root = "/";
        start = 1;
    } else {
        start = 0;
    }
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for(; i >= start; --i){
        const code = path.charCodeAt(i);
        if (code === 47) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        if (end !== -1) {
            if (startPart === 0 && isAbsolute) {
                ret.base = ret.name = path.slice(1, end);
            } else {
                ret.base = ret.name = path.slice(startPart, end);
            }
        }
    } else {
        if (startPart === 0 && isAbsolute) {
            ret.name = path.slice(1, startDot);
            ret.base = path.slice(1, end);
        } else {
            ret.name = path.slice(startPart, startDot);
            ret.base = path.slice(startPart, end);
        }
        ret.ext = path.slice(startDot, end);
    }
    if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
    else if (isAbsolute) ret.dir = "/";
    return ret;
}
function fromFileUrl1(url) {
    url = url instanceof URL ? url : new URL(url);
    if (url.protocol != "file:") {
        throw new TypeError("Must be a file URL.");
    }
    return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
}
function toFileUrl1(path) {
    if (!isAbsolute1(path)) {
        throw new TypeError("Must be an absolute path.");
    }
    const url = new URL("file:///");
    url.pathname = encodeWhitespace(path.replace(/%/g, "%25").replace(/\\/g, "%5C"));
    return url;
}
const mod1 = {
    sep: sep1,
    delimiter: delimiter1,
    resolve: resolve1,
    normalize: normalize1,
    isAbsolute: isAbsolute1,
    join: join1,
    relative: relative1,
    toNamespacedPath: toNamespacedPath1,
    dirname: dirname1,
    basename: basename1,
    extname: extname1,
    format: format1,
    parse: parse2,
    fromFileUrl: fromFileUrl1,
    toFileUrl: toFileUrl1
};
const path = isWindows ? mod : mod1;
const { join: join2, normalize: normalize2 } = path;
const path1 = isWindows ? mod : mod1;
const { basename: basename2, delimiter: delimiter2, dirname: dirname2, extname: extname2, format: format2, fromFileUrl: fromFileUrl2, isAbsolute: isAbsolute2, join: join3, normalize: normalize3, parse: parse3, relative: relative2, resolve: resolve2, sep: sep2, toFileUrl: toFileUrl2, toNamespacedPath: toNamespacedPath2 } = path1;
function cwd() {
    return dntShim.Deno.cwd();
}
async function stat(path) {
    return await dntShim.Deno.stat(path);
}
async function readTextFile(path) {
    return await dntShim.Deno.readTextFile(path);
}
async function writeTextFile(path, data) {
    return await dntShim.Deno.writeTextFile(path, data);
}
async function mkdir(path, opts) {
    return await dntShim.Deno.mkdir(path, opts);
}
function join4(...segments) {
    return join3(...segments);
}
function dirname3(path) {
    return dirname2(path);
}
function basename3(path, ext) {
    return basename2(path, ext);
}
function extname3(path) {
    return extname2(path);
}
function isAbsolute3(path) {
    return isAbsolute2(path);
}
function resolve3(...segments) {
    return resolve2(...segments);
}
function relative3(from, to) {
    return relative2(from, to);
}
function realPathSync(path) {
    return dntShim.Deno.realPathSync(path);
}
function execPath() {
    return dntShim.Deno.execPath();
}
function runCmd(options) {
    return dntShim.Deno.run(options);
}
function readDir(path) {
    return dntShim.Deno.readDir(path);
}
async function makeTempDir() {
    return await dntShim.Deno.makeTempDir();
}
function exit(code) {
    dntShim.Deno.exit(code);
}
function getEnv(key) {
    return dntShim.Deno.env.get(key);
}
function hqlToJs(val) {
    if (!val) return null;
    switch(val.type){
        case "nil":
            return null;
        case "boolean":
            return val.value;
        case "number":
            return val.value;
        case "string":
            return val.value;
        case "symbol":
            {
                if (val.name.includes(".")) {
                    const [enumName, caseName] = val.name.split(".");
                    const enumVal = baseEnv.get(enumName);
                    if (enumVal && enumVal.type === "opaque" && enumVal.value && typeof enumVal.value === "object" && enumVal.value.isEnum) {
                        if (caseName in enumVal.value) {
                            return enumVal.value[caseName].value;
                        } else {
                            throw new Error(`Enum '${enumName}' does not have a case '${caseName}'`);
                        }
                    }
                }
                return val.name;
            }
        case "list":
            return Array.isArray(val.value) ? val.value.map(hqlToJs) : [];
        case "function":
            {
                if (val.isSync) {
                    return (...args)=>{
                        const r = applyFnSync(val, args.map(jsToHql));
                        return hqlToJs(r);
                    };
                } else {
                    return async (...args)=>{
                        const r = await applyFnAsync(val, args.map(jsToHql));
                        return hqlToJs(r);
                    };
                }
            }
        case "opaque":
            return val.value;
        default:
            return val;
    }
}
async function compile(source, inputPath, skipEvaluation = false, outputPath) {
    const inputAbs = resolve3(inputPath);
    if (!outputPath) {
        const baseName = basename3(inputAbs, extname3(inputAbs));
        outputPath = join4(dirname3(inputAbs), `${baseName}.hql.js`);
    }
    const outputAbs = resolve3(outputPath);
    const outDir = dirname3(outputAbs);
    const runtimeAbs = resolve3(join4(cwd(), "hql.ts"));
    const runtimeImport = makeRelativePath(outDir, runtimeAbs);
    const inputRel = makeRelativePath(outDir, inputAbs);
    const exportsMap = {};
    const forms = parse(source);
    const env = new Env({}, baseEnv);
    env.exports = exportsMap;
    if (!skipEvaluation) {
        for (const form of forms){
            await evaluateAsync(form, env, inputAbs);
        }
    } else {
        for (const form of forms){
            if (form.type === "list" && form.value.length > 0) {
                const head = form.value[0];
                if (head.type === "symbol") {
                    let exportName;
                    if (head.name === "def" || head.name === "defsync" || head.name === "defmacro" || head.name === "defn" || head.name === "defx" || head.name === "defenum") {
                        const nameSym = form.value[1];
                        if (nameSym && nameSym.type === "symbol") {
                            exportName = nameSym.name;
                        }
                    } else if (head.name === "export") {
                        const exportNameAst = form.value[1];
                        if (exportNameAst && exportNameAst.type === "string") {
                            exportName = exportNameAst.value;
                        }
                    }
                    if (exportName) {
                        exportsMap[exportName] = makeNil();
                    }
                }
            }
        }
    }
    const names = Object.keys(exportsMap);
    let code = `import { exportHqlModules, getHqlModule } from "${runtimeImport}";\n\n`;
    code += `const _exports = await exportHqlModules("${inputRel}");\n\n`;
    for (const name of names){
        const val = exportsMap[name];
        if (val && val.type === "function") {
            const typed = val.typed;
            const isSync = val.isSync;
            if (typed) {
                code += `
export async function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return await fn(...args);
}\n`;
            } else {
                if (isSync) {
                    code += `
export function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return fn(...args);
}\n`;
                } else {
                    code += `
export async function ${name}(...args) {
  const fn = getHqlModule("${name}", _exports);
  return await fn(...args);
}\n`;
                }
            }
        } else {
            code += `
export const ${name} = getHqlModule("${name}", _exports);\n`;
        }
    }
    return code;
}
function jsToHql(obj) {
    if (obj === null || obj === undefined) return makeNil();
    if (typeof obj === "boolean") return makeBoolean(obj);
    if (typeof obj === "number") return makeNumber(obj);
    if (typeof obj === "string") return makeString(obj);
    if (Array.isArray(obj)) return makeList(obj.map(jsToHql));
    return {
        type: "opaque",
        value: obj
    };
}
function formatValue(val) {
    if (!val) return "nil";
    switch(val.type){
        case "number":
            return String(val.value);
        case "string":
            return JSON.stringify(val.value);
        case "boolean":
            return val.value ? "true" : "false";
        case "nil":
            return "nil";
        case "symbol":
            return val.name;
        case "list":
            return "(" + val.value.map(formatValue).join(" ") + ")";
        case "function":
            return val.isMacro ? "<macro>" : "<fn>";
        case "opaque":
            {
                const obj = val.value;
                if (obj instanceof Set) {
                    return `Set { ${Array.from(obj).map((x)=>formatValue(jsToHql(x))).join(", ")} }`;
                } else if (obj instanceof Map) {
                    return `Map { ${Array.from(obj.entries()).map(([k, v])=>`${formatValue(jsToHql(k))} => ${formatValue(jsToHql(v))}`).join(", ")} }`;
                } else if (obj instanceof Date) {
                    return obj.toISOString();
                } else if (obj instanceof RegExp) {
                    return obj.toString();
                } else if (obj instanceof Error) {
                    return `Error: ${obj.message}`;
                } else if (obj instanceof URL) {
                    return obj.toString();
                } else if (Array.isArray(obj)) {
                    return `[ ${obj.map((x)=>formatValue(jsToHql(x))).join(", ")} ]`;
                } else if (typeof obj === "object" && obj !== null) {
                    try {
                        return JSON.stringify(obj);
                    } catch (e) {
                        return String(obj);
                    }
                } else {
                    return String(obj);
                }
            }
        default:
            return String(val);
    }
}
function evaluateAtom(ast, env) {
    if (ast.type === "enum-case") return resolveEnumCase(ast, env);
    if (ast.type === "symbol") return resolveSymbol(ast, env);
    if ([
        "number",
        "string",
        "boolean",
        "nil",
        "list"
    ].includes(ast.type)) return ast;
    return ast;
}
function resolveSymbol(ast, env) {
    if (ast.name.includes(".")) {
        const [enumName, caseName] = ast.name.split(".");
        const enumVal = env.get(enumName);
        if (enumVal && enumVal.type === "opaque" && enumVal.value && typeof enumVal.value === "object" && enumVal.value.isEnum) {
            if (caseName in enumVal.value) return enumVal.value[caseName];
            throw new Error(`Enum '${enumName}' does not have a case '${caseName}'`);
        }
    }
    return env.get(ast.name);
}
function resolveEnumCase(enumCase, env) {
    let result = null;
    let currentEnv = env;
    while(currentEnv){
        for(const key in currentEnv.bindings){
            const binding = currentEnv.bindings[key];
            if (binding.type === "opaque" && binding.value && typeof binding.value === "object" && binding.value.isEnum && enumCase.name in binding.value) {
                if (result !== null) throw new Error(`Ambiguous enum case '.${enumCase.name}' found in multiple enums`);
                result = binding.value[enumCase.name];
            }
        }
        currentEnv = currentEnv.outer;
    }
    if (result === null) throw new Error(`Enum case '.${enumCase.name}' not found`);
    return result;
}
function truthy(val) {
    return !!val && val.type !== "nil" && (val.type !== "boolean" || !!val.value);
}
function isLabel(arg) {
    return arg.type === "symbol" ? arg.name.endsWith(":") : arg.type === "string" ? arg.value.endsWith(":") : false;
}
function processLabeledArgs(fnVal, argVals) {
    const declared = fnVal.params;
    if (argVals.length === 1 && argVals[0].type === "opaque" && typeof argVals[0].value === "object" && !Array.isArray(argVals[0].value)) {
        const labelMap = {};
        for(const k in argVals[0].value){
            const key = k.endsWith(":") ? k.slice(0, -1) : k;
            labelMap[key] = jsToHql(argVals[0].value[k]);
        }
        return declared.map((p)=>{
            if (!(p in labelMap)) throw new Error(`Missing argument for parameter '${p}'`);
            return labelMap[p];
        });
    }
    if (argVals.length > 1 && argVals[0].type === "opaque" && typeof argVals[0].value === "object" && !Array.isArray(argVals[0].value)) {
        throw new Error("Mixed labeled and positional arguments are not allowed");
    }
    if (argVals.some(isLabel)) {
        if (argVals.length % 2 !== 0) throw new Error("Labeled function call must have an even number of arguments (label-value pairs)");
        const values = [];
        for(let i = 0; i < argVals.length; i += 2){
            if (!isLabel(argVals[i])) throw new Error("Expected label (string or symbol) ending with ':'");
            values.push(argVals[i + 1]);
        }
        if (values.length !== declared.length) throw new Error(`Expected ${declared.length} arguments, but got ${values.length} from labeled call`);
        return values;
    }
    if (argVals.length !== declared.length) throw new Error(`Expected ${declared.length} arguments, but got ${argVals.length}`);
    return argVals;
}
async function applyFnAsync(fnVal, argVals) {
    if (fnVal.hostFn) {
        let ret = fnVal.hostFn(argVals);
        if (ret instanceof Promise) ret = await ret;
        return ret;
    }
    argVals = processLabeledArgs(fnVal, argVals);
    if (argVals.length < fnVal.params.length) throw new Error(`Not enough args: got ${argVals.length}, want ${fnVal.params.length}`);
    const newEnv = new Env({}, fnVal.closure);
    for(let i = 0; i < fnVal.params.length; i++){
        newEnv.set(fnVal.params[i], argVals[i]);
    }
    let out = makeNil();
    for (const form of fnVal.body){
        out = await evaluateAsync(form, newEnv);
    }
    return out;
}
function applyFnSync(fnVal, argVals) {
    if (fnVal.hostFn) {
        const ret = fnVal.hostFn(argVals);
        if (ret instanceof Promise) throw new Error("Sync function attempted async operation!");
        return ret;
    }
    argVals = processLabeledArgs(fnVal, argVals);
    if (argVals.length < fnVal.params.length) throw new Error(`Not enough args: got ${argVals.length}, want ${fnVal.params.length}`);
    const newEnv = new Env({}, fnVal.closure);
    for(let i = 0; i < fnVal.params.length; i++){
        newEnv.set(fnVal.params[i], argVals[i]);
    }
    let out = makeNil();
    for (const form of fnVal.body){
        out = evaluateSync(form, newEnv);
    }
    return out;
}
function parseParamList(paramsAst) {
    if (!paramsAst || paramsAst.type !== "list") throw new Error("Expected a list of parameters");
    const tokens = paramsAst.value;
    if (tokens.length === 0) return {
        paramNames: [],
        typed: false
    };
    if (tokens[0].type === "symbol" && tokens[0].name.endsWith(":")) {
        if (tokens.length % 2 !== 0) throw new Error("Typed param list must have pairs of name: type");
        const paramNames = [];
        for(let i = 0; i < tokens.length; i += 2){
            const nameToken = tokens[i];
            const typeToken = tokens[i + 1];
            if (nameToken.type !== "symbol" || !nameToken.name.endsWith(":")) throw new Error("Param name must end with ':' in typed param list");
            if (typeToken.type !== "symbol") throw new Error("Typed param must have a symbol type");
            paramNames.push(nameToken.name.slice(0, -1));
        }
        return {
            paramNames,
            typed: true
        };
    } else {
        tokens.forEach((tok)=>{
            if (tok.type !== "symbol") throw new Error("Param must be a symbol for untyped function");
            if (tok.name.endsWith(":")) throw new Error("All parameters must be annotated if any is annotated");
        });
        return {
            paramNames: tokens.map((t)=>t.name),
            typed: false
        };
    }
}
function extractBodyForms(forms) {
    if (forms.length > 0 && forms[0].type === "list" && forms[0].value[0]?.type === "symbol" && forms[0].value[0].name === "return") {
        return forms.slice(1);
    }
    return forms;
}
function makeFunctionLiteral(parts, env, isPure) {
    if (parts.length === 0) throw new Error("Function literal expects a parameter list");
    if (parts[0].type === "list" && parts[0].value.length > 0 && parts[0].value[0].type === "list") parts = parts[0].value.concat(parts.slice(1));
    const { paramNames, typed } = parseParamList(parts[0]);
    let bodyForms;
    if (parts.length > 1 && parts[1].type === "list" && parts[1].value.length > 0 && parts[1].value[0].type === "symbol" && parts[1].value[0].name === "->") {
        if (parts[1].value.length === 2) {
            bodyForms = parts.slice(2);
        } else {
            throw new Error("Invalid return type annotation");
        }
    } else {
        bodyForms = parts.slice(1);
    }
    return {
        type: "function",
        params: paramNames,
        body: extractBodyForms(bodyForms),
        closure: env,
        isMacro: false,
        isPure,
        typed,
        hostFn: undefined
    };
}
function makeFunctionLiteralWrapper(parts, env, isPure) {
    return makeFunctionLiteral(parts, env, isPure);
}
function handleDefn(formName, rest, env) {
    if (rest.length < 2) throw new Error("defn expects a name and a function definition");
    const nameSym = rest[0];
    if (nameSym.type !== "symbol") throw new Error("defn expects a symbol as function name");
    const fnVal = makeFunctionLiteralWrapper(rest.slice(1), env, formName === "defx");
    env.set(nameSym.name, fnVal);
    if (env.exports) env.exports[nameSym.name] = fnVal;
    return nameSym;
}
function handleDefinitionForm(formName, rest, env, evalFn, markSync, realPath) {
    if (!rest[0] || rest[0].type !== "symbol") throw new Error(`(${formName}) expects a symbol`);
    const nameSym = rest[0];
    const valExpr = rest[1] || makeNil();
    if (formName === "defmacro") {
        if (!rest[1] || rest[1].type !== "list") throw new Error("(defmacro) expects a list of parameters");
        const params = rest[1].value.map((p)=>{
            if (p.type !== "symbol") throw new Error("Macro parameter must be a symbol");
            return p.name;
        });
        const macroVal = {
            type: "function",
            params,
            body: rest.slice(2),
            closure: env,
            isMacro: true
        };
        env.set(nameSym.name, macroVal);
        if (env.exports) env.exports[nameSym.name] = macroVal;
        return makeSymbol(nameSym.name);
    }
    const finalize = (v)=>{
        if (markSync && v.type === "function") v.isSync = true;
        env.set(nameSym.name, v);
        if (env.exports) env.exports[nameSym.name] = v;
        return v;
    };
    const maybePromise = evalFn(valExpr, env, realPath);
    return maybePromise instanceof Promise ? maybePromise.then(finalize) : finalize(maybePromise);
}
async function evaluateCoreAsync(ast, env, realPath) {
    if (ast.type === "list" && ast.value.length > 0) {
        const [head, ...rest] = ast.value;
        if (head.type === "symbol") {
            switch(head.name){
                case "new":
                    return await handleNewAsync(rest, env);
                case "quote":
                    return rest[0] ?? makeNil();
                case "if":
                    return await handleIfAsync(rest, env);
                case "def":
                case "defsync":
                case "defmacro":
                    return await handleDefinitionForm(head.name, rest, env, evaluateAsync, head.name === "defsync", realPath);
                case "export":
                    {
                        if (rest.length !== 2) throw new Error("(export) expects exactly two arguments: string and value");
                        const exportNameAst = rest[0];
                        if (exportNameAst.type !== "string") throw new Error("(export) expects first argument to be a string");
                        const exportValue = await evaluateAsync(rest[1], env, realPath);
                        if (!env.exports) env.exports = {};
                        env.exports[exportNameAst.value] = exportValue;
                        return exportValue;
                    }
                case "fn":
                case "fx":
                    return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
                case "defn":
                case "defx":
                    return handleDefn(head.name, rest, env);
                case "defenum":
                    return handleDefenum(rest, env);
                case "import":
                    return await handleImportSpecialForm(rest, env, realPath);
            }
        }
        const fnVal = await evaluateAsync(head, env, realPath);
        if (fnVal.type === "function") {
            return await handleFunctionCallAsync(fnVal, rest, env);
        }
        throw new Error(`Attempt to call non-function: ${head.type}`);
    }
    return evaluateAtom(ast, env);
}
function evaluateCoreSync(ast, env) {
    if (ast.type === "list" && ast.value.length > 0) {
        const [head, ...rest] = ast.value;
        if (head.type === "symbol") {
            switch(head.name){
                case "new":
                    return handleNewSync(rest, env);
                case "quote":
                    return rest[0] ?? makeNil();
                case "if":
                    return handleIfSync(rest, env);
                case "def":
                case "defsync":
                    return handleDefinitionForm(head.name, rest, env, evaluateSync, head.name === "defsync");
                case "export":
                    {
                        if (rest.length !== 2) throw new Error("(export) expects exactly two arguments: string and value");
                        const exportNameAst = rest[0];
                        if (exportNameAst.type !== "string") throw new Error("(export) expects first argument to be a string");
                        const exportValue = evaluateSync(rest[1], env);
                        if (!env.exports) env.exports = {};
                        env.exports[exportNameAst.value] = exportValue;
                        return exportValue;
                    }
                case "fn":
                case "fx":
                    return makeFunctionLiteralWrapper(rest, env, head.name === "fx");
                case "defn":
                case "defx":
                    return handleDefn(head.name, rest, env);
                case "defenum":
                    return handleDefenum(rest, env);
            }
        }
        const fnVal = evaluateSync(head, env);
        if (fnVal.type === "function") {
            return handleFunctionCallSync(fnVal, rest, env);
        }
        throw new Error(`Attempt to call non-function: ${head.type}`);
    }
    return evaluateAtom(ast, env);
}
async function evaluateAsync(ast, env, realPath) {
    return await evaluateCoreAsync(ast, env, realPath);
}
function evaluateSync(ast, env) {
    return evaluateCoreSync(ast, env);
}
function handleDefenum(rest, env) {
    if (rest.length < 2) throw new Error("defenum expects at least an enum name and one case");
    const enumNameToken = rest[0];
    if (enumNameToken.type !== "symbol") throw new Error("defenum expects the enum name to be a symbol");
    const enumName = enumNameToken.name;
    const enumObj = {};
    for (const c of rest.slice(1)){
        if (c.type !== "symbol") throw new Error("Enum cases must be symbols");
        enumObj[c.name] = {
            type: "opaque",
            value: Symbol(`${enumName}.${c.name}`)
        };
    }
    enumObj.isEnum = true;
    Object.freeze(enumObj);
    const enumHQL = wrapJsValue(enumObj);
    env.set(enumName, enumHQL);
    return enumHQL;
}
async function handleImportSpecialForm(rest, env, realPath) {
    if (rest.length < 1) throw new Error("(import) expects a URL");
    const urlVal = await evaluateAsync(rest[0], env, realPath);
    if (urlVal.type !== "string") throw new Error("import expects a string URL");
    const callerPath = realPath || env.fileBase;
    const baseUrl = callerPath ? `file://${dirname3(callerPath)}/` : `file://${cwd()}/`;
    return await doImport(urlVal.value, baseUrl);
}
const cdnCandidates = [
    "https://esm.sh/",
    "https://jspm.dev/",
    "https://cdn.skypack.dev/"
];
async function doImport(url, baseUrl) {
    let modUrl;
    if (url.startsWith("npm:")) return await recurImport(url, cdnCandidates);
    try {
        new URL(url);
        modUrl = url;
    } catch (_e) {
        modUrl = new URL(url, baseUrl || `file://${cwd()}/`).toString();
    }
    if (modUrl.startsWith("file://")) {
        const filePath = modUrl.slice(7);
        if (filePath.endsWith(".hql")) {
            const cacheDir = join4(cwd(), ".hqlcache");
            const relPath = relative3(cwd(), filePath);
            const cacheFile = join4(cacheDir, relPath + ".js");
            let needCompile = true;
            try {
                const srcStat = await stat(filePath);
                const cacheStat = await stat(cacheFile);
                if (cacheStat.mtime && srcStat.mtime && cacheStat.mtime >= srcStat.mtime) needCompile = false;
            } catch (_e) {
                needCompile = true;
            }
            if (needCompile) {
                const source = await readTextFile(filePath);
                const compiled = await compile(source, filePath);
                await mkdir(dirname3(cacheFile), {
                    recursive: true
                });
                await writeTextFile(cacheFile, compiled);
            }
            modUrl = new URL(cacheFile, `file://${cwd()}/`).toString();
        }
    } else {
        if (!modUrl.includes("?bundle")) modUrl += "?bundle";
    }
    const modObj = await import(modUrl);
    if (modObj.default?.__hql_module) return modObj.default.__hql_module;
    if (modObj.__hql_module) return modObj.__hql_module;
    return wrapJsValue(modObj.default ?? modObj);
}
async function recurImport(npmUrl, cdns) {
    if (cdns.length === 0) throw new Error(`All CDN candidates failed for module ${npmUrl}`);
    const candidate = cdns[0];
    const replaced = npmUrl.replace(/^npm:/, candidate);
    try {
        const modObj = await import(replaced);
        if (modObj.default?.__hql_module) return modObj.default.__hql_module;
        if (modObj.__hql_module) return modObj.__hql_module;
        return wrapJsValue(modObj.default ?? modObj);
    } catch (e) {
        return await recurImport(npmUrl, cdns.slice(1));
    }
}
async function handleFunctionCallAsync(fnVal, rest, env) {
    const argVals = [];
    for (const r of rest){
        if (r.type === "symbol" && r.name.endsWith(":")) argVals.push(r);
        else argVals.push(await evaluateAsync(r, env));
    }
    return await applyFnAsync(fnVal, argVals);
}
function handleFunctionCallSync(fnVal, rest, env) {
    const argVals = [];
    for (const r of rest){
        if (r.type === "symbol" && r.name.endsWith(":")) argVals.push(r);
        else argVals.push(evaluateSync(r, env));
    }
    return applyFnSync(fnVal, argVals);
}
async function handleNewAsync(rest, env) {
    if (rest.length === 0) throw new Error("(new) expects at least one argument");
    const ctorVal = await evaluateAsync(rest[0], env);
    const jsCtor = hqlToJs(ctorVal);
    const args = [];
    for(let j = 1; j < rest.length; j++){
        const argVal = await evaluateAsync(rest[j], env);
        args.push(hqlToJs(argVal));
    }
    if (jsCtor === Set && args.length === 1) {
        args[0] = Array.from(args[0]);
    }
    return wrapJsValue(Reflect.construct(jsCtor, args));
}
function handleNewSync(rest, env) {
    if (rest.length === 0) throw new Error("(new) expects at least one argument");
    const ctorVal = evaluateSync(rest[0], env);
    const jsCtor = hqlToJs(ctorVal);
    const args = [];
    for(let j = 1; j < rest.length; j++){
        const argVal = evaluateSync(rest[j], env);
        args.push(hqlToJs(argVal));
    }
    if (jsCtor === Set && args.length === 1) {
        args[0] = Array.from(args[0]);
    }
    return wrapJsValue(Reflect.construct(jsCtor, args));
}
async function handleIfAsync(rest, env) {
    const cond = await evaluateAsync(rest[0], env);
    return truthy(cond) ? rest[1] ? await evaluateAsync(rest[1], env) : makeNil() : rest[2] ? await evaluateAsync(rest[2], env) : makeNil();
}
function handleIfSync(rest, env) {
    const cond = evaluateSync(rest[0], env);
    return truthy(cond) ? rest[1] ? evaluateSync(rest[1], env) : makeNil() : rest[2] ? evaluateSync(rest[2], env) : makeNil();
}
function makeRelativePath(fromDir, toPath) {
    let rel = relative3(fromDir, toPath);
    if (!rel.startsWith(".") && !rel.startsWith("/")) {
        rel = "./" + rel;
    }
    return rel;
}
function hostFunc(fn) {
    return {
        type: "function",
        params: [],
        body: [],
        closure: baseEnv,
        isMacro: false,
        hostFn: fn,
        typed: false
    };
}
function numericOp(op) {
    return (args)=>{
        if (args.length === 0) {
            if (op === "-" || op === "/") throw new Error(`'${op}' expects at least one argument`);
        }
        const nums = args.map((a)=>{
            if (a.type !== "number") throw new Error(`Expected number in ${op}`);
            return a.value;
        });
        switch(op){
            case "+":
                return makeNumber(nums.reduce((acc, x)=>acc + x, 0));
            case "*":
                return makeNumber(nums.reduce((acc, x)=>acc * x, 1));
            case "-":
                return makeNumber(nums.length === 1 ? -nums[0] : nums.slice(1).reduce((acc, x)=>acc - x, nums[0]));
            case "/":
                return makeNumber(nums.length === 1 ? 1 / nums[0] : nums.slice(1).reduce((acc, x)=>acc / x, nums[0]));
            default:
                return makeNil();
        }
    };
}
const stdlibs = {
    print: hostFunc((args)=>{
        console.log(...args.map((a)=>formatValue(a)));
        return makeNil();
    }),
    log: hostFunc((args)=>{
        console.log(...args.map((a)=>formatValue(a)));
        return makeNil();
    }),
    keyword: hostFunc(([s])=>{
        if (!s || s.type !== "string") throw new Error("(keyword) expects one string");
        return makeSymbol(":" + s.value);
    }),
    "+": hostFunc(numericOp("+")),
    "-": hostFunc(numericOp("-")),
    "*": hostFunc(numericOp("*")),
    "/": hostFunc(numericOp("/")),
    "string-append": hostFunc((args)=>{
        const out = args.map((a)=>a.type === "string" ? a.value : formatValue(a)).join("");
        return makeString(out);
    }),
    list: hostFunc((args)=>makeList(args)),
    vector: hostFunc((args)=>makeList([
            makeSymbol("vector"),
            ...args
        ])),
    "hash-map": hostFunc((args)=>makeList([
            makeSymbol("hash-map"),
            ...args
        ])),
    set: hostFunc((args)=>wrapJsValue(new Set(args.map((a)=>hqlToJs(a))))),
    get: hostFunc(([obj, prop])=>{
        const jsObj = obj && obj.type === "opaque" ? obj.value : hqlToJs(obj);
        const key = prop && prop.type === "string" ? prop.value : formatValue(prop);
        const val = jsObj?.[key];
        if (typeof val === "function") {
            const n = val.length;
            const paramNames = [];
            for(let i = 0; i < n; i++){
                paramNames.push("arg" + i);
            }
            return {
                type: "function",
                params: paramNames,
                body: [],
                closure: baseEnv,
                hostFn: (args)=>{
                    const jsArgs = args.map(hqlToJs);
                    const r = val(...jsArgs);
                    return r instanceof Promise ? r.then(jsToHql) : jsToHql(r);
                },
                typed: false
            };
        }
        return jsToHql(val);
    }),
    now: hostFunc(()=>wrapJsValue(new Date())),
    "->": hostFunc((args)=>{
        if (args.length < 2) return args[0];
        let acc = args[0];
        for(let i = 1; i < args.length; i++){
            const form = args[i];
            if (form.type !== "list" || form.value.length === 0) {
                throw new Error("-> expects each subsequent argument to be a non-empty list");
            }
            const fn = evaluateSync(form.value[0], baseEnv);
            if (fn.type !== "function") {
                throw new Error("-> expects a function in threaded position");
            }
            const newArgs = [
                acc,
                ...form.value.slice(1)
            ];
            acc = applyFnSync(fn, newArgs);
        }
        return acc;
    }),
    import: hostFunc(async (args)=>{
        if (args.length < 1) throw new Error("(import) expects a URL");
        const urlVal = await evaluateAsync(args[0], baseEnv);
        if (urlVal.type !== "string") throw new Error("import expects a string URL");
        return await doImport(urlVal.value);
    })
};
baseEnv.set("Set", wrapJsValue(Set));
baseEnv.set("Array", wrapJsValue(Array));
baseEnv.set("Map", wrapJsValue(Map));
baseEnv.set("Date", wrapJsValue(Date));
baseEnv.set("RegExp", wrapJsValue(RegExp));
baseEnv.set("Error", wrapJsValue(Error));
baseEnv.set("URL", wrapJsValue(URL));
baseEnv.set("str", stdlibs["string-append"]);
for(const lib in stdlibs){
    baseEnv.set(lib, stdlibs[lib]);
}
async function readLineFromStdin() {
    const buf = new Uint8Array(1024);
    const n = await dntShim.Deno.stdin.read(buf);
    if (n === null) return null;
    return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
}
async function writeToStdout(text) {
    await dntShim.Deno.stdout.write(new TextEncoder().encode(text));
}
async function readLine() {
    return await readLineFromStdin();
}
function countParens(input) {
    let c = 0, str = false;
    for(let i = 0; i < input.length; i++){
        const ch = input.charAt(i);
        if (ch === '"' && (i === 0 || input.charAt(i - 1) !== "\\")) {
            str = !str;
        }
        if (!str) {
            if (ch === "(") c++;
            else if (ch === ")") c--;
        }
    }
    return c;
}
async function readMultiline() {
    let code = "";
    let pc = 0;
    while(true){
        const prompt = pc > 0 ? "...> " : "HQL> ";
        await writeToStdout(prompt);
        const line = await readLine();
        if (line === null) return code.trim() === "" ? null : code;
        code += line + "\n";
        pc = countParens(code);
        if (pc <= 0) break;
    }
    return code;
}
async function repl(env) {
    while(true){
        const hql = await readMultiline();
        if (hql === null) {
            console.log("\nGoodbye.");
            return;
        }
        if (!hql.trim()) continue;
        if (hql.trim() === "(exit)") {
            console.log("Goodbye.");
            return;
        }
        try {
            const forms = parse(hql);
            let result = makeNil();
            for (const f of forms){
                result = await evaluateAsync(f, env);
            }
            console.log(formatValue(result));
        } catch (e) {
            console.error("Error:", e.message);
        }
    }
}
const importRegex = /import\s+.*?from\s+["'](.+?\.hql)["']/g;
async function collectHqlImports(content, baseFile, cacheDir, visited) {
    const mappings = {};
    let match;
    const regex = new RegExp(importRegex);
    while((match = regex.exec(content)) !== null){
        const importPath = match[1];
        const importedAbs = resolve3(dirname3(baseFile), importPath);
        const subMap = await buildImportMap(importedAbs, cacheDir, visited);
        Object.assign(mappings, subMap);
    }
    return mappings;
}
async function buildImportMap(entryFile, cacheDir, visited = new Set()) {
    const mappings = {};
    const absoluteFilePath = resolve3(entryFile);
    if (!absoluteFilePath.endsWith(".hql")) return mappings;
    if (visited.has(absoluteFilePath)) return mappings;
    visited.add(absoluteFilePath);
    const content = await readTextFile(absoluteFilePath);
    const relPath = absoluteFilePath.substring(cwd().length);
    const outPath = join4(cacheDir, relPath) + ".js";
    await mkdir(dirname3(outPath), {
        recursive: true
    });
    const compiled = await compile(content, absoluteFilePath, true);
    await writeTextFile(outPath, compiled);
    const absEntryUrl = new URL("file://" + absoluteFilePath).href;
    const absOutUrl = new URL("file://" + resolve3(outPath)).href;
    mappings[absEntryUrl] = absOutUrl;
    const subMappings = await collectHqlImports(content, absoluteFilePath, cacheDir, visited);
    Object.assign(mappings, subMappings);
    return mappings;
}
async function buildImportMapForJS(entryJs, cacheDir) {
    const mappings = {};
    const absEntryJs = resolve3(entryJs);
    const content = await readTextFile(absEntryJs);
    const subMappings = await collectHqlImports(content, absEntryJs, cacheDir, new Set());
    Object.assign(mappings, subMappings);
    return mappings;
}
class AssertionError extends Error {
    constructor(message){
        super(message);
        this.name = "AssertionError";
    }
}
function assertExists(actual, msg) {
    if (actual === undefined || actual === null) {
        const msgSuffix = msg ? `: ${msg}` : ".";
        msg = `Expected actual: "${actual}" to not be null or undefined${msgSuffix}`;
        throw new AssertionError(msg);
    }
}
const { hasOwn } = Object;
function get(obj, key) {
    if (hasOwn(obj, key)) {
        return obj[key];
    }
}
function getForce(obj, key) {
    const v = get(obj, key);
    assertExists(v);
    return v;
}
function isNumber(x) {
    if (typeof x === "number") return true;
    if (/^0x[0-9a-f]+$/i.test(String(x))) return true;
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(String(x));
}
function hasKey(obj, keys) {
    let o = obj;
    keys.slice(0, -1).forEach((key)=>{
        o = get(o, key) ?? {};
    });
    const key = keys.at(-1);
    return key !== undefined && hasOwn(o, key);
}
function parse4(args, { "--": doubleDash = false, alias = {}, boolean: __boolean = false, default: defaults = {}, stopEarly = false, string = [], collect = [], negatable = [], unknown = (i)=>i } = {}) {
    const aliases = {};
    const flags = {
        bools: {},
        strings: {},
        unknownFn: unknown,
        allBools: false,
        collect: {},
        negatable: {}
    };
    if (alias !== undefined) {
        for(const key in alias){
            const val = getForce(alias, key);
            if (typeof val === "string") {
                aliases[key] = [
                    val
                ];
            } else {
                aliases[key] = val;
            }
            const aliasesForKey = getForce(aliases, key);
            for (const alias of aliasesForKey){
                aliases[alias] = [
                    key
                ].concat(aliasesForKey.filter((y)=>alias !== y));
            }
        }
    }
    if (__boolean !== undefined) {
        if (typeof __boolean === "boolean") {
            flags.allBools = !!__boolean;
        } else {
            const booleanArgs = typeof __boolean === "string" ? [
                __boolean
            ] : __boolean;
            for (const key of booleanArgs.filter(Boolean)){
                flags.bools[key] = true;
                const alias = get(aliases, key);
                if (alias) {
                    for (const al of alias){
                        flags.bools[al] = true;
                    }
                }
            }
        }
    }
    if (string !== undefined) {
        const stringArgs = typeof string === "string" ? [
            string
        ] : string;
        for (const key of stringArgs.filter(Boolean)){
            flags.strings[key] = true;
            const alias = get(aliases, key);
            if (alias) {
                for (const al of alias){
                    flags.strings[al] = true;
                }
            }
        }
    }
    if (collect !== undefined) {
        const collectArgs = typeof collect === "string" ? [
            collect
        ] : collect;
        for (const key of collectArgs.filter(Boolean)){
            flags.collect[key] = true;
            const alias = get(aliases, key);
            if (alias) {
                for (const al of alias){
                    flags.collect[al] = true;
                }
            }
        }
    }
    if (negatable !== undefined) {
        const negatableArgs = typeof negatable === "string" ? [
            negatable
        ] : negatable;
        for (const key of negatableArgs.filter(Boolean)){
            flags.negatable[key] = true;
            const alias = get(aliases, key);
            if (alias) {
                for (const al of alias){
                    flags.negatable[al] = true;
                }
            }
        }
    }
    const argv = {
        _: []
    };
    function argDefined(key, arg) {
        return flags.allBools && /^--[^=]+$/.test(arg) || get(flags.bools, key) || !!get(flags.strings, key) || !!get(aliases, key);
    }
    function setKey(obj, name, value, collect = true) {
        let o = obj;
        const keys = name.split(".");
        keys.slice(0, -1).forEach(function(key) {
            if (get(o, key) === undefined) {
                o[key] = {};
            }
            o = get(o, key);
        });
        const key = keys.at(-1);
        const collectable = collect && !!get(flags.collect, name);
        if (!collectable) {
            o[key] = value;
        } else if (get(o, key) === undefined) {
            o[key] = [
                value
            ];
        } else if (Array.isArray(get(o, key))) {
            o[key].push(value);
        } else {
            o[key] = [
                get(o, key),
                value
            ];
        }
    }
    function setArg(key, val, arg = undefined, collect) {
        if (arg && flags.unknownFn && !argDefined(key, arg)) {
            if (flags.unknownFn(arg, key, val) === false) return;
        }
        const value = !get(flags.strings, key) && isNumber(val) ? Number(val) : val;
        setKey(argv, key, value, collect);
        const alias = get(aliases, key);
        if (alias) {
            for (const x of alias){
                setKey(argv, x, value, collect);
            }
        }
    }
    function aliasIsBoolean(key) {
        return getForce(aliases, key).some((x)=>typeof get(flags.bools, x) === "boolean");
    }
    let notFlags = [];
    if (args.includes("--")) {
        notFlags = args.slice(args.indexOf("--") + 1);
        args = args.slice(0, args.indexOf("--"));
    }
    for(let i = 0; i < args.length; i++){
        const arg = args[i];
        assertExists(arg);
        if (/^--.+=/.test(arg)) {
            const m = arg.match(/^--([^=]+)=(.*)$/s);
            assertExists(m);
            const [, key, value] = m;
            assertExists(key);
            if (flags.bools[key]) {
                const booleanValue = value !== "false";
                setArg(key, booleanValue, arg);
            } else {
                setArg(key, value, arg);
            }
        } else if (/^--no-.+/.test(arg) && get(flags.negatable, arg.replace(/^--no-/, ""))) {
            const m = arg.match(/^--no-(.+)/);
            assertExists(m);
            assertExists(m[1]);
            setArg(m[1], false, arg, false);
        } else if (/^--.+/.test(arg)) {
            const m = arg.match(/^--(.+)/);
            assertExists(m);
            assertExists(m[1]);
            const [, key] = m;
            const next = args[i + 1];
            if (next !== undefined && !/^-/.test(next) && !get(flags.bools, key) && !flags.allBools && (get(aliases, key) ? !aliasIsBoolean(key) : true)) {
                setArg(key, next, arg);
                i++;
            } else if (next !== undefined && (next === "true" || next === "false")) {
                setArg(key, next === "true", arg);
                i++;
            } else {
                setArg(key, get(flags.strings, key) ? "" : true, arg);
            }
        } else if (/^-[^-]+/.test(arg)) {
            const letters = arg.slice(1, -1).split("");
            let broken = false;
            for (const [j, letter] of letters.entries()){
                const next = arg.slice(j + 2);
                if (next === "-") {
                    setArg(letter, next, arg);
                    continue;
                }
                if (/[A-Za-z]/.test(letter) && next.includes("=")) {
                    setArg(letter, next.split(/=(.+)/)[1], arg);
                    broken = true;
                    break;
                }
                if (/[A-Za-z]/.test(letter) && /-?\d+(\.\d*)?(e-?\d+)?$/.test(next)) {
                    setArg(letter, next, arg);
                    broken = true;
                    break;
                }
                if (letters[j + 1]?.match(/\W/)) {
                    setArg(letter, arg.slice(j + 2), arg);
                    broken = true;
                    break;
                } else {
                    setArg(letter, get(flags.strings, letter) ? "" : true, arg);
                }
            }
            const key = arg.at(-1);
            if (!broken && key !== "-") {
                const nextArg = args[i + 1];
                if (nextArg && !/^(-|--)[^-]/.test(nextArg) && !get(flags.bools, key) && (get(aliases, key) ? !aliasIsBoolean(key) : true)) {
                    setArg(key, nextArg, arg);
                    i++;
                } else if (nextArg && (nextArg === "true" || nextArg === "false")) {
                    setArg(key, nextArg === "true", arg);
                    i++;
                } else {
                    setArg(key, get(flags.strings, key) ? "" : true, arg);
                }
            }
        } else {
            if (!flags.unknownFn || flags.unknownFn(arg) !== false) {
                argv._.push(flags.strings["_"] ?? !isNumber(arg) ? arg : Number(arg));
            }
            if (stopEarly) {
                argv._.push(...args.slice(i + 1));
                break;
            }
        }
    }
    for (const [key, value] of Object.entries(defaults)){
        if (!hasKey(argv, key.split("."))) {
            setKey(argv, key, value, false);
            const alias = aliases[key];
            if (alias !== undefined) {
                for (const x of alias){
                    setKey(argv, x, value, false);
                }
            }
        }
    }
    for (const key of Object.keys(flags.bools)){
        if (!hasKey(argv, key.split("."))) {
            const value = get(flags.collect, key) ? [] : false;
            setKey(argv, key, value, false);
        }
    }
    for (const key of Object.keys(flags.strings)){
        if (!hasKey(argv, key.split(".")) && get(flags.collect, key)) {
            setKey(argv, key, [], false);
        }
    }
    if (doubleDash) {
        argv["--"] = [];
        for (const key of notFlags){
            argv["--"].push(key);
        }
    } else {
        for (const key of notFlags){
            argv._.push(key);
        }
    }
    return argv;
}
function isSubdir(src, dest, sep = sep2) {
    if (src === dest) {
        return false;
    }
    src = toPathString(src);
    const srcArray = src.split(sep);
    dest = toPathString(dest);
    const destArray = dest.split(sep);
    return srcArray.every((current, i)=>destArray[i] === current);
}
function getFileInfoType(fileInfo) {
    return fileInfo.isFile ? "file" : fileInfo.isDirectory ? "dir" : fileInfo.isSymlink ? "symlink" : undefined;
}
function toPathString(path) {
    return path instanceof URL ? fromFileUrl2(path) : path;
}
async function ensureDir(dir) {
    try {
        const fileInfo = await dntShim.Deno.lstat(dir);
        if (!fileInfo.isDirectory) {
            throw new Error(`Ensure path exists, expected 'dir', got '${getFileInfoType(fileInfo)}'`);
        }
    } catch (err) {
        if (err instanceof dntShim.Deno.errors.NotFound) {
            await dntShim.Deno.mkdir(dir, {
                recursive: true
            });
            return;
        }
        throw err;
    }
}
async function exists(filePath) {
    try {
        await dntShim.Deno.lstat(filePath);
        return true;
    } catch (error) {
        if (error instanceof dntShim.Deno.errors.NotFound) {
            return false;
        }
        throw error;
    }
}
new dntShim.Deno.errors.AlreadyExists("dest already exists.");
async function ensureValidCopy(src, dest, options) {
    let destStat;
    try {
        destStat = await dntShim.Deno.lstat(dest);
    } catch (err) {
        if (err instanceof dntShim.Deno.errors.NotFound) {
            return;
        }
        throw err;
    }
    if (options.isFolder && !destStat.isDirectory) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
    }
    if (!options.overwrite) {
        throw new dntShim.Deno.errors.AlreadyExists(`'${dest}' already exists.`);
    }
    return destStat;
}
async function copyFile(src, dest, options) {
    await ensureValidCopy(src, dest, options);
    await dntShim.Deno.copyFile(src, dest);
    if (options.preserveTimestamps) {
        const statInfo = await dntShim.Deno.stat(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, statInfo.atime, statInfo.mtime);
    }
}
async function copySymLink(src, dest, options) {
    await ensureValidCopy(src, dest, options);
    const originSrcFilePath = await dntShim.Deno.readLink(src);
    const type = getFileInfoType(await dntShim.Deno.lstat(src));
    if (isWindows) {
        await dntShim.Deno.symlink(originSrcFilePath, dest, {
            type: type === "dir" ? "dir" : "file"
        });
    } else {
        await dntShim.Deno.symlink(originSrcFilePath, dest);
    }
    if (options.preserveTimestamps) {
        const statInfo = await dntShim.Deno.lstat(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, statInfo.atime, statInfo.mtime);
    }
}
async function copyDir(src, dest, options) {
    const destStat = await ensureValidCopy(src, dest, {
        ...options,
        isFolder: true
    });
    if (!destStat) {
        await ensureDir(dest);
    }
    if (options.preserveTimestamps) {
        const srcStatInfo = await dntShim.Deno.stat(src);
        assert(srcStatInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(srcStatInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, srcStatInfo.atime, srcStatInfo.mtime);
    }
    src = toPathString(src);
    dest = toPathString(dest);
    for await (const entry of dntShim.Deno.readDir(src)){
        const srcPath = join3(src, entry.name);
        const destPath = join3(dest, basename2(srcPath));
        if (entry.isSymlink) {
            await copySymLink(srcPath, destPath, options);
        } else if (entry.isDirectory) {
            await copyDir(srcPath, destPath, options);
        } else if (entry.isFile) {
            await copyFile(srcPath, destPath, options);
        }
    }
}
async function copy(src, dest, options = {}) {
    src = resolve2(toPathString(src));
    dest = resolve2(toPathString(dest));
    if (src === dest) {
        throw new Error("Source and destination cannot be the same.");
    }
    const srcStat = await dntShim.Deno.lstat(src);
    if (srcStat.isDirectory && isSubdir(src, dest)) {
        throw new Error(`Cannot copy '${src}' to a subdirectory of itself, '${dest}'.`);
    }
    if (srcStat.isSymlink) {
        await copySymLink(src, dest, options);
    } else if (srcStat.isDirectory) {
        await copyDir(src, dest, options);
    } else if (srcStat.isFile) {
        await copyFile(src, dest, options);
    }
}
var EOL;
(function(EOL) {
    EOL["LF"] = "\n";
    EOL["CRLF"] = "\r\n";
})(EOL || (EOL = {}));
async function buildJsModule(inputDir) {
    const outDir = resolve3(inputDir);
    await mkdir(outDir, {
        recursive: true
    });
    const hqlFiles = [];
    for await (const entry of readDir(outDir)){
        if (entry.isFile && entry.name.endsWith(".hql")) {
            hqlFiles.push(entry.name);
        }
    }
    if (hqlFiles.length === 0) {
        console.error(`No .hql files found in ${outDir}`);
        exit(1);
    }
    for (const file of hqlFiles){
        const filePath = join4(outDir, file);
        const source = await readTextFile(filePath);
        const compiled = await compile(source, filePath, false);
        const outJS = filePath + ".js";
        await writeTextFile(outJS, compiled);
        console.log(`Transpiled ${filePath} -> ${outJS}`);
    }
    const aggregatorPath = join4(outDir, "all_hql_modules.ts");
    const lines = hqlFiles.map((file)=>{
        return `export * from "./${file}.js";`;
    });
    await writeTextFile(aggregatorPath, lines.join("\n"));
    console.log(`Created aggregator file at ${aggregatorPath}`);
    const bundlePath = join4(outDir, "bundle.js");
    console.log(`Bundling aggregator into ${bundlePath}...`);
    const bundleProc = runCmd({
        cmd: [
            "deno",
            "bundle",
            aggregatorPath,
            bundlePath
        ],
        stdout: "inherit",
        stderr: "inherit"
    });
    const bundleStatus = await bundleProc.status();
    bundleProc.close();
    if (!bundleStatus.success) {
        console.error("deno bundle failed.");
        exit(bundleStatus.code);
    }
    console.log(`Created bundle at ${bundlePath}`);
    const dntConfigContent = `
import { build, emptyDir } from "https://deno.land/x/dnt@0.37.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./bundle.js"],
  outDir: "./npm",
  // By default, dnt emits the final ESM package into npm/esm.
  // We leave that as is—your jsr.json will reference "./esm/bundle.js".
  shims: {
    deno: true,
  },
  scriptModule: false,
  test: false,
  package: {
    name: "",
    version: "0.0.0"
  },
});
`.trim();
    const buildTsPath = join4(outDir, "build.ts");
    await writeTextFile(buildTsPath, dntConfigContent);
    console.log(`Created build.ts at ${buildTsPath}`);
    console.log("Running dnt build via build.ts...");
    const dntProc = runCmd({
        cmd: [
            "deno",
            "run",
            "-A",
            "build.ts"
        ],
        cwd: outDir,
        stdout: "inherit",
        stderr: "inherit"
    });
    const dntStatus = await dntProc.status();
    dntProc.close();
    if (!dntStatus.success) {
        console.error("dnt build failed.");
        exit(dntStatus.code);
    }
    console.log(`dnt build succeeded. npm directory created at ${join4(outDir, "npm")}`);
}
async function getNpmUsername() {
    let npmUser = getEnv("NPM_USERNAME");
    if (npmUser) return npmUser.trim();
    try {
        const proc = runCmd({
            cmd: [
                "npm",
                "whoami"
            ],
            stdout: "piped",
            stderr: "null"
        });
        const output = await proc.output();
        proc.close();
        npmUser = new TextDecoder().decode(output).trim();
        return npmUser || undefined;
    } catch (e) {
        console.error("Failed to auto-detect npm username:", e);
        return undefined;
    }
}
async function publishNpm(options) {
    const outDir = resolve3(options.what);
    await mkdir(outDir, {
        recursive: true
    });
    await buildJsModule(outDir);
    const npmDistDir = join4(outDir, "npm");
    if (!await exists(npmDistDir)) {
        console.error("npm/ folder not found. Did dnt build fail?");
        exit(1);
    }
    const pkgJsonPath = join4(npmDistDir, "package.json");
    if (!await exists(pkgJsonPath)) {
        console.error("package.json not found in npm/.");
        exit(1);
    }
    let pkg = JSON.parse(await readTextFile(pkgJsonPath));
    let currentVersion = pkg.version || "0.0.1";
    let newVersion;
    if (options.version) {
        newVersion = options.version;
    } else {
        const [major, minor, patch] = currentVersion.split(".");
        newVersion = `${major}.${minor}.${Number(patch) + 1}`;
    }
    pkg.version = newVersion;
    let pkgName;
    if (options.name) {
        pkgName = options.name.startsWith("@") ? options.name : (()=>{
            const npmUser = getEnv("NPM_USERNAME") || "";
            return npmUser ? `@${npmUser.trim()}/${options.name}` : options.name;
        })();
    } else {
        const npmUser = await getNpmUsername();
        const dirName = outDir.split("/").pop() || "hql-package";
        pkgName = npmUser ? `@${npmUser}/${dirName}` : dirName;
    }
    pkgName = pkgName.toLowerCase().replace(/_/g, "-");
    pkg.name = pkgName;
    await writeTextFile(pkgJsonPath, JSON.stringify(pkg, null, 2));
    console.log(`Updated package.json in npm/ with name=${pkgName} version=${newVersion}`);
    const readmePath = join4(npmDistDir, "README.md");
    if (!await exists(readmePath)) {
        await writeTextFile(readmePath, `# ${pkgName}\n\nAuto-generated README. Please update.`);
    }
    const dryRun = getEnv("DRY_RUN_PUBLISH");
    const publishCmd = dryRun ? [
        "npm",
        "publish",
        "--dry-run",
        "--access",
        "public"
    ] : [
        "npm",
        "publish",
        "--access",
        "public"
    ];
    console.log(`Publishing package "${pkgName}" to npm from ${npmDistDir}...`);
    const proc = runCmd({
        cmd: publishCmd,
        cwd: npmDistDir,
        stdout: "inherit",
        stderr: "inherit"
    });
    const status = await proc.status();
    proc.close();
    if (!status.success) {
        console.error("npm publish failed. Make sure you're logged in and have permission.");
        exit(status.code);
    }
    console.log(`Package published successfully! See https://www.npmjs.com/package/${pkgName}`);
}
async function publishJSR(options) {
    const outDir = resolve3(options.what);
    await mkdir(outDir, {
        recursive: true
    });
    await buildJsModule(outDir);
    const npmDistDir = join4(outDir, "npm");
    if (!await exists(npmDistDir)) {
        console.error("npm/ folder not found. Did dnt build fail?");
        exit(1);
    }
    const pkgJsonPath = join4(npmDistDir, "package.json");
    if (!await exists(pkgJsonPath)) {
        console.error("package.json not found in npm/.");
        exit(1);
    }
    let pkg = JSON.parse(await readTextFile(pkgJsonPath));
    let currentVersion = pkg.version || "0.0.1";
    let newVersion;
    if (options.version) {
        newVersion = options.version;
    } else {
        const [major, minor, patch] = currentVersion.split(".");
        newVersion = `${major}.${minor}.${Number(patch) + 1}`;
    }
    pkg.version = newVersion;
    const dirName = outDir.split("/").pop() || "hql-package";
    const defaultScopedName = `@boraseoksoon/${dirName.toLowerCase().replace(/_/g, "-")}`;
    let finalName = (options.name || defaultScopedName).toLowerCase().replace(/_/g, "-");
    pkg.name = finalName;
    await writeTextFile(pkgJsonPath, JSON.stringify(pkg, null, 2));
    const jsrPath = join4(npmDistDir, "jsr.json");
    const jsrConfig = {
        name: finalName,
        version: newVersion,
        exports: "./esm/bundle.js",
        license: "MIT"
    };
    await writeTextFile(jsrPath, JSON.stringify(jsrConfig, null, 2));
    console.log(`Created jsr.json in npm/: ${jsrPath}`);
    console.log(`jsr.json content: ${JSON.stringify(jsrConfig, null, 2)}`);
    const readmePath = join4(npmDistDir, "README.md");
    if (!await exists(readmePath)) {
        await writeTextFile(readmePath, `# ${finalName}\n\nAuto-generated README for JSR publish.`);
    }
    const tempDir = await makeTempDir();
    await copy(npmDistDir, tempDir, {
        overwrite: true
    });
    console.log(`Publishing ${finalName}@${newVersion} to JSR from npm/ folder...`);
    const publishProc = runCmd({
        cmd: [
            "deno",
            "publish",
            "--allow-dirty",
            "--allow-slow-types"
        ],
        cwd: tempDir,
        stdout: "inherit",
        stderr: "inherit"
    });
    const status = await publishProc.status();
    publishProc.close();
    if (!status.success) {
        console.error("deno publish failed. Please fix errors and try again.");
        exit(status.code);
    }
    console.log(`JSR publish succeeded! See https://jsr.io/packages/${encodeURIComponent(finalName)}`);
}
function normalizeArgs(args) {
    const allowed = new Set([
        "what",
        "name",
        "version",
        "where"
    ]);
    return args.map((arg)=>{
        if (arg.startsWith("-") && !arg.startsWith("--")) {
            const key = arg.slice(1);
            if (allowed.has(key)) {
                return `--${key}`;
            }
        }
        return arg;
    });
}
function parsePublishArgs(args) {
    const normalizedArgs = normalizeArgs(args);
    const parsed = parse4(normalizedArgs, {
        string: [
            "what",
            "name",
            "version",
            "where"
        ]
    });
    const allowedFlags = new Set([
        "what",
        "name",
        "version",
        "where",
        "_"
    ]);
    for (const key of Object.keys(parsed)){
        if (!allowedFlags.has(key)) {
            console.error(`Unknown flag: --${key}. Allowed flags: -what, -name, -version, -where.`);
            exit(1);
        }
    }
    if (parsed.version && !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
        console.error(`Invalid version format: ${parsed.version}. Expected format: X.Y.Z`);
        exit(1);
    }
    let platform = "jsr";
    if (parsed.where) {
        const whereVal = String(parsed.where).toLowerCase();
        if (whereVal === "npm" || whereVal === "jsr") {
            platform = whereVal;
        } else {
            console.error("Invalid value for -where flag. Must be 'npm' or 'jsr'.");
            exit(1);
        }
    }
    const pos = parsed._;
    let what = pos.length > 0 ? String(pos[0]) : cwd();
    if (pos.length > 0 && [
        "npm",
        "jsr"
    ].includes(String(pos[0]).toLowerCase())) {
        platform = String(pos[0]).toLowerCase();
        what = pos.length > 1 ? String(pos[1]) : cwd();
    }
    if (parsed.what) {
        what = String(parsed.what);
    }
    if (!what) {
        what = cwd();
    }
    let name;
    if (parsed.name) {
        name = String(parsed.name);
    } else {
        if (platform === "jsr") {
            if (pos.length >= 3) {
                name = String(pos[2]);
            }
            if (!name) {
                name = `@boraseoksoon/${basename3(what)}`;
            }
        } else if (platform === "npm") {
            if (pos.length >= 3 && ![
                "npm",
                "jsr"
            ].includes(String(pos[0]).toLowerCase())) {
                name = String(pos[2]);
            } else if (pos.length >= 4) {
                name = String(pos[3]);
            }
        }
    }
    let version;
    if (parsed.version) {
        version = String(parsed.version);
    } else {
        if (platform === "jsr") {
            if (pos.length >= 4) {
                version = String(pos[3]);
            }
        } else if (platform === "npm") {
            if (pos.length >= 3 && ![
                "npm",
                "jsr"
            ].includes(String(pos[0]).toLowerCase())) {
                version = String(pos[3]);
            } else if (pos.length >= 4) {
                version = String(pos[4]);
            }
        }
    }
    return {
        platform,
        what,
        name,
        version
    };
}
async function publish(args) {
    const options = parsePublishArgs(args);
    if (options.platform === "npm") {
        console.log(`Publishing npm package with:
  Directory: ${options.what}
  Package Name: ${options.name ?? "(auto-generated)"}
  Version: ${options.version ?? "(auto-incremented)"}`);
        await publishNpm({
            what: options.what,
            name: options.name,
            version: options.version
        });
    } else {
        console.log(`Publishing JSR package with:
  Directory: ${options.what}
  Package Name: ${options.name ?? "(auto-generated)"}
  Version: ${options.version ?? "(auto-incremented)"}`);
        await publishJSR({
            what: options.what,
            name: options.name,
            version: options.version
        });
    }
}
async function exportHqlModules(path, targetExports) {
    const exportsMap = targetExports || {};
    const hql = await readTextFile(path);
    const forms = parse(hql);
    const env = new Env({}, baseEnv);
    env.exports = exportsMap;
    env.fileBase = realPathSync(path);
    for (const f of forms){
        await evaluateAsync(f, env, realPathSync(path));
    }
    for(const key in env.bindings){
        if (!exportsMap.hasOwnProperty(key)) {
            exportsMap[key] = env.bindings[key];
        }
    }
    return exportsMap;
}
function getHqlModule(name, targetExports) {
    if (!Object.prototype.hasOwnProperty.call(targetExports, name)) {
        throw new Error(`HQL export '${name}' not found`);
    }
    return hqlToJs(targetExports[name]);
}
const importMeta = {
    url: "file:///Users/seoksoonjang/dev/hql/hql.ts",
    main: false
};
async function startRepl() {
    const env = new Env();
    await repl(env);
}
async function startCmd(args) {
    if (args.length < 2) {
        console.log("Usage:");
        console.log("  hql run <file>");
        dntShim.Deno.exit(1);
    }
    const file = args[1];
    const projectRoot = cwd();
    const cacheDir = join4(projectRoot, ".hqlcache");
    const importMap = {
        imports: {}
    };
    let entryFile = file;
    if (file.endsWith(".hql")) {
        const absoluteInput = resolve3(file);
        const source = await readTextFile(absoluteInput);
        const compiled = await compile(source, absoluteInput, true);
        const outputFolder = absoluteInput.includes("/test/") ? join4(dirname3(absoluteInput), "transpiled") : dirname3(absoluteInput);
        await mkdir(outputFolder, {
            recursive: true
        });
        const baseName = basename3(absoluteInput, extname3(absoluteInput));
        const outputFile = join4(outputFolder, `${baseName}.hql.js`);
        await writeTextFile(outputFile, compiled);
        entryFile = outputFile;
        importMap.imports = await buildImportMap(absoluteInput, cacheDir);
    } else {
        entryFile = resolve3(file);
        importMap.imports = await buildImportMapForJS(entryFile, cacheDir);
    }
    if (Object.keys(importMap.imports).length > 0) {
        const importMapPath = join4(projectRoot, "hql_import_map.json");
        await writeTextFile(importMapPath, JSON.stringify(importMap, null, 2));
    }
    const command = [
        execPath(),
        "run",
        ...Object.keys(importMap.imports).length > 0 ? [
            `--import-map=${join4(projectRoot, "hql_import_map.json")}`
        ] : [],
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        entryFile
    ];
    await execute(command);
}
async function execute(cmd) {
    const proc = runCmd({
        cmd
    });
    const status = await proc.status();
    dntShim.Deno.exit(status.code);
}
async function transpile(args) {
    if (args.length < 2) {
        console.log("Usage:");
        console.log("  hql transpile <inputFile> [outputFile]");
        dntShim.Deno.exit(1);
    }
    const inputFile = args[1];
    const absoluteInput = resolve3(inputFile);
    const projectRoot = cwd();
    let outputFile;
    if (args.length >= 3) {
        outputFile = args[2];
        if (!isAbsolute3(outputFile)) {
            outputFile = resolve3(join4(projectRoot, outputFile));
        } else {
            outputFile = resolve3(outputFile);
        }
    } else {
        const baseName = basename3(absoluteInput, extname3(absoluteInput));
        outputFile = join4(dirname3(absoluteInput), `${baseName}.hql.js`);
    }
    const source = await readTextFile(absoluteInput);
    const compiled = await compile(source, absoluteInput, false, outputFile);
    await mkdir(dirname3(outputFile), {
        recursive: true
    });
    await writeTextFile(outputFile, compiled);
    console.log(`Transpiled ${absoluteInput} -> ${outputFile}`);
}
async function main() {
    const args = dntShim.Deno.args;
    if (args.length === 0) {
        await startRepl();
        return;
    }
    const command = args[0];
    switch(command){
        case "repl":
            await startRepl();
            break;
        case "run":
            await startCmd(args);
            break;
        case "transpile":
            await transpile(args);
            break;
        case "publish":
            await publish(args.slice(1));
            break;
        default:
            console.log("Unknown command.");
            console.log("Usage:");
            console.log("  hql repl");
            console.log("  hql run <file>");
            console.log("  hql transpile <inputFile> [outputFile]");
            console.log("  hql publish [targetDir] [-name <packageName>] [-version <version>] [-where <npm|jsr>]");
            dntShim.Deno.exit(1);
    }
}
if (importMeta.main) {
    main();
}
const _exports = await exportHqlModules("./add.hql");
async function add(...args) {
    const fn = getHqlModule("add", _exports);
    return await fn(...args);
}
export { add as add };
