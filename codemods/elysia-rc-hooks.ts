/**
 * Elysia 2.0.0-rc.0 renamed the lifecycle hooks back to their `on` form.
 * Rewrites every call whose method resolves to Elysia's own class -- never a
 * same-named method on anything else (`controller.error`, `compiler.parse`).
 *
 * Run it in a project while the OLD Elysia (beta) is still installed, so the
 * checker can resolve the old names:
 *   bun ~/abs/scripts/codemods/elysia-rc-hooks.ts [tsconfig.json] [--dry]
 */
import { dirname, resolve } from 'node:path';

const RENAMES: Record<string, string> = {
	afterHandle: 'onAfterHandle',
	afterResponse: 'onAfterResponse',
	beforeHandle: 'onBeforeHandle',
	error: 'onError',
	parse: 'onParse',
	request: 'onRequest',
	transform: 'onTransform'
};
/* Removed with no direct rename; reported for a person to look at. */
const REMOVED = new Set(['cleanup', 'ext', 'method', 'setup']);

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const configPath = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'tsconfig.json');
const projectRoot = dirname(configPath);
const ts = (await import(
	Bun.resolveSync('typescript', projectRoot)
)) as typeof import('typescript');

const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
	...ts.sys,
	onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
		throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
	}
});
if (!parsed) throw new Error(`Cannot read ${configPath}`);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const isElysiaMember = (symbol: import('typescript').Symbol | undefined) =>
	(symbol?.declarations ?? []).some((declaration) => {
		const file = declaration.getSourceFile().fileName;
		if (!/[\\/]node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?elysia[\\/]/.test(file))
			return false;
		const owner = declaration.parent;

		return ts.isClassDeclaration(owner) && owner.name?.text === 'Elysia';
	});

let renamed = 0;
const removed: string[] = [];
for (const source of program.getSourceFiles()) {
	if (source.isDeclarationFile || source.fileName.includes('/node_modules/')) continue;
	if (!source.fileName.startsWith(projectRoot)) continue;
	const edits: Array<{ end: number; start: number; text: string }> = [];
	const visit = (node: import('typescript').Node): void => {
		if (ts.isPropertyAccessExpression(node) && ts.isCallExpression(node.parent) && node.parent.expression === node) {
			const name = node.name.text;
			if ((RENAMES[name] || REMOVED.has(name)) && isElysiaMember(checker.getSymbolAtLocation(node.name))) {
				const at = source.getLineAndCharacterOfPosition(node.name.getStart());
				const where = `${source.fileName.slice(projectRoot.length + 1)}:${at.line + 1}`;
				if (RENAMES[name])
					edits.push({ end: node.name.getEnd(), start: node.name.getStart(), text: RENAMES[name]! });
				else removed.push(`${where} .${name}()`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (edits.length === 0) continue;
	renamed += edits.length;
	let text = source.getFullText();
	for (const edit of edits.sort((left, right) => right.start - left.start))
		text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
	console.log(`${dry ? 'would rewrite' : 'rewrote'} ${edits.length} in ${source.fileName.slice(projectRoot.length + 1)}`);
	if (!dry) await Bun.write(source.fileName, text);
}
console.log(`${renamed} hook call(s) ${dry ? 'to rename' : 'renamed'}`);
if (removed.length > 0) console.log(`Removed in rc.0, needs a person:\n  ${removed.join('\n  ')}`);
