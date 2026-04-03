const fs = require('fs');
let code = fs.readFileSync('lib/endpoints/registry.ts', 'utf8');

// Replace standard business rule declaration
code = code.replace(/business_rules:\s*\{\s*type:\s*'string'\s*as\s*const,\s*description:\s*'[^']+'\s*\},/g, '');

// Replace specific business rules mappings
code = code.replace(/business_rules:\s*\{\s*\.\.\.PARAMS\.business_rules,\s*defaultLocked:\s*true\s*\}/g, '');

// Clean up any empty parameters keys that now just have { } or a comma issue
// e.g. parameters: { \n\n },
// we don't strictly have to if the compiler accepts it, but we can

fs.writeFileSync('lib/endpoints/registry.ts', code);
console.log('Removed business_rules completely');
