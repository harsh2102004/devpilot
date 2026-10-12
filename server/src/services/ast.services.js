import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

// Helper to cleanly extract parameter names (handles identifiers, default values, destructuring)
const extractParamName = (param) => {
    if (!param) return "unknown";
    if (param.type === "Identifier") return param.name;
    if (param.type === "AssignmentPattern") return extractParamName(param.left);
    if (param.type === "RestElement") return `...${extractParamName(param.argument)}`;
    if (param.type === "ObjectPattern") return "{...}";
    if (param.type === "ArrayPattern") return "[...]";
    return "param";
};

/**
 * Parses code into AST and extracts metadata & symbols
 * @param {string} code - The source code of the file
 * @param {string} filePath - Path of the file being parsed
 * @returns {object} Extracted metadata (imports, exports, functions, classes, calls)
 */
export const parseCode = (code, filePath = "") => {
    const metadata = {
        filePath,
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
    };

    if (!code || typeof code !== "string") {
        return metadata;
    }

    try {
        const ast = parse(code, {
            sourceType: "module",
            plugins: ["jsx", "typescript"],
            errorRecovery: true,
        });

        traverse(ast, {
            // 1. Extract Imports (e.g., import { Project } from '../models/project.js')
            ImportDeclaration(path) {
                const source = path.node.source.value;
                const specifiers = path.node.specifiers.map((s) => {
                    if (s.type === "ImportDefaultSpecifier") {
                        return s.local.name;
                    }
                    if (s.type === "ImportSpecifier") {
                        return s.imported?.name || s.local.name;
                    }
                    if (s.type === "ImportNamespaceSpecifier") {
                        return `* as ${s.local.name}`;
                    }
                    return s.local.name;
                });

                metadata.imports.push({
                    source,
                    specifiers,
                    line: path.node.loc?.start.line || null,
                });
            },

            // 2. Extract Standard Functions (e.g., function calculateScore(...) { ... })
            FunctionDeclaration(path) {
                const name = path.node.id?.name || "anonymous";
                const params = path.node.params.map(extractParamName);

                metadata.functions.push({
                    name,
                    params,
                    isAsync: Boolean(path.node.async),
                    startLine: path.node.loc?.start.line || null,
                    endLine: path.node.loc?.end.line || null,
                });
            },

            // 3. Extract Variable-Assigned Functions (e.g., const startScan = async (...) => { ... })
            VariableDeclarator(path) {
                const init = path.node.init;
                if (!init) return;

                // Check for direct arrow functions or function expressions
                let funcNode = null;
                if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
                    funcNode = init;
                } else if (
                    init.type === "CallExpression" &&
                    init.arguments.length > 0 &&
                    (init.arguments[0].type === "ArrowFunctionExpression" ||
                        init.arguments[0].type === "FunctionExpression")
                ) {
                    // Catches higher-order wrappers like: asyncHandler(async (req, res) => { ... })
                    funcNode = init.arguments[0];
                }

                if (funcNode) {
                    const name = path.node.id?.name || "anonymous";
                    const params = funcNode.params.map(extractParamName);

                    metadata.functions.push({
                        name,
                        params,
                        isAsync: Boolean(funcNode.async),
                        startLine: path.node.loc?.start.line || null,
                        endLine: path.node.loc?.end.line || null,
                    });
                }
            },

            // 4. Extract Classes and Methods (e.g., class Scanner { parse() { ... } })
            ClassDeclaration(path) {
                const className = path.node.id?.name || "AnonymousClass";
                const superClass = path.node.superClass?.name || null;
                const methods = [];

                if (path.node.body && path.node.body.body) {
                    path.node.body.body.forEach((member) => {
                        if (member.type === "ClassMethod") {
                            methods.push({
                                name: member.key?.name || "anonymousMethod",
                                params: member.params.map(extractParamName),
                                isAsync: Boolean(member.async),
                                isStatic: Boolean(member.static),
                                kind: member.kind, // 'constructor', 'method', 'get', 'set'
                                startLine: member.loc?.start.line || null,
                                endLine: member.loc?.end.line || null,
                            });
                        }
                    });
                }

                metadata.classes.push({
                    name: className,
                    superClass,
                    methods,
                    startLine: path.node.loc?.start.line || null,
                    endLine: path.node.loc?.end.line || null,
                });
            },

            // 5. Extract Function and Method Calls (e.g., Job.create(), addScanJob())
            CallExpression(path) {
                let calleeName = "";
                const callee = path.node.callee;

                if (callee.type === "Identifier") {
                    calleeName = callee.name;
                } else if (callee.type === "MemberExpression") {
                    const obj = callee.object?.name || "";
                    const prop = callee.property?.name || "";
                    calleeName = obj ? `${obj}.${prop}` : prop;
                }

                if (calleeName) {
                    metadata.calls.push({
                        callee: calleeName,
                        line: path.node.loc?.start.line || null,
                    });
                }
            },

            // 6. Extract Named Exports (e.g., export const x = 1; or export { foo, bar })
            ExportNamedDeclaration(path) {
                if (path.node.declaration) {
                    const decl = path.node.declaration;
                    if (decl.declarations) {
                        decl.declarations.forEach((d) => {
                            if (d.id?.name) metadata.exports.push(d.id.name);
                        });
                    } else if (decl.id?.name) {
                        metadata.exports.push(decl.id.name);
                    }
                } else if (path.node.specifiers) {
                    path.node.specifiers.forEach((s) => {
                        const exportName = s.exported?.name || s.local?.name;
                        if (exportName) metadata.exports.push(exportName);
                    });
                }
            },

            // 7. Extract Default Exports (e.g., export default initScannerWorker)
            ExportDefaultDeclaration(path) {
                const name = path.node.declaration?.name || "default";
                metadata.exports.push(name);
            },
        });

        return metadata;
    } catch (error) {
        console.error(`Error parsing file ${filePath}:`, error.message);
        return metadata;
    }
};

export default parseCode;
