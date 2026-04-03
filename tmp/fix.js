const fs = require('fs');
let c = fs.readFileSync('prisma/seed.ts', 'utf8');
c = c.replace(/promptFieldName:\s*'prompt'/g, "promptFieldName: 'query'");
c = c.replace(/responseContentPath:\s*'content'/g, "responseContentPath: 'response'");
c = c.replace(/F\s*authType:\s*'API_KEY_HEADER',/g, "authType: 'API_KEY_HEADER',");
fs.writeFileSync('prisma/seed.ts', c);
