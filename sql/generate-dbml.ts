#!/usr/bin/env bun
// eslint-disable import/no-unused-modules
import { stdout } from "bun";
import { getTableConfig } from "drizzle-orm/pg-core";
import { schema } from "../db/schema";

const dbmlOutputLines: string[] = [];
const seenReferences = new Set<string>();

for (const tableSchema of Object.values(schema)) {
	const tableConfiguration = getTableConfig(tableSchema);

	// --- Table definition
	dbmlOutputLines.push(`Table ${tableConfiguration.name} {`);
	for (const column of tableConfiguration.columns) {
		const modifiers: string[] = [];
		if (column.primary) modifiers.push("pk");
		if (column.notNull) modifiers.push("not null");
		if (column.default !== null) {
			// defaultNow() is a special case
			const defaultValue =
				typeof column.default === "object" ? "`now()`" : column.default;
			modifiers.push(`default: ${defaultValue}`);
		}
		const modifiersString = modifiers.length
			? ` [${modifiers.join(", ")}]`
			: "";
		dbmlOutputLines.push(
			`  ${column.name} ${column.dataType.toLowerCase()}${modifiersString}`
		);
	}
	dbmlOutputLines.push(`}\n`);

	// --- Foreign-key refs (with composite support + dedupe)
	for (const foreignKey of tableConfiguration.foreignKeys) {
		const foreignKeyReference = foreignKey.reference();
		const localColumnNames = foreignKeyReference.columns.map(
			(columnItem) => columnItem.name
		);
		const foreignColumnNames = foreignKeyReference.foreignColumns.map(
			(columnItem) => columnItem.name
		);
		const foreignTableName = getTableConfig(
			foreignKeyReference.foreignTable
		).name;

		const referenceSignature =
			`${tableConfiguration.name}.(${localColumnNames.join(",")})>` +
			`${foreignTableName}.(${foreignColumnNames.join(",")})`;
		if (seenReferences.has(referenceSignature)) continue;
		seenReferences.add(referenceSignature);

		const localColumnsList = localColumnNames.join(", ");
		const foreignColumnsList = foreignColumnNames.join(", ");
		const referenceAlias = `${tableConfiguration.name}_${localColumnNames.join("_")}`;

		dbmlOutputLines.push(
			`Ref ${referenceAlias}: ` +
				`${tableConfiguration.name}.(${localColumnsList}) > ${foreignTableName}.(${foreignColumnsList})`
		);
	}

	dbmlOutputLines.push("");
}

stdout.write(dbmlOutputLines.join("\n"));
