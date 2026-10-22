/* Elysia 2 takes a route's options BEFORE its handler:
 *   .post(path, handler, { body })  ->  .post(path, { body }, handler)
 * Rewrites every route call (get/post/put/patch/delete/head/options/all/ws)
 * with three arguments whose second is a function and third an object
 * literal, keeping each argument's exact source text.
 *
 * Usage: bun elysia2-route-options-first.ts <file|dir> [--dry]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROUTES = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'ws']);
const [target, flag] = process.argv.slice(2);
if (!target) throw new Error('Usage: elysia2-route-options-first.ts <file|dir> [--dry]');
const dry = flag === '--dry';

const files = (path: string): string[] =>
	statSync(path).isDirectory()
		? readdirSync(path).flatMap((entry) =>
				entry === 'node_modules' ? [] : files(join(path, entry))
			)
		: /\.(ts|tsx)$/.test(path)
			? [path]
			: [];

const isFunction = (node: ts.Node) =>
	ts.isArrowFunction(node) || ts.isFunctionExpression(node);

let total = 0;
for (const file of files(target)) {
	const text = readFileSync(file, 'utf8');
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const swaps: Array<{ start: number; end: number; replacement: string }> = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ROUTES.has(node.expression.name.text) &&
			node.arguments.length === 3 &&
			isFunction(node.arguments[1]!) &&
			ts.isObjectLiteralExpression(node.arguments[2]!)
		) {
			const [, handler, options] = node.arguments as unknown as [ts.Node, ts.Node, ts.Node];
			swaps.push({
				end: options.getEnd(),
				replacement: `${options.getText(source)}, ${handler.getText(source)}`,
				start: handler.getStart(source)
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (swaps.length === 0) continue;
	// Apply innermost-last so outer offsets stay valid: sort by start descending,
	// and skip a swap that contains one already applied (nested routes are rare).
	swaps.sort((left, right) => right.start - left.start);
	let next = text;
	let applied = 0;
	let floor = Number.POSITIVE_INFINITY;
	for (const swap of swaps) {
		if (swap.end > floor) continue;
		next = next.slice(0, swap.start) + swap.replacement + next.slice(swap.end);
		floor = swap.start;
		applied++;
	}
	total += applied;
	console.log(`${dry ? 'would rewrite' : 'rewrote'} ${applied} in ${file}`);
	if (!dry) writeFileSync(file, next);
}
console.log(`${total} route(s) ${dry ? 'to reorder' : 'reordered'}`);
