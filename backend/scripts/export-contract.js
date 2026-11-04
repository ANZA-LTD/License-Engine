import { writeFileSync } from 'node:fs';
import { contract } from '../src/contracts/contract.js';
import { buildPostmanCollection } from '../src/contracts/postman.js';
writeFileSync(new URL('../docs/openapi.json', import.meta.url), JSON.stringify(contract, null, 2) + '\n');
writeFileSync(new URL('../docs/postman_collection.json', import.meta.url),
  JSON.stringify(buildPostmanCollection(contract), null, 2) + '\n');
console.log('Exported docs/openapi.json and docs/postman_collection.json');
