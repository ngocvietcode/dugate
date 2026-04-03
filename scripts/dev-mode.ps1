# scripts/dev-mode.ps1
# Chuyen connector URLs tu Docker internal -> localhost (cho npm run dev)
Write-Host "Switching connector URLs to LOCAL DEV mode..." -ForegroundColor Cyan

$q = "UPDATE `"ExternalApiConnection`" SET `"endpointUrl`" = REPLACE(`"endpointUrl`", 'http://mock-service:3099', 'http://localhost:3099');"
$q | docker exec -i du-db-1 psql -U dugate -d dugate

Write-Host "Done! Connectors now point to http://localhost:3099" -ForegroundColor Green
Write-Host "Run: npm run dev" -ForegroundColor Yellow
