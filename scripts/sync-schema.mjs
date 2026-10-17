// Copies the CAF JSON Schema from the spec repository into src/schema/.
import { writeFileSync } from 'node:fs';

const SCHEMA_URL = 'https://raw.githubusercontent.com/common-agents/spec/main/schema/caf-1.0.schema.json';
const res = await fetch(SCHEMA_URL);
if (!res.ok) throw new Error(`GET ${SCHEMA_URL} returned ${res.status}`);
writeFileSync(new URL('../src/schema/caf-1.0.schema.json', import.meta.url), await res.text());
console.log('Updated src/schema/caf-1.0.schema.json');
